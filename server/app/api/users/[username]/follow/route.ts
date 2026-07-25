import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, follows } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, notFound, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { username } = await params;

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), eq(users.is_active, true)))
    .limit(1);

  if (!target) return notFound("User not found");
  if (target.id === auth.user.userId) return err("Cannot follow yourself", 400);

  await db
    .insert(follows)
    .values({ id: generateId(), follower_id: auth.user.userId, following_id: target.id })
    .onConflictDoNothing();

  return ok({ following: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { username } = await params;

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), eq(users.is_active, true)))
    .limit(1);

  if (!target) return notFound("User not found");

  await db
    .delete(follows)
    .where(and(eq(follows.follower_id, auth.user.userId), eq(follows.following_id, target.id)));

  return ok({ following: false });
}
