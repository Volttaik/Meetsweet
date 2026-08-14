import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { twoFaDisableSchema } from "@/schemas/auth";
import { decryptTotpSecret, verifyTotpCode } from "@/lib/security/totp";
import { verifyPassword } from "@/lib/auth/password";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, twoFaDisableSchema);
  if (!parsed.success) return parsed.response;

  const [user] = await db
    .select({
      password_hash: users.password_hash,
      totp_secret: users.totp_secret,
      totp_enabled: users.totp_enabled,
    })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const passwordOk = await verifyPassword(user.password_hash, parsed.data.password);
  if (!passwordOk) return err("Password is incorrect", 400, "WRONG_PASSWORD");

  // If 2FA is currently active, a valid current code is also required — this
  // prevents a stolen password from being enough to strip the second factor.
  if (user.totp_enabled) {
    const secret = decryptTotpSecret(user.totp_secret);
    const code = parsed.data.code;
    if (!secret || !code || !verifyTotpCode(secret, code)) {
      return err("Invalid verification code", 400, "INVALID_CODE");
    }
  }

  await db
    .update(users)
    .set({ totp_enabled: false, totp_secret: null, updated_at: new Date().toISOString() })
    .where(eq(users.id, auth.user.userId));

  return ok({ enabled: false });
}
