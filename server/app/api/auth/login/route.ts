import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, login_history, verification_codes } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { signTwoFactorChallenge } from "@/lib/auth/jwt";
import { generateId, generateVerificationCode, expiresAt, issueEmailCode } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { loginSchema } from "@/schemas/auth";
import { loginLimit, getClientIp, tooManyRequests } from "@/lib/security/rate-limiter";
import { sendVerificationEmail, sendTwoFactorEmail } from "@/lib/services/email";
import { issueSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const parsed = await parseBody(req, loginSchema);
  if (!parsed.success) return parsed.response;

  const { email, password, device_id } = parsed.data;

  // ── Rate limiting ────────────────────────────────────────────────────────
  const rl = loginLimit(ip, email);
  if (!rl.allowed) return tooManyRequests(rl.resetIn);

  // ── Lookup user ──────────────────────────────────────────────────────────
  const [user] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      password_hash: users.password_hash,
      role: users.role,
      is_creator: users.is_creator,
      is_active: users.is_active,
      is_verified: users.is_verified,
      two_fa_enabled: users.two_fa_enabled,
      deleted_at: users.deleted_at,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const ua = req.headers.get("user-agent") ?? null;

  // Invalid credentials return the SAME message and code whether the account
  // exists or not — never reveal whether a specific email is registered.
  const invalidCredentials = () => err("Invalid email or password", 401, "INVALID_CREDENTIALS");

  if (!user) {
    return invalidCredentials();
  }

  const passwordOk = await verifyPassword(user.password_hash, password);

  await db.insert(login_history).values({
    id: generateId(),
    user_id: user.id,
    ip_address: ip,
    user_agent: ua,
    device_id: device_id ?? null,
    status: passwordOk ? "success" : "failed",
  });

  if (!passwordOk) {
    return invalidCredentials();
  }

  if (!user.is_active || user.deleted_at) {
    return err("This account has been deactivated", 403);
  }

  // ── Email verification gate ──────────────────────────────────────────────
  // If the account hasn't been verified yet, resend the code and block login.
  // The frontend should redirect to the email verification screen.
  if (!user.is_verified) {
    const code = generateVerificationCode();
    await db.insert(verification_codes).values({
      id: generateId(),
      user_id: user.id,
      code,
      type: "email_verify",
      expires_at: expiresAt(15),
    });

    await sendVerificationEmail({
      to: user.email,
      name: user.full_name ?? user.email,
      code,
    }).catch(() => null);

    return err(
      "Please verify your email before logging in. A new verification code has been sent.",
      403,
      "EMAIL_NOT_VERIFIED",
    );
  }

  const publicUser = {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    email: user.email,
    role: user.role,
    is_creator: user.is_creator,
  };

  // ── Two-factor authentication gate (email code) ─────────────────────────
  // A correct password must never produce a session when 2FA is enabled. Email
  // a 6-digit sign-in code, issue a short-lived challenge token, and let the
  // client submit the code to /auth/2fa/verify for the real session tokens.
  if (user.two_fa_enabled) {
    const code = await issueEmailCode(user.id, "two_fa");
    await sendTwoFactorEmail({
      to: user.email,
      name: user.full_name ?? user.email,
      code,
    }).catch(() => null);

    const challengeToken = await signTwoFactorChallenge(user.id);
    return ok({
      requires_2fa: true,
      challenge_token: challengeToken,
      user: publicUser,
    });
  }

  // ── Issue tokens ─────────────────────────────────────────────────────────
  const session = await issueSession(user.id, user.role, device_id);

  return ok({
    ...session,
    user: publicUser,
  });
}
