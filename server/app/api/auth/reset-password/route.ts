import { NextRequest } from "next/server";
import { eq, and, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, verification_codes, refresh_tokens } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const schema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  new_password: z.string().min(8).max(128).optional(),
  // Mobile sends `password` (not `new_password`).
  password: z.string().min(8).max(128).optional(),
}).transform((d) => ({
  email: d.email,
  code: d.code,
  new_password: d.new_password ?? d.password ?? "",
}));

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const { email, code, new_password } = parsed.data;

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return err("Invalid reset code", 400);

  const now = new Date().toISOString();
  const [vcRow] = await db
    .select({ id: verification_codes.id })
    .from(verification_codes)
    .where(
      and(
        eq(verification_codes.user_id, user.id),
        eq(verification_codes.code, code),
        eq(verification_codes.type, "password_reset"),
        gt(verification_codes.expires_at, now),
        isNull(verification_codes.used_at),
      ),
    )
    .limit(1);

  if (!vcRow) return err("Invalid or expired reset code", 400);

  const newHash = await hashPassword(new_password);

  await db.update(verification_codes).set({ used_at: now }).where(eq(verification_codes.id, vcRow.id));
  await db.update(users).set({ password_hash: newHash, updated_at: now }).where(eq(users.id, user.id));

  // Revoke all existing refresh tokens for security
  await db.update(refresh_tokens).set({ revoked_at: now }).where(eq(refresh_tokens.user_id, user.id));

  return ok({ reset: true });
}
