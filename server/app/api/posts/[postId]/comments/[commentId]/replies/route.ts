import { NextRequest } from "next/server";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, comments, comment_replies } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

function formatReply(r: Record<string, unknown>, isLiked: boolean) {
  return {
    id: r.id,
    body: r.body,
    like_count: r.like_count,
    likeCount: r.like_count,
    created_at: r.created_at,
    createdAt: r.created_at,
    updated_at: r.updated_at,
    updatedAt: r.updated_at,
    liked_by_me: isLiked,
    likedByMe: isLiked,
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> },
) {
  const { postId, commentId } = await params;
  const { searchParams } = req.nextUrl;
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const offset = (page - 1) * limit;

  // Check comment exists and belongs to the post
  const [comment] = await db
    .select({ id: comments.id, post_id: comments.post_id })
    .from(comments)
    .where(and(
      eq(comments.id, commentId),
      eq(comments.post_id, postId),
      isNull(comments.deleted_at)
    ))
    .limit(1);

  if (!comment) return err("Comment not found", 404);

  const userId = (await optionalAuth(req))?.userId ?? null;

  const rows = await db
    .select({
      id: comment_replies.id,
      body: comment_replies.body,
      like_count: comment_replies.like_count,
      created_at: comment_replies.created_at,
      updated_at: comment_replies.updated_at,
      author_id: users.id,
      author_name: users.full_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
      author_is_verified: users.is_verified,
    })
    .from(comment_replies)
    .innerJoin(users, eq(users.id, comment_replies.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comment_replies.author_id))
    .where(and(eq(comment_replies.comment_id, commentId), isNull(comment_replies.deleted_at)))
    .orderBy(desc(comment_replies.created_at))
    .limit(limit)
    .offset(offset);

  // Get liked status if user is authenticated
  let likedSet = new Set<string>();
  if (userId && rows.length > 0) {
    const { comment_likes } = await import("@/lib/db/schema");
    const likedReplies = await db
      .select({ reply_id: comment_likes.reply_id })
      .from(comment_likes)
      .where(
        and(
          eq(comment_likes.user_id, userId),
          sql`${comment_likes.reply_id} IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`
        )
      );
    likedSet = new Set(likedReplies.map((l) => l.reply_id ?? ""));
  }

  return ok({
    replies: rows.map((r) => formatReply(r as Record<string, unknown>, likedSet.has(r.id))),
    page,
    limit,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { postId, commentId } = await params;

  // Check comment exists and belongs to the post
  const [comment] = await db
    .select({ id: comments.id, post_id: comments.post_id, reply_count: comments.reply_count })
    .from(comments)
    .where(and(
      eq(comments.id, commentId),
      eq(comments.post_id, postId),
      isNull(comments.deleted_at)
    ))
    .limit(1);

  if (!comment) return err("Comment not found", 404);

  const parsed = await parseBody(req, z.object({
    body: z.string().min(1).max(2000),
    mention_id: z.string().optional(),
  }));
  if (!parsed.success) return parsed.response;

  const replyId = generateId();
  await db.insert(comment_replies).values({
    id: replyId,
    comment_id: commentId,
    author_id: auth.user.userId,
    mention_id: parsed.data.mention_id ?? null,
    body: parsed.data.body,
  });

  // Increment reply count on parent comment
  await db
    .update(comments)
    .set({ reply_count: sql`${comments.reply_count} + 1` })
    .where(eq(comments.id, commentId));

  // Get the created reply with author info
  const [reply] = await db
    .select({
      id: comment_replies.id,
      body: comment_replies.body,
      like_count: comment_replies.like_count,
      created_at: comment_replies.created_at,
      updated_at: comment_replies.updated_at,
      author_id: users.id,
      author_name: users.full_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
      author_is_verified: users.is_verified,
    })
    .from(comment_replies)
    .innerJoin(users, eq(users.id, comment_replies.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comment_replies.author_id))
    .where(eq(comment_replies.id, replyId))
    .limit(1);

  return created({ reply: formatReply(reply as Record<string, unknown>, false) });
}
