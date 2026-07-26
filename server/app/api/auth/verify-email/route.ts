import { NextRequest } from "next/server";
import { eq, and, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, verification_codes } from "@/lib/db/schema";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, z.object({ code: z.string().length(6), email: z.string().email() }));
  if (!parsed.success) return parsed.response;

  const { code, email } = parsed.data;

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return err("Invalid verification code", 400);

  const now = new Date().toISOString();
  const [vcRow] = await db
    .select({ id: verification_codes.id })
    .from(verification_codes)
    .where(
      and(
        eq(verification_codes.user_id, user.id),
        eq(verification_codes.code, code),
        eq(verification_codes.type, "email_verify"),
        gt(verification_codes.expires_at, now),
        isNull(verification_codes.used_at),
      ),
    )
    .limit(1);

  if (!vcRow) return err("Invalid or expired verification code", 400);

  await db.update(verification_codes).set({ used_at: now }).where(eq(verification_codes.id, vcRow.id));
  await db.update(users).set({ is_verified: true, updated_at: now }).where(eq(users.id, user.id));

  return ok({ verified: true });
}
