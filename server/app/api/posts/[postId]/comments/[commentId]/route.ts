import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, users, profiles, posts, comment_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, forbidden, notFound } from "@/lib/api/response";
import { z } from "zod";

const updateSchema = z.object({
  body: z.string().min(1).max(1000),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId, commentId } = await params;

  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return notFound("Comment not found");
  if (comment.post_id !== postId) return notFound("Comment not found");
  if (comment.author_id !== auth.user.userId) return forbidden();

  const parsed = await parseBody(req, updateSchema);
  if (!parsed.success) return parsed.response;

  const now = new Date().toISOString();
  await db
    .update(comments)
    .set({ body: parsed.data.body, updated_at: now })
    .where(eq(comments.id, commentId));

  const [authorRow] = await db
    .select({
      id: users.id,
      name: users.full_name,
      username: users.username,
      avatar_url: profiles.avatar_url,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, comment.author_id))
    .limit(1);

  // Check if the current user liked this comment
  const [liked] = await db
    .select({ id: comment_likes.id })
    .from(comment_likes)
    .where(
      and(
        eq(comment_likes.comment_id, commentId),
        eq(comment_likes.user_id, auth.user.userId)
      )
    )
    .limit(1);

  return ok({
    comment: {
      id: commentId,
      body: parsed.data.body,
      created_at: comment.created_at,
      updated_at: now,
      like_count: comment.like_count,
      reply_count: comment.reply_count,
      parent_id: null,
      liked_by_me: !!liked,
      author: {
        id: authorRow?.id ?? comment.author_id,
        name: authorRow?.name ?? "",
        username: authorRow?.username ?? "",
        avatar_url: authorRow?.avatar_url ?? null,
      },
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId, commentId } = await params;

  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return notFound("Comment not found");
  if (comment.post_id !== postId) return notFound("Comment not found");
  if (comment.author_id !== auth.user.userId && auth.user.role !== "admin") return forbidden();

  await db
    .update(comments)
    .set({ deleted_at: new Date().toISOString() })
    .where(eq(comments.id, commentId));

  const [post] = await db
    .select({ comment_count: posts.comment_count })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  if (post) {
    await db
      .update(posts)
      .set({ comment_count: Math.max(0, post.comment_count - 1) })
      .where(eq(posts.id, postId));
  }

  return ok({});
}
