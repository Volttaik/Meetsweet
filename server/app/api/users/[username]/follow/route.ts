import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, follows } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { username } = await params;

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!target) return err("User not found", 404);
  if (target.id === auth.user.userId) return err("You cannot follow yourself", 400);

  const [existing] = await db
    .select({ id: follows.id })
    .from(follows)
    .where(and(eq(follows.follower_id, auth.user.userId), eq(follows.following_id, target.id)))
    .limit(1);

  if (!existing) {
    await db.insert(follows).values({
      id: generateId(),
      follower_id: auth.user.userId,
      following_id: target.id,
    });
  }

  return ok({ following: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { username } = await params;

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!target) return err("User not found", 404);

  await db
    .delete(follows)
    .where(and(eq(follows.follower_id, auth.user.userId), eq(follows.following_id, target.id)));

  return ok({ following: false });
}
