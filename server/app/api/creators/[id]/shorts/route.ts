import { NextRequest } from "next/server";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, media, users, profiles, post_likes, subscriptions } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { buildShortRow, groupMediaByPost } from "@/lib/services/content";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cursor = req.nextUrl.searchParams.get("cursor");
  const limit = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20)), 50);
  const userId = (await optionalAuth(req))?.userId ?? null;

  const condition = id.includes("-") && id.length > 20 ? eq(users.id, id) : eq(users.username, id);
  const [creator] = await db.select({ id: users.id, is_creator: users.is_creator })
    .from(users).where(and(condition, eq(users.is_active, true))).limit(1);
  if (!creator || !creator.is_creator) return err("Creator not found", 404);

  const rows = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      caption: posts.caption,
      title: posts.title,
      visibility: posts.visibility,
      tier: posts.tier,
      thumbnail_url: posts.thumbnail_url,
      unlock_price: posts.unlock_price,
      view_count: posts.view_count,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      share_count: posts.share_count,
      created_at: posts.created_at,
      published_at: posts.published_at,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: users.is_verified,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(and(
      eq(posts.creator_id, creator.id),
      isNull(posts.deleted_at),
      eq(posts.status, "published"),
      eq(posts.content_type, "short"),
      cursor ? sql`${posts.created_at} < ${cursor}` : undefined,
    ))
    .orderBy(desc(posts.published_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const postIds = items.map((p) => p.id);

  const mediaRows = postIds.length > 0
    ? await db.select().from(media).where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];

  const likedSet: Set<string> = userId && postIds.length > 0
    ? await db.select({ post_id: post_likes.post_id }).from(post_likes)
        .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`))
        .then((r) => new Set(r.map((x) => x.post_id)))
    : new Set();

  const [subscription] = userId
    ? await db
        .select({ id: subscriptions.id, tier: subscriptions.tier })
        .from(subscriptions)
        .where(and(eq(subscriptions.subscriber_id, userId), eq(subscriptions.creator_id, creator.id), eq(subscriptions.status, "active")))
        .limit(1)
    : [];

  const isSubscribed = !!subscription;
  const subTier = subscription?.tier ?? null;

  const mediaByPost = groupMediaByPost(mediaRows);

  const shorts = items.map((p) =>
    buildShortRow(p, mediaByPost[p.id] ?? [], likedSet.has(p.id), isSubscribed, subTier),
  );

  return ok({
    shorts,
    next_cursor: hasMore ? items[items.length - 1]?.created_at ?? null : null,
    has_more: hasMore,
  });
}
