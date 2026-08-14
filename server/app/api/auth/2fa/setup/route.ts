import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateTotpSecret, totpUri, encryptTotpSecret } from "@/lib/security/totp";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [user] = await db
    .select({ username: users.username, email: users.email })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ totp_secret: encryptTotpSecret(secret), updated_at: new Date().toISOString() })
    .where(eq(users.id, auth.user.userId));

  const account = user.username || user.email;
  return ok({
    secret,
    otpauth_url: totpUri(secret, account),
  });
}
