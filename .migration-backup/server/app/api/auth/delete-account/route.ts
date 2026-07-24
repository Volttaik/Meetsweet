import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { z } from "zod";

const schema = z.object({ password: z.string().min(1) });

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
  if (!valid) return err("Incorrect password", 400);

  // Soft delete
  await db
    .update(users)
    .set({ is_active: false, deleted_at: new Date().toISOString() })
    .where(eq(users.id, user.id));

  return ok(null, "Account deleted");
}
