import { NextRequest } from "next/server";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, posts, media, post_likes, saved_posts } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

function postRow(p: Record<string, unknown>, mediaItems: unknown[], liked: boolean, bookmarked: boolean) {
  return {
    id: p.id,
    creator_id: p.creator_id,
    creator_username: p.creator_username,
    creator_display_name: p.creator_display_name,
    creator_avatar: p.creator_avatar,
    creator_is_verified: p.creator_is_verified,
    caption: p.caption,
    visibility: p.visibility,
    status: p.status,
    is_pinned: p.is_pinned,
    preview_duration: p.preview_duration,
    unlock_price: p.unlock_price,
    like_count: p.like_count,
    comment_count: p.comment_count,
    save_count: p.save_count,
    view_count: p.view_count,
    published_at: p.published_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
    liked_by_me: liked,
    bookmarked_by_me: bookmarked,
    media: mediaItems,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  // Resolve user by username
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!user) return err("User not found", 404);

  const userId = await optionalAuth(req).then((a) => a?.userId ?? null);

  const cursor = req.nextUrl.searchParams.get("cursor");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  let conditions = and(
    isNull(posts.deleted_at),
    eq(posts.status, "published"),
    eq(posts.creator_id, user.id),
  );

  const rows = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: users.is_verified,
      caption: posts.caption,
      visibility: posts.visibility,
      status: posts.status,
      is_pinned: posts.is_pinned,
      preview_duration: posts.preview_duration,
      unlock_price: posts.unlock_price,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      save_count: posts.save_count,
      view_count: posts.view_count,
      published_at: posts.published_at,
      created_at: posts.created_at,
      updated_at: posts.updated_at,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(conditions)
    .orderBy(desc(posts.published_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  if (items.length === 0) return ok({ posts: [], hasMore: false, nextCursor: null, next_cursor: null });

  const postIds = items.map((p) => p.id);

  const allMedia = await db
    .select()
    .from(media)
    .where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`);

  let likedSet = new Set<string>();
  let savedSet = new Set<string>();
  if (userId) {
    const liked = await db
      .select({ post_id: post_likes.post_id })
      .from(post_likes)
      .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`));
    likedSet = new Set(liked.map((l) => l.post_id));

    const saved = await db
      .select({ post_id: saved_posts.post_id })
      .from(saved_posts)
      .where(and(eq(saved_posts.user_id, userId), sql`${saved_posts.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`));
    savedSet = new Set(saved.map((s) => s.post_id));
  }

  const mediaByPost = allMedia.reduce(
    (acc, m) => {
      if (!m.post_id) return acc;
      if (!acc[m.post_id]) acc[m.post_id] = [];
      acc[m.post_id].push({ url: m.url, type: m.type, thumbnail_url: null, duration_secs: m.duration_seconds, file_size: m.size_bytes, width: m.width, height: m.height });
      return acc;
    },
    {} as Record<string, unknown[]>,
  );

  const result = items.map((p) =>
    postRow(p as Record<string, unknown>, mediaByPost[p.id] ?? [], likedSet.has(p.id), savedSet.has(p.id)),
  );

  const nextCursor = hasMore ? items[items.length - 1]?.created_at ?? null : null;
  return ok({ posts: result, hasMore, next_cursor: nextCursor, nextCursor });
}
