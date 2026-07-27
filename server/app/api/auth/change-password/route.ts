import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
  // Support both camelCase and snake_case
  current_password: z.string().min(1).optional(),
  new_password: z.string().min(8).max(128).optional(),
}).transform((d) => ({
  currentPassword: d.currentPassword ?? d.current_password ?? "",
  newPassword: d.newPassword ?? d.new_password ?? "",
}));

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const { currentPassword, newPassword } = parsed.data;

  const [user] = await db
    .select({ id: users.id, password_hash: users.password_hash })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const valid = await verifyPassword(user.password_hash, currentPassword);
  if (!valid) return err("Current password is incorrect", 400, "WRONG_PASSWORD");

  const new_hash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ password_hash: new_hash, updated_at: new Date().toISOString() })
    .where(eq(users.id, auth.user.userId));

  return ok({ changed: true });
}
