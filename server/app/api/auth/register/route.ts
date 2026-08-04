import { NextRequest } from "next/server";
import { eq, or } from "drizzle-orm";
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

  const { full_name, username, email, phone, password } = parsed.data;

  // ── Duplicate check ──────────────────────────────────────────────────────
  const [existing] = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(or(eq(users.email, email), eq(users.username, username)))
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
    avatar_url: null,
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
    message: "Account created. Please check your email for a verification code.",
    requires_verification: true,
    email,
  });
}
