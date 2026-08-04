import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, refresh_tokens, login_history, verification_codes } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { generateId, generateVerificationCode, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { ok, err, unauthorized } from "@/lib/api/response";
import { loginSchema } from "@/schemas/auth";
import { loginLimit, getClientIp, tooManyRequests } from "@/lib/security/rate-limiter";
import { sendVerificationEmail } from "@/lib/services/email";

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
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const ua = req.headers.get("user-agent") ?? null;

  if (!user) {
    return unauthorized("Invalid email or password");
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
    return unauthorized("Invalid email or password");
  }

  if (!user.is_active) {
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

  // ── Issue tokens ─────────────────────────────────────────────────────────
  const tokenPayload = { userId: user.id, role: user.role };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(tokenPayload),
    signRefreshToken(tokenPayload),
  ]);

  const refreshExpiry = expiresAt(60 * 24 * 30); // 30 days
  await db.insert(refresh_tokens).values({
    id: generateId(),
    user_id: user.id,
    token_hash: createHash("sha256").update(refreshToken).digest("hex"),
    device_id: device_id ?? null,
    expires_at: refreshExpiry,
  });

  return ok({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 900,
    user: {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      email: user.email,
      role: user.role,
      is_creator: user.is_creator,
    },
  });
}
