import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, post_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { notifyLike } from "@/lib/services/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db
    .select({
      id: posts.id,
      like_count: posts.like_count,
      creator_id: posts.creator_id,
      content_type: posts.content_type,
      title: posts.title,
      caption: posts.caption,
    })
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);
  if (!post) return err("Post not found", 404);

  const [existing] = await db
    .select({ id: post_likes.id })
    .from(post_likes)
    .where(and(eq(post_likes.user_id, auth.user.userId), eq(post_likes.post_id, id)))
    .limit(1);

  if (!existing) {
    await db.insert(post_likes).values({ id: generateId(), user_id: auth.user.userId, post_id: id });
    await db.update(posts).set({ like_count: sql`${posts.like_count} + 1` }).where(eq(posts.id, id));

    // Notify post creator (skip if creator liked their own post). The service
    // gates the row + push by their Likes preference, dedupes the event, and
    // builds the navigation payload — never awaited so it can't delay the reply.
    if (post.creator_id && post.creator_id !== auth.user.userId) {
      void notifyLike({
        actorId: auth.user.userId,
        recipientId: post.creator_id,
        postId: id,
        contentType: post.content_type ?? "post",
        title: post.title ?? post.caption,
      });
    }
  }

  const [updated] = await db.select({ like_count: posts.like_count }).from(posts).where(eq(posts.id, id)).limit(1);

  const likeCount = updated?.like_count ?? 0;

  return ok({ liked: true, like_count: likeCount });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, id), isNull(posts.deleted_at))).limit(1);
  if (!post) return err("Post not found", 404);

  const [existing] = await db
    .select({ id: post_likes.id })
    .from(post_likes)
    .where(and(eq(post_likes.user_id, auth.user.userId), eq(post_likes.post_id, id)))
    .limit(1);

  if (existing) {
    await db.delete(post_likes).where(eq(post_likes.id, existing.id));
    await db.update(posts).set({ like_count: sql`MAX(0, ${posts.like_count} - 1)` }).where(eq(posts.id, id));
  }

  const [updated] = await db.select({ like_count: posts.like_count }).from(posts).where(eq(posts.id, id)).limit(1);

  const likeCount = updated?.like_count ?? 0;

  return ok({ liked: false, like_count: likeCount });
}
