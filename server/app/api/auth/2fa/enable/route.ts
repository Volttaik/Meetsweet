import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { twoFaEnableSchema } from "@/schemas/auth";
import { consumeEmailCode } from "@/lib/auth/codes";
import { twoFactorVerifyLimit, getClientIp, tooManyRequests } from "@/lib/security/rate-limiter";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const rl = twoFactorVerifyLimit(getClientIp(req));
  if (!rl.allowed) return tooManyRequests(rl.resetIn);

  const parsed = await parseBody(req, twoFaEnableSchema);
  if (!parsed.success) return parsed.response;

  const [user] = await db
    .select({ two_fa_enabled: users.two_fa_enabled })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);
  if (user.two_fa_enabled) {
    return err("Two-factor authentication is already enabled", 409, "ALREADY_ENABLED");
  }

  // The emailed code is single-use: correct code + still valid = enabled.
  if (!(await consumeEmailCode(auth.user.userId, "two_fa", parsed.data.code))) {
    return err("Invalid or expired verification code", 400, "INVALID_CODE");
  }

  await db
    .update(users)
    .set({ two_fa_enabled: true, updated_at: new Date().toISOString() })
    .where(eq(users.id, auth.user.userId));

  return ok({ enabled: true });
}
