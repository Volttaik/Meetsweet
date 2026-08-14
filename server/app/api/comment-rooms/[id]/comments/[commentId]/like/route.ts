import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { comment_likes, comments } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

async function resolveComment(commentId: string) {
  const [comment] = await db
    .select({ id: comments.id, like_count: comments.like_count })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  return comment;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;
  const comment = await resolveComment(commentId);
  if (!comment) return err("Comment not found", 404);

  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(and(eq(comment_likes.comment_id, commentId), eq(comment_likes.user_id, auth.user.userId)))
    .limit(1);

  if (!existing) {
    await db.insert(comment_likes).values({
      id: generateId(),
      comment_id: commentId,
      user_id: auth.user.userId,
    });
    await db.update(comments).set({ like_count: sql`${comments.like_count} + 1` }).where(eq(comments.id, commentId));
  }

  const [updated] = await db
    .select({ like_count: comments.like_count })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  return ok({ like_count: updated?.like_count ?? 0, likeCount: updated?.like_count ?? 0, liked: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;
  const comment = await resolveComment(commentId);
  if (!comment) return err("Comment not found", 404);

  const [existing] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(and(eq(comment_likes.comment_id, commentId), eq(comment_likes.user_id, auth.user.userId)))
    .limit(1);

  if (existing) {
    await db.delete(comment_likes).where(eq(comment_likes.id, existing.id));
    await db.update(comments).set({ like_count: sql`MAX(0, ${comments.like_count} - 1)` }).where(eq(comments.id, commentId));
  }

  const [updated] = await db
    .select({ like_count: comments.like_count })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  return ok({ like_count: updated?.like_count ?? 0, likeCount: updated?.like_count ?? 0, liked: false });
}
