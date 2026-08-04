import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, comment_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, like_count: comments.like_count })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!comment) return err("Comment not found", 404);

  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(and(eq(comment_likes.user_id, auth.user.userId), eq(comment_likes.comment_id, commentId)))
    .limit(1);

  if (!existing) {
    await db.insert(comment_likes).values({ id: generateId(), user_id: auth.user.userId, comment_id: commentId });
    await db.update(comments).set({ like_count: sql`${comments.like_count} + 1` }).where(eq(comments.id, commentId));
  }

  const [updated] = await db.select({ like_count: comments.like_count }).from(comments).where(eq(comments.id, commentId)).limit(1);
  const count = updated?.like_count ?? 0;
  return ok({ liked: true, like_count: count, likeCount: count });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;

  const [comment] = await db.select({ id: comments.id }).from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!comment) return err("Comment not found", 404);

  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(and(eq(comment_likes.user_id, auth.user.userId), eq(comment_likes.comment_id, commentId)))
    .limit(1);

  if (existing) {
    await db.delete(comment_likes).where(eq(comment_likes.id, existing.id));
    await db.update(comments).set({ like_count: sql`MAX(0, ${comments.like_count} - 1)` }).where(eq(comments.id, commentId));
  }

  const [updated] = await db.select({ like_count: comments.like_count }).from(comments).where(eq(comments.id, commentId)).limit(1);
  const count = updated?.like_count ?? 0;
  return ok({ liked: false, like_count: count, likeCount: count });
}
