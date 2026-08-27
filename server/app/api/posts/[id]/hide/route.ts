import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, hidden_posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, id), isNull(posts.deleted_at))).limit(1);
  if (!post) return err("Post not found", 404);

  const [existing] = await db
    .select({ id: hidden_posts.id })
    .from(hidden_posts)
    .where(and(eq(hidden_posts.user_id, auth.user.userId), eq(hidden_posts.post_id, id)))
    .limit(1);

  if (!existing) {
    await db.insert(hidden_posts).values({ id: generateId(), user_id: auth.user.userId, post_id: id });
  }

  return ok({ hidden: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  await db
    .delete(hidden_posts)
    .where(and(eq(hidden_posts.user_id, auth.user.userId), eq(hidden_posts.post_id, id)));

  return ok({ hidden: false });
}
