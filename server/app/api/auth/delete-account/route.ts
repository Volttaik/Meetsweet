import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, refresh_tokens } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { verifyPassword } from "@/lib/auth/password";

const schema = z.object({
  password: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const [user] = await db
    .select({ id: users.id, password_hash: users.password_hash })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const valid = await verifyPassword(user.password_hash, parsed.data.password);
  if (!valid) return err("Password is incorrect", 400, "WRONG_PASSWORD");

  const now = new Date().toISOString();

  // Revoke all active sessions before soft-deleting
  await db
    .update(refresh_tokens)
    .set({ revoked_at: now })
    .where(eq(refresh_tokens.user_id, auth.user.userId));

  await db
    .update(users)
    .set({ deleted_at: now, is_active: false, updated_at: now })
    .where(eq(users.id, auth.user.userId));

  return ok({ deleted: true });
}
