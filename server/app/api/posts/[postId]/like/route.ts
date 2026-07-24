import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, post_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, notFound } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db.select({ id: posts.id, like_count: posts.like_count }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return notFound();

  const [existing] = await db.select({ id: post_likes.id }).from(post_likes).where(and(eq(post_likes.post_id, postId), eq(post_likes.user_id, auth.user.userId))).limit(1);
  if (!existing) {
    await db.insert(post_likes).values({ id: generateId(), user_id: auth.user.userId, post_id: postId });
    await db.update(posts).set({ like_count: post.like_count + 1 }).where(eq(posts.id, postId));
  }

  return ok(null, "Liked");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db.select({ id: posts.id, like_count: posts.like_count }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return notFound();

  const [existing] = await db.select({ id: post_likes.id }).from(post_likes).where(and(eq(post_likes.post_id, postId), eq(post_likes.user_id, auth.user.userId))).limit(1);
  if (existing) {
    await db.delete(post_likes).where(eq(post_likes.id, existing.id));
    await db.update(posts).set({ like_count: Math.max(0, post.like_count - 1) }).where(eq(posts.id, postId));
  }

  return ok(null, "Unliked");
}
