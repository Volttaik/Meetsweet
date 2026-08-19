import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { issueEmailCode } from "@/lib/auth/codes";
import { sendTwoFactorEmail } from "@/lib/services/email";
import { twoFactorVerifyLimit, getClientIp, tooManyRequests } from "@/lib/security/rate-limiter";

/**
 * POST /api/auth/2fa/setup
 *
 * Emails a fresh 6-digit code to the account owner. Used both when ENABLING
 * two-factor authentication and when DISABLING it (a current code is required
 * to turn it off). No secret, no authenticator app — the code arrives by email.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const rl = twoFactorVerifyLimit(getClientIp(req));
  if (!rl.allowed) return tooManyRequests(rl.resetIn);

  const [user] = await db
    .select({ full_name: users.full_name, email: users.email })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const code = await issueEmailCode(auth.user.userId, "two_fa");
  await sendTwoFactorEmail({
    to: user.email,
    name: user.full_name ?? user.email,
    code,
  }).catch(() => null);

  return ok({ sent: true, expires_in_seconds: 15 * 60 });
}
