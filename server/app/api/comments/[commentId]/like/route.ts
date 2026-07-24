import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, comment_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, notFound } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, like_count: comments.like_count })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!comment) return notFound();

  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(and(eq(comment_likes.comment_id, commentId), eq(comment_likes.user_id, auth.user.userId)))
    .limit(1);

  if (!existing) {
    await db.insert(comment_likes).values({
      id: generateId(),
      user_id: auth.user.userId,
      comment_id: commentId,
    });
    await db
      .update(comments)
      .set({ like_count: comment.like_count + 1 })
      .where(eq(comments.id, commentId));
  }

  return ok(null, "Liked");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, like_count: comments.like_count })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!comment) return notFound();

  // Only decrement if the like row actually exists
  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(and(eq(comment_likes.comment_id, commentId), eq(comment_likes.user_id, auth.user.userId)))
    .limit(1);

  if (existing) {
    await db.delete(comment_likes).where(eq(comment_likes.id, existing.id));
    await db
      .update(comments)
      .set({ like_count: Math.max(0, comment.like_count - 1) })
      .where(eq(comments.id, commentId));
  }

  return ok(null, "Unliked");
}
