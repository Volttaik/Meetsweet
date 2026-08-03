import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, comments, posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

function formatComment(r: Record<string, unknown>, isLiked: boolean) {
  return {
    id: r.id,
    body: r.body,
    is_pinned: r.is_pinned,
    isPinned: r.is_pinned,
    like_count: r.like_count,
    likeCount: r.like_count,
    reply_count: r.reply_count,
    replyCount: r.reply_count,
    liked_by_me: isLiked,
    likedByMe: isLiked,
    created_at: r.created_at,
    createdAt: r.created_at,
    updated_at: r.updated_at,
    updatedAt: r.updated_at,
    author: {
      id: r.author_id,
      name: r.author_name,
      full_name: r.author_name,
      username: r.author_username,
      avatar_url: r.author_avatar,
      avatarUrl: r.author_avatar,
      is_verified: r.author_is_verified ?? false,
    },
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { postId, commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, author_id: comments.author_id, post_id: comments.post_id })
    .from(comments)
    .where(and(
      eq(comments.id, commentId),
      eq(comments.post_id, postId),
      isNull(comments.deleted_at)
    ))
    .limit(1);

  if (!comment) return err("Comment not found", 404);
  if (comment.author_id !== auth.user.userId) return err("Forbidden", 403);

  const parsed = await parseBody(req, z.object({
    body: z.string().min(1).max(2000),
  }));
  if (!parsed.success) return parsed.response;

  await db
    .update(comments)
    .set({
      body: parsed.data.body,
      updated_at: new Date().toISOString(),
    })
    .where(eq(comments.id, commentId));

  // Get updated comment with author info
  const [updated] = await db
    .select({
      id: comments.id,
      body: comments.body,
      is_pinned: comments.is_pinned,
      like_count: comments.like_count,
      reply_count: comments.reply_count,
      created_at: comments.created_at,
      updated_at: comments.updated_at,
      author_id: users.id,
      author_name: users.full_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
      author_is_verified: users.is_verified,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comments.author_id))
    .where(eq(comments.id, commentId))
    .limit(1);

  return ok({ comment: formatComment(updated as Record<string, unknown>, false) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { postId, commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, author_id: comments.author_id, post_id: comments.post_id })
    .from(comments)
    .where(and(
      eq(comments.id, commentId),
      eq(comments.post_id, postId),
      isNull(comments.deleted_at)
    ))
    .limit(1);

  if (!comment) return err("Comment not found", 404);
  if (comment.author_id !== auth.user.userId && auth.user.role !== "admin") {
    return err("Forbidden", 403);
  }

  await db
    .update(comments)
    .set({ deleted_at: new Date().toISOString() })
    .where(eq(comments.id, commentId));

  // Decrement comment count on post
  await db
    .update(posts)
    .set({ comment_count: sql`${posts.comment_count} - 1` })
    .where(eq(posts.id, postId));

  return ok({ deleted: true });
}
