import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, verification_codes } from "@/lib/db/schema";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId, generateVerificationCode, expiresAt } from "@/lib/auth/codes";
import { sendVerificationEmail } from "@/lib/services/email";
import { resendVerificationSchema } from "@/schemas/auth";
import { resendVerificationLimit, getClientIp, tooManyRequests } from "@/lib/security/rate-limiter";

/**
 * POST /api/auth/resend-verification
 *
 * Re-sends the email verification code for an unverified account.
 * Always returns the same response to prevent email enumeration.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const parsed = await parseBody(req, resendVerificationSchema);
  if (!parsed.success) return parsed.response;

  const { email } = parsed.data;

  // ── Rate limiting ────────────────────────────────────────────────────────
  const rl = resendVerificationLimit(ip, email);
  if (!rl.allowed) return tooManyRequests(rl.resetIn);

  // ── Resend only for unverified accounts ─────────────────────────────────
  const [user] = await db
    .select({ id: users.id, full_name: users.full_name, is_verified: users.is_verified })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user && !user.is_verified) {
    const code = generateVerificationCode();
    await db.insert(verification_codes).values({
      id: generateId(),
      user_id: user.id,
      code,
      type: "email_verify",
      expires_at: expiresAt(15),
    });

    await sendVerificationEmail({
      to: email,
      name: user.full_name ?? email,
      code,
    }).catch(() => null);
  }

  return ok({ message: "If an unverified account exists for that email, a new code has been sent." });
}
