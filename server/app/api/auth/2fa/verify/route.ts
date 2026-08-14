import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { parseBody } from "@/lib/api/validate";
import { ok, err, unauthorized } from "@/lib/api/response";
import { twoFaVerifySchema } from "@/schemas/auth";
import { verifyTotpChallenge } from "@/lib/auth/jwt";
import { decryptTotpSecret, verifyTotpCode } from "@/lib/security/totp";
import { issueSession } from "@/lib/auth/session";
import { twoFactorVerifyLimit, getClientIp, tooManyRequests } from "@/lib/security/rate-limiter";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const rl = twoFactorVerifyLimit(ip);
  if (!rl.allowed) return tooManyRequests(rl.resetIn);

  const parsed = await parseBody(req, twoFaVerifySchema);
  if (!parsed.success) return parsed.response;

  const { challenge_token, code } = parsed.data;

  let challenge;
  try {
    challenge = await verifyTotpChallenge(challenge_token);
  } catch {
    return unauthorized("Invalid or expired verification session. Please log in again.");
  }

  const [user] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      role: users.role,
      is_creator: users.is_creator,
      is_active: users.is_active,
      totp_secret: users.totp_secret,
      totp_enabled: users.totp_enabled,
    })
    .from(users)
    .where(eq(users.id, challenge.userId))
    .limit(1);

  if (!user || !user.is_active) {
    return unauthorized("Invalid or expired verification session. Please log in again.");
  }
  if (!user.totp_enabled) {
    return err("Two-factor authentication is not enabled for this account", 400, "NOT_ENABLED");
  }

  const secret = decryptTotpSecret(user.totp_secret);
  if (!secret || !verifyTotpCode(secret, code)) {
    return unauthorized("Invalid verification code");
  }

  const session = await issueSession(user.id, user.role, null);

  return ok({
    ...session,
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
