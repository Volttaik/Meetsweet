import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  comment_likes,
  comment_rooms,
  comments,
  posts,
  profiles,
  users,
  user_settings,
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
    .select({ comment_count: posts.comment_count, creator_id: posts.creator_id })
    .from(posts)
    .where(eq(posts.id, roomId))
    .limit(1);
  const commentCount = post?.comment_count ?? 0;
  // The room flag is per-post; the owner's "Comments OFF" privacy control
  // additionally disables commenting on ALL their posts. Combined here so the
  // client reflects the authoritative state (composer hidden / disabled).
  let commentsEnabled = Boolean(room.comments_enabled);
  if (post?.creator_id) {
    const [owner] = await db
      .select({ allow_comments: user_settings.allow_comments })
      .from(user_settings)
      .where(eq(user_settings.user_id, post.creator_id))
      .limit(1);
    if (owner?.allow_comments === false) commentsEnabled = false;
  }
  return {
    comment_room_id: room.id,
    commentRoomId: room.id,
    post_id: room.post_id,
    postId: room.post_id,
    comments_enabled: commentsEnabled,
    commentsEnabled,
    comment_count: commentCount,
    commentCount,
    updated_at: room.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function commentShape(row: any, roomId: string, likedByMe: boolean, parentId: string | null = null) {
  // `parentId` is passed explicitly for freshly-created rows; otherwise fall
  // back to the row's own column (e.g. rows read from the unified comments
  // table, where parent_id is NULL for top-level comments).
  const resolvedParentId = parentId ?? row.parent_id ?? null;
  return {
    id: row.id,
    comment_room_id: roomId,
    commentRoomId: roomId,
    parent_id: resolvedParentId,
    parentId: resolvedParentId,
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

  // Only top-level comments appear in the main comment list. Replies (rows
  // with parent_id set) live exclusively inside their parent thread.
  const conds = [eq(comments.post_id, roomId), isNull(comments.parent_id), isNull(comments.deleted_at)];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreadRow = Record<string, any>;

const COMMENT_FIELDS = sql`
  c.id,
  c.body,
  c.is_pinned,
  c.like_count,
  c.reply_count,
  c.parent_id,
  c.created_at,
  c.updated_at,
  u.id AS author_id,
  u.full_name AS author_name,
  u.username AS author_username,
  p.display_name AS author_display_name,
  p.avatar_url AS author_avatar
`;

/**
 * Fetch the ENTIRE descendant subtree of a comment (every reply depth, flat,
 * oldest-first). The recursive CTE traverses through soft-deleted rows so a
 * deleted reply's children are still found; the final projection then drops
 * deleted rows, leaving children whose parent was deleted to be re-parented
 * by the client to the nearest visible ancestor.
 *
 * Every row keeps its exact `parent_id`, so the client rebuilds the tree from
 * parent-child links alone — siblings can never become children of each other.
 */
export async function listCommentThread(roomId: string, commentId: string, viewerId: string | null = null) {
  const rows = (await db.all(sql`
    WITH RECURSIVE comment_thread AS (
      SELECT id, parent_id FROM comments WHERE id = ${commentId}
      UNION ALL
      SELECT c.id, c.parent_id
      FROM comments c
      INNER JOIN comment_thread t ON c.parent_id = t.id
    )
    SELECT ${COMMENT_FIELDS}
    FROM comments c
    INNER JOIN comment_thread t ON c.id = t.id
    INNER JOIN users u ON u.id = c.author_id
    LEFT JOIN profiles p ON p.user_id = c.author_id
    WHERE c.post_id = ${roomId}
      AND c.id <> ${commentId} -- descendants only; the root is the caller
      AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC
  `)) as ThreadRow[];

  const likedSet = await likedSetForCommentIds(rows.map((r) => r.id), viewerId);
  return rows.map((r) => commentShape(r, roomId, likedSet.has(r.id)));
}
