import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { twoFaDisableSchema } from "@/schemas/auth";
import { consumeEmailCode } from "@/lib/auth/codes";
import { verifyPassword } from "@/lib/auth/password";
import { twoFactorVerifyLimit, getClientIp, tooManyRequests } from "@/lib/security/rate-limiter";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const rl = twoFactorVerifyLimit(getClientIp(req));
  if (!rl.allowed) return tooManyRequests(rl.resetIn);

  const parsed = await parseBody(req, twoFaDisableSchema);
  if (!parsed.success) return parsed.response;

  const [user] = await db
    .select({ password_hash: users.password_hash, two_fa_enabled: users.two_fa_enabled })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const passwordOk = await verifyPassword(user.password_hash, parsed.data.password);
  if (!passwordOk) return err("Password is incorrect", 400, "WRONG_PASSWORD");

  // Disabling 2FA while it's active also requires a current emailed code — this
  // prevents a stolen password from being enough to strip the second factor.
  if (user.two_fa_enabled) {
    const code = parsed.data.code;
    if (!code || !(await consumeEmailCode(auth.user.userId, "two_fa", code))) {
      return err("Invalid or expired verification code", 400, "INVALID_CODE");
    }
  }

  await db
    .update(users)
    .set({ two_fa_enabled: false, updated_at: new Date().toISOString() })
    .where(eq(users.id, auth.user.userId));

  return ok({ enabled: false });
}
