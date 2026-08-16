import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  comment_likes,
  comment_replies,
  comment_rooms,
  comments,
  posts,
  profiles,
  users,
} from "@/lib/db/schema";

/**
 * The Comment Room id equals the post id (see schema). `roomId` in all
 * functions is therefore the post id. The room row holds the
 * comments-enabled flag; it is lazily created for legacy posts.
 */
export async function ensureCommentRoom(roomId: string) {
  await db
    .insert(comment_rooms)
    .values({ id: roomId, post_id: roomId, comments_enabled: true })
    .onConflictDoNothing();

  const [room] = await db
    .select()
    .from(comment_rooms)
    .where(eq(comment_rooms.post_id, roomId))
    .limit(1);

  return room ?? null;
}

export async function getCommentRoom(roomId: string) {
  const room = await ensureCommentRoom(roomId);
  if (!room) return null;
  // `posts.comment_count` is the single canonical comment counter used by every
  // feed/list endpoint; the room row only holds the comments-enabled flag.
  const [post] = await db
    .select({ comment_count: posts.comment_count })
    .from(posts)
    .where(eq(posts.id, roomId))
    .limit(1);
  const commentCount = post?.comment_count ?? 0;
  return {
    comment_room_id: room.id,
    commentRoomId: room.id,
    post_id: room.post_id,
    postId: room.post_id,
    comments_enabled: room.comments_enabled,
    commentsEnabled: room.comments_enabled,
    comment_count: commentCount,
    commentCount,
    updated_at: room.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function commentShape(row: any, roomId: string, likedByMe: boolean, parentId: string | null = null) {
  return {
    id: row.id,
    comment_room_id: roomId,
    commentRoomId: roomId,
    parent_id: parentId,
    parentId,
    body: row.body ?? "",
    is_pinned: Boolean(row.is_pinned ?? false),
    like_count: row.like_count ?? 0,
    likeCount: row.like_count ?? 0,
    reply_count: row.reply_count ?? 0,
    replyCount: row.reply_count ?? 0,
    liked_by_me: likedByMe,
    likedByMe: likedByMe,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: {
      id: row.author_id ?? "",
      name: row.author_display_name ?? row.author_name ?? "User",
      username: row.author_username ?? "",
      avatar_url: row.author_avatar ?? null,
      avatarUrl: row.author_avatar ?? null,
    },
  };
}

async function likedSetForCommentIds(ids: string[], viewerId: string | null): Promise<Set<string>> {
  if (!viewerId || ids.length === 0) return new Set();
  const liked = await db
    .select({ comment_id: comment_likes.comment_id })
    .from(comment_likes)
    .where(
      and(
        eq(comment_likes.user_id, viewerId),
        sql`${comment_likes.comment_id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
      ),
    );
  return new Set(liked.map((l) => l.comment_id).filter(Boolean) as string[]);
}

export async function listRoomComments(
  roomId: string,
  opts: { after?: string; limit?: number; viewerId?: string | null } = {},
) {
  const limit = Math.min(Math.max(1, opts.limit ?? 20), 50);

  const conds = [eq(comments.post_id, roomId), isNull(comments.deleted_at)];
  if (opts.after) {
    conds.push(gt(comments.created_at, opts.after));
  }

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
      author_display_name: profiles.display_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comments.author_id))
    .where(and(...conds))
    .orderBy(desc(comments.is_pinned), desc(comments.created_at))
    .limit(limit);

  const likedSet = await likedSetForCommentIds(rows.map((r) => r.id), opts.viewerId ?? null);
  return rows.map((r) => commentShape(r, roomId, likedSet.has(r.id)));
}

export async function listRoomReplies(roomId: string, commentId: string) {
  const rows = await db
    .select({
      id: comment_replies.id,
      body: comment_replies.body,
      like_count: comment_replies.like_count,
      created_at: comment_replies.created_at,
      updated_at: comment_replies.updated_at,
      author_id: users.id,
      author_name: users.full_name,
      author_display_name: profiles.display_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
    .from(comment_replies)
    .innerJoin(users, eq(users.id, comment_replies.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comment_replies.author_id))
    .where(and(eq(comment_replies.comment_id, commentId), isNull(comment_replies.deleted_at)))
    .orderBy(asc(comment_replies.created_at));

  return rows.map((r) => commentShape(r, roomId, false, commentId));
}
