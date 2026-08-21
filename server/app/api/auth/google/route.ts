import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, user_settings, users, login_history } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { issueSession } from "@/lib/auth/session";
import { generateId } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { err, ok, serverError, unauthorized } from "@/lib/api/response";
import { googleAuthSchema } from "@/schemas/auth";
import { verifyGoogleIdToken } from "@/lib/services/google-auth";
import { lookupReferral, normalizeReferralCode } from "@/lib/services/referrals";
import { getClientIp, loginLimit, tooManyRequests } from "@/lib/security/rate-limiter";
import { config } from "@/lib/config";

function publicUser(user: {
  id: string;
  full_name: string;
  username: string;
  email: string;
  role: string;
  is_creator: boolean;
}) {
  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    email: user.email,
    role: user.role,
    is_creator: user.is_creator,
  };
}

function usernameBase(displayName: string, email: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  const fallback = email.split("@", 1)[0].toLowerCase().replace(/[^a-z0-9_]+/g, "").slice(0, 20);
  return (base || fallback || "member").slice(0, 20);
}

async function createUniqueGoogleUsername(displayName: string, email: string, subject: string): Promise<string> {
  const base = usernameBase(displayName, email);
  const suffix = subject.replace(/[^a-zA-Z0-9]/g, "").slice(-7).toLowerCase() || "google";
  const candidates = [
    `${base}_${suffix}`.slice(0, 30),
    `${base}_${suffix.slice(0, 4)}`.slice(0, 30),
    `member_${suffix}`.slice(0, 30),
  ];

  for (const candidate of candidates) {
    const [match] = await db.select({ id: users.id }).from(users).where(eq(users.username, candidate)).limit(1);
    if (!match) return candidate;
  }

  return `member_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * POST /api/auth/google
 *
 * The client sends only Google's signed ID token. The server verifies it and
 * then issues the same MeetSweet access/refresh session as password login.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const parsed = await parseBody(req, googleAuthSchema);
  if (!parsed.success) return parsed.response;

  if (config.google.clientIds().length === 0) {
    return serverError("Google authentication is not configured on the server");
  }

  let identity;
  try {
    identity = await verifyGoogleIdToken(parsed.data.id_token);
  } catch {
    return err("Google authentication could not be verified", 401, "GOOGLE_TOKEN_INVALID");
  }

  const rl = loginLimit(ip, identity.email);
  if (!rl.allowed) return tooManyRequests(rl.resetIn);

  const ua = req.headers.get("user-agent") ?? null;
  const [linkedUser] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      role: users.role,
      is_creator: users.is_creator,
      is_active: users.is_active,
      deleted_at: users.deleted_at,
      google_email: users.google_email,
    })
    .from(users)
    .where(eq(users.google_subject, identity.subject))
    .limit(1);

  if (linkedUser) {
    if (!linkedUser.is_active || linkedUser.deleted_at) {
      return err("This account has been deactivated", 403, "ACCOUNT_DEACTIVATED");
    }

    if (linkedUser.google_email !== identity.email) {
      await db.update(users).set({ google_email: identity.email, updated_at: new Date().toISOString() }).where(eq(users.id, linkedUser.id));
    }

    await db.insert(login_history).values({
      id: generateId(),
      user_id: linkedUser.id,
      ip_address: ip,
      user_agent: ua,
      device_id: parsed.data.device_id ?? null,
      status: "success",
    });

    const session = await issueSession(linkedUser.id, linkedUser.role, parsed.data.device_id);
    return ok({
      ...session,
      is_new_user: false,
      user: publicUser(linkedUser),
    });
  }

  // A Google ID token with email_verified=true is an explicit proof of control
  // of this email address. If the MeetSweet email already exists, link the
  // stable Google subject to that account instead of creating a duplicate.
  // Never overwrite a different subject already linked to the same account.
  const [emailUser] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      role: users.role,
      is_creator: users.is_creator,
      is_active: users.is_active,
      deleted_at: users.deleted_at,
      google_subject: users.google_subject,
    })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${identity.email}`, isNull(users.deleted_at)))
    .limit(1);
  if (emailUser) {
    if (!emailUser.is_active || emailUser.deleted_at) {
      return err("This account has been deactivated", 403, "ACCOUNT_DEACTIVATED");
    }
    if (emailUser.google_subject && emailUser.google_subject !== identity.subject) {
      return err("This email is already linked to another Google account", 409, "GOOGLE_IDENTITY_CONFLICT");
    }

    await db.update(users).set({
      google_subject: identity.subject,
      google_email: identity.email,
      is_verified: true,
      updated_at: new Date().toISOString(),
    }).where(and(eq(users.id, emailUser.id), isNull(users.google_subject)));

    // The conditional update prevents two different Google identities from
    // racing to claim one password account. Re-read the authoritative value
    // before issuing a session.
    const [linkedAfterUpdate] = await db
      .select({ google_subject: users.google_subject })
      .from(users)
      .where(eq(users.id, emailUser.id))
      .limit(1);
    if (linkedAfterUpdate?.google_subject !== identity.subject) {
      return err("This email is already linked to another Google account", 409, "GOOGLE_IDENTITY_CONFLICT");
    }

    await db.insert(login_history).values({
      id: generateId(),
      user_id: emailUser.id,
      ip_address: ip,
      user_agent: ua,
      device_id: parsed.data.device_id ?? null,
      status: "success",
    });

    const session = await issueSession(emailUser.id, emailUser.role, parsed.data.device_id);
    return ok({
      ...session,
      is_new_user: false,
      user: publicUser(emailUser),
    });
  }

  const normalizedReferralCode = normalizeReferralCode(parsed.data.referral_code);
  const referrer = normalizedReferralCode ? await lookupReferral(normalizedReferralCode) : null;
  if (parsed.data.referral_code && !referrer) {
    return err("Referral link not found or expired", 400, "REFERRAL_NOT_FOUND");
  }

  const userId = generateId();
  const username = await createUniqueGoogleUsername(identity.displayName, identity.email, identity.subject);
  const passwordHash = await hashPassword(randomUUID());

  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        full_name: identity.displayName,
        username,
        email: identity.email,
        password_hash: passwordHash,
        is_verified: true,
        role: "user",
        google_subject: identity.subject,
        google_email: identity.email,
        referred_by: referrer?.creator_id ?? null,
      });

      await tx.insert(profiles).values({
        id: generateId(),
        user_id: userId,
        display_name: identity.displayName,
        avatar_url: identity.picture,
      });

      await tx.insert(user_settings).values({
        id: generateId(),
        user_id: userId,
        biometric_login: false,
      });
    });
  } catch {
    // A concurrent first login may have won the unique google_subject race.
    const [concurrentUser] = await db
      .select({
        id: users.id,
        full_name: users.full_name,
        username: users.username,
        email: users.email,
        role: users.role,
        is_creator: users.is_creator,
        is_active: users.is_active,
        deleted_at: users.deleted_at,
      })
      .from(users)
      .where(or(eq(users.google_subject, identity.subject), eq(users.email, identity.email)))
      .limit(1);

    if (!concurrentUser || concurrentUser.email !== identity.email || !concurrentUser.is_active || concurrentUser.deleted_at) {
      return serverError("Unable to create the MeetSweet account");
    }

    if (!concurrentUser.id || concurrentUser.email !== identity.email) {
      return serverError("Unable to create the MeetSweet account");
    }

    const session = await issueSession(concurrentUser.id, concurrentUser.role, parsed.data.device_id);
    return ok({
      ...session,
      is_new_user: false,
      user: publicUser(concurrentUser),
    });
  }

  await db.insert(login_history).values({
    id: generateId(),
    user_id: userId,
    ip_address: ip,
    user_agent: ua,
    device_id: parsed.data.device_id ?? null,
    status: "success",
  });

  const session = await issueSession(userId, "user", parsed.data.device_id);
  return ok({
    ...session,
    is_new_user: true,
    user: publicUser({
      id: userId,
      full_name: identity.displayName,
      username,
      email: identity.email,
      role: "user",
      is_creator: false,
    }),
  });
}
