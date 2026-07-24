import { NextRequest } from "next/server";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, verification_codes } from "@/lib/db/schema";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { verifyEmailSchema } from "@/schemas/auth";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, verifyEmailSchema);
  if (!parsed.success) return parsed.response;
  const { email, code } = parsed.data;

  const [user] = await db
    .select({ id: users.id, is_verified: users.is_verified })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) return err("User not found", 404);
  if (user.is_verified) return ok(null, "Email already verified");

  const now = new Date().toISOString();
  const [vc] = await db
    .select()
    .from(verification_codes)
    .where(
      and(
        eq(verification_codes.user_id, user.id),
        eq(verification_codes.code, code),
        eq(verification_codes.type, "email_verify"),
        isNull(verification_codes.used_at),
        gt(verification_codes.expires_at, now)
      )
    )
    .limit(1);

  if (!vc) return err("Invalid or expired verification code", 400);

  await Promise.all([
    db.update(users).set({ is_verified: true }).where(eq(users.id, user.id)),
    db
      .update(verification_codes)
      .set({ used_at: now })
      .where(eq(verification_codes.id, vc.id)),
  ]);

  return ok(null, "Email verified successfully");
}
