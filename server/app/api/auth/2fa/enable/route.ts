import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { twoFaEnableSchema } from "@/schemas/auth";
import { decryptTotpSecret, verifyTotpCode } from "@/lib/security/totp";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, twoFaEnableSchema);
  if (!parsed.success) return parsed.response;

  const [user] = await db
    .select({ totp_secret: users.totp_secret, totp_enabled: users.totp_enabled })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);
  if (user.totp_enabled) {
    return err("Two-factor authentication is already enabled", 409, "ALREADY_ENABLED");
  }

  const secret = decryptTotpSecret(user.totp_secret);
  if (!secret) {
    return err("Two-factor authentication has not been set up", 400, "NOT_SET_UP");
  }

  if (!verifyTotpCode(secret, parsed.data.code)) {
    return err("Invalid verification code", 400, "INVALID_CODE");
  }

  await db
    .update(users)
    .set({ totp_enabled: true, updated_at: new Date().toISOString() })
    .where(eq(users.id, auth.user.userId));

  return ok({ enabled: true });
}
