import { NextRequest } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, user_settings, verification_codes } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { generateId, generateVerificationCode, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { created, err } from "@/lib/api/response";
import { registerSchema } from "@/schemas/auth";
import { registerLimit, getClientIp, tooManyRequests } from "@/lib/security/rate-limiter";
import { sendVerificationEmail } from "@/lib/services/email";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  // ── Rate limiting ────────────────────────────────────────────────────────
  const rl = registerLimit(ip);
  if (!rl.allowed) return tooManyRequests(rl.resetIn);

  const parsed = await parseBody(req, registerSchema);
  if (!parsed.success) return parsed.response;

  const { full_name, username, email, phone, password, bio, date_of_birth, dob, avatar_url } = parsed.data;

  // ── Duplicate check ──────────────────────────────────────────────────────
  // Soft-deleted accounts are EXCLUDED: once an account is deleted, its email
  // and username are freed (the DELETE flow replaces them with per-account
  // placeholders), so the same identity can register again. Only LIVE accounts
  // block a re-registration.
  const [existing] = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(and(or(eq(users.email, email), eq(users.username, username)), isNull(users.deleted_at)))
    .limit(1);

  if (existing) {
    if (existing.email === email) return err("An account with this email already exists", 409);
    return err("This username is already taken", 409);
  }

  // ── Create account ───────────────────────────────────────────────────────
  const password_hash = await hashPassword(password);
  const userId = generateId();

  await db.insert(users).values({
    id: userId,
    full_name,
    username,
    email,
    phone: phone ?? null,
    password_hash,
    role: "user",
    // is_verified defaults to false — login is blocked until verified
  });

  await db.insert(profiles).values({
    id: generateId(),
    user_id: userId,
    display_name: full_name,
    bio: bio ?? null,
    date_of_birth: date_of_birth ?? dob ?? null,
    avatar_url: avatar_url ?? null,
  });

  await db.insert(user_settings).values({
    id: generateId(),
    user_id: userId,
    biometric_login: false,
  });

  // ── Send verification email ───────────────────────────────────────────────
  const code = generateVerificationCode();
  await db.insert(verification_codes).values({
    id: generateId(),
    user_id: userId,
    code,
    type: "email_verify",
    expires_at: expiresAt(15),
  });

  await sendVerificationEmail({
    to: email,
    name: full_name,
    code,
  }).catch(() => null); // code is stored in DB; email failure is non-fatal

  // ── Return without tokens — user must verify email before logging in ─────
  return created({
    user_id: userId,
    id: userId,
    message: "Account created. Please check your email for a verification code.",
    requires_verification: true,
    email,
  });
}
