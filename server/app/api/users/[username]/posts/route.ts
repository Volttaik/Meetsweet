import { NextRequest } from "next/server";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, posts, media, post_likes, saved_posts, subscriptions } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { canViewContent } from "@/lib/services/content";

function postRow(
  p: Record<string, unknown>,
  mediaItems: unknown[],
  liked: boolean,
  bookmarked: boolean,
  isLocked: boolean,
) {
  return {
    id: p.id,
    creator_id: p.creator_id,
    creator_username: p.creator_username,
    creator_display_name: p.creator_display_name,
    creator_avatar: p.creator_avatar,
    creator_is_verified: p.creator_is_verified,
    caption: p.caption,
    visibility: p.visibility,
    tier: p.tier ?? null,
    status: p.status,
    is_pinned: p.is_pinned,
    preview_duration: p.preview_duration,
    like_count: p.like_count,
    comment_count: p.comment_count,
    save_count: p.save_count,
    view_count: p.view_count,
    published_at: p.published_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
    liked_by_me: liked,
    bookmarked_by_me: bookmarked,
    is_locked: isLocked,
    isLocked,
    media: isLocked ? [] : mediaItems,
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
  const isOwner = userId === user.id;

  const cursor = req.nextUrl.searchParams.get("cursor");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  const conditions = and(
    isNull(posts.deleted_at),
    eq(posts.status, "published"),
    eq(posts.creator_id, user.id),
    isOwner ? undefined : eq(posts.visibility, "public"),
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
      tier: posts.tier,
      status: posts.status,
      is_pinned: posts.is_pinned,
      preview_duration: posts.preview_duration,
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

  // Fetch media, liked/saved state, and the viewer's subscription to this creator in parallel.
  // All posts on this page share the same creator (user.id).
  const [allMedia, likedRows, savedRows, subscriptionRow] = await Promise.all([
    db.select().from(media)
      .where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`),
    userId
      ? db.select({ post_id: post_likes.post_id }).from(post_likes)
          .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`))
      : Promise.resolve([]),
    userId
      ? db.select({ post_id: saved_posts.post_id }).from(saved_posts)
          .where(and(eq(saved_posts.user_id, userId), sql`${saved_posts.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`))
      : Promise.resolve([]),
    userId
      ? db.select({ tier: subscriptions.tier }).from(subscriptions)
          .where(and(
            eq(subscriptions.subscriber_id, userId),
            eq(subscriptions.creator_id, user.id),
            eq(subscriptions.status, "active"),
          )).limit(1)
      : Promise.resolve([]),
  ]);

  const likedSet = new Set((likedRows as { post_id: string }[]).map((l) => l.post_id));
  const savedSet = new Set((savedRows as { post_id: string }[]).map((s) => s.post_id));
  const isSubscribed = subscriptionRow.length > 0;
  const subTier = (subscriptionRow[0] as { tier: string | null } | undefined)?.tier ?? null;

  const mediaByPost = allMedia.reduce(
    (acc, m) => {
      if (!m.post_id) return acc;
      if (!acc[m.post_id]) acc[m.post_id] = [];
      acc[m.post_id].push({ url: m.url, type: m.type, thumbnail_url: m.thumbnail_url ?? null, duration_secs: m.duration_seconds, file_size: m.size_bytes, width: m.width, height: m.height });
      return acc;
    },
    {} as Record<string, unknown[]>,
  );

  const result = items.map((p) => {
    const isLocked = !canViewContent(
      p.visibility as string,
      p.tier as string | null,
      isSubscribed,
      subTier,
      isOwner,
    );
    return postRow(p as Record<string, unknown>, mediaByPost[p.id] ?? [], likedSet.has(p.id), savedSet.has(p.id), isLocked);
  });

  const nextCursor = hasMore ? items[items.length - 1]?.created_at ?? null : null;
  return ok({ posts: result, hasMore, next_cursor: nextCursor, nextCursor });
}
