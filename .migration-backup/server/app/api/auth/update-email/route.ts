import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { updateEmailSchema } from "@/schemas/auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, updateEmailSchema);
  if (!parsed.success) return parsed.response;
  const { email, password } = parsed.data;

  const [user] = await db
    .select({ id: users.id, password_hash: users.password_hash })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) return err("Incorrect password", 400);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (existing && existing.id !== user.id) return err("Email already in use", 409);

  await db
    .update(users)
    .set({ email: email.toLowerCase(), is_verified: false })
    .where(eq(users.id, user.id));

  return ok(null, "Email updated. Please verify your new email address.");
}
