import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, comment_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, notFound } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId, commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, like_count: comments.like_count, post_id: comments.post_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  if (!comment) return notFound("Comment not found");
  if (comment.post_id !== postId) return notFound("Comment not found");

  const inserted = await db
    .insert(comment_likes)
    .values({ id: generateId(), user_id: auth.user.userId, comment_id: commentId })
    .onConflictDoNothing();

  // Only increment count if a row was actually inserted
  const wasInserted = (inserted as { rowsAffected?: number }).rowsAffected !== 0;
  const newCount = wasInserted ? comment.like_count + 1 : comment.like_count;

  if (wasInserted) {
    await db
      .update(comments)
      .set({ like_count: newCount })
      .where(eq(comments.id, commentId));
  }

  return ok({ liked: true, likeCount: newCount });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId, commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, like_count: comments.like_count, post_id: comments.post_id })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  if (!comment) return notFound("Comment not found");
  if (comment.post_id !== postId) return notFound("Comment not found");

  // Check if the like actually exists before attempting delete
  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(
      and(
        eq(comment_likes.comment_id, commentId),
        eq(comment_likes.user_id, auth.user.userId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .delete(comment_likes)
      .where(
        and(
          eq(comment_likes.comment_id, commentId),
          eq(comment_likes.user_id, auth.user.userId)
        )
      );

    const newCount = Math.max(0, comment.like_count - 1);
    await db
      .update(comments)
      .set({ like_count: newCount })
      .where(eq(comments.id, commentId));

    return ok({ liked: false, likeCount: newCount });
  }

  // Already not liked — idempotent, return current count without mutating
  return ok({ liked: false, likeCount: comment.like_count });
}
