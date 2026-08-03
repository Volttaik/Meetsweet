import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, comment_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return err("Comment not found", 404);

  // Check if already liked
  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(and(
      eq(comment_likes.comment_id, commentId),
      eq(comment_likes.user_id, auth.user.userId)
    ))
    .limit(1);

  if (existing) {
    // Already liked, return current state
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(comment_likes)
      .where(eq(comment_likes.comment_id, commentId));
    return ok({
      liked: true,
      like_count: Number(countResult?.count ?? 0),
    });
  }

  // Add like
  await db.insert(comment_likes).values({
    id: generateId(),
    user_id: auth.user.userId,
    comment_id: commentId,
  });

  // Increment like count
  await db
    .update(comments)
    .set({ like_count: sql`${comments.like_count} + 1` })
    .where(eq(comments.id, commentId));

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(comment_likes)
    .where(eq(comment_likes.comment_id, commentId));

  return ok({
    liked: true,
    like_count: Number(countResult?.count ?? 0),
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return err("Comment not found", 404);

  // Check if liked
  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(and(
      eq(comment_likes.comment_id, commentId),
      eq(comment_likes.user_id, auth.user.userId)
    ))
    .limit(1);

  if (!existing) {
    // Not liked, return current state
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(comment_likes)
      .where(eq(comment_likes.comment_id, commentId));
    return ok({
      liked: false,
      like_count: Number(countResult?.count ?? 0),
    });
  }

  // Remove like
  await db
    .delete(comment_likes)
    .where(and(
      eq(comment_likes.comment_id, commentId),
      eq(comment_likes.user_id, auth.user.userId)
    ));

  // Decrement like count
  await db
    .update(comments)
    .set({ like_count: sql`${comments.like_count} - 1` })
    .where(eq(comments.id, commentId));

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(comment_likes)
    .where(eq(comment_likes.comment_id, commentId));

  return ok({
    liked: false,
    like_count: Number(countResult?.count ?? 0),
  });
}
