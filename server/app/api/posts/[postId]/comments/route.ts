import { NextRequest } from "next/server";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, comments, posts } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const { postId } = await params;
  const { searchParams } = req.nextUrl;
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const offset = (page - 1) * limit;

  // Check post exists
  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return err("Post not found", 404);

  const userId = (await optionalAuth(req))?.userId ?? null;

  const rows = await db
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
    .where(and(eq(comments.post_id, postId), isNull(comments.deleted_at)))
    .orderBy(desc(comments.is_pinned), desc(comments.created_at))
    .limit(limit)
    .offset(offset);

  // Get liked status for each comment if user is authenticated
  let likedSet = new Set<string>();
  if (userId && rows.length > 0) {
    const commentIds = rows.map((r) => r.id);
    const likes = await db
      .select({ comment_id: comments.id })
      .from(comments)
      .innerJoin(
        sql`comment_likes ON comment_likes.comment_id = comments.id AND comment_likes.user_id = ${userId}`,
        eq(comments.id, sql`comment_likes.comment_id`)
      )
      .where(sql`${comments.id} IN (${sql.join(commentIds.map((id) => sql`${id}`), sql`, `)})`);
    
    // Alternative approach using a subquery
    const { comment_likes } = await import("@/lib/db/schema");
    const likedComments = await db
      .select({ comment_id: comment_likes.comment_id })
      .from(comment_likes)
      .where(
        and(
          eq(comment_likes.user_id, userId),
          sql`${comment_likes.comment_id} IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`
        )
      );
    likedSet = new Set(likedComments.map((l) => l.comment_id ?? ""));
  }

  return ok({
    comments: rows.map((r) => formatComment(r as Record<string, unknown>, likedSet.has(r.id))),
    page,
    limit,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { postId } = await params;

  // Check post exists
  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return err("Post not found", 404);

  const parsed = await parseBody(req, z.object({
    body: z.string().min(1).max(2000),
  }));
  if (!parsed.success) return parsed.response;

  const commentId = generateId();
  await db.insert(comments).values({
    id: commentId,
    post_id: postId,
    author_id: auth.user.userId,
    body: parsed.data.body,
  });

  // Increment comment count on post
  await db
    .update(posts)
    .set({ comment_count: sql`${posts.comment_count} + 1` })
    .where(eq(posts.id, postId));

  // Get the created comment with author info
  const [comment] = await db
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

  return created({ comment: formatComment(comment as Record<string, unknown>, false) });
}
