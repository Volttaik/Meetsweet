import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { updatePasswordSchema } from "@/schemas/auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, updatePasswordSchema);
  if (!parsed.success) return parsed.response;
  const { current_password, new_password } = parsed.data;

  const [user] = await db
    .select({ id: users.id, password_hash: users.password_hash })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const valid = await verifyPassword(user.password_hash, current_password);
  if (!valid) return err("Current password is incorrect", 400);

  const newHash = await hashPassword(new_password);
  await db.update(users).set({ password_hash: newHash }).where(eq(users.id, user.id));

  return ok(null, "Password updated successfully");
}
