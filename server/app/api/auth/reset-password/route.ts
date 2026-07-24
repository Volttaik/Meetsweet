import { NextRequest } from "next/server";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, verification_codes } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { resetPasswordSchema } from "@/schemas/auth";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, resetPasswordSchema);
  if (!parsed.success) return parsed.response;
  const { email, code, password } = parsed.data;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) return err("Invalid reset request", 400);

  const now = new Date().toISOString();
  const [vc] = await db
    .select()
    .from(verification_codes)
    .where(
      and(
        eq(verification_codes.user_id, user.id),
        eq(verification_codes.code, code),
        eq(verification_codes.type, "password_reset"),
        isNull(verification_codes.used_at),
        gt(verification_codes.expires_at, now)
      )
    )
    .limit(1);

  if (!vc) return err("Invalid or expired reset code", 400);

  const newHash = await hashPassword(password);
  await Promise.all([
    db.update(users).set({ password_hash: newHash }).where(eq(users.id, user.id)),
    db
      .update(verification_codes)
      .set({ used_at: now })
      .where(eq(verification_codes.id, vc.id)),
  ]);

  return ok(null, "Password reset successfully");
}
