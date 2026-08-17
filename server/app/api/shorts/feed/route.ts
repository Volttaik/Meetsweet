import { NextRequest } from "next/server";
import { eq, and, desc, isNull, notInArray, sql, exists } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, media, users, profiles, post_likes, subscriptions } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import {
  buildShortRow,
  getHiddenCreatorIds,
  groupMediaByPost,
  feedRankScore,
  getFeedDedupClause,
  applyCreatorDiversity,
  recordFeedImpressions,
} from "@/lib/services/content";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const cursor = params.get("cursor");
  const limit = Math.min(Math.max(1, Number(params.get("limit") ?? 20)), 50);
  const userId = (await optionalAuth(req))?.userId ?? null;
  // Hidden/blocked creators stay out of the shorts feed.
  const hiddenCreatorIds = userId ? await getHiddenCreatorIds(userId) : [];

  // A short without a playable video media row cannot be rendered, so only
  // serve shorts that actually have one. This keeps the feed truthful — the
  // empty state appears only when there genuinely are no playable shorts —
  // instead of surfacing media-less rows as broken black pages.
  const hasVideoMedia = exists(
    db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.post_id, posts.id), eq(media.type, "video"))),
  );

  // Feed dedup: don't re-serve shorts the viewer already swiped past within
  // 24h (unless they own them or subscribe to the creator).
  const dedupClause = await getFeedDedupClause(userId);
  let conditions = and(
    isNull(posts.deleted_at),
    eq(users.is_active, true),
    isNull(users.deleted_at),
    eq(posts.status, "published"),
    eq(posts.content_type, "short"),
    eq(posts.visibility, "public"),
    hasVideoMedia,
    ...(hiddenCreatorIds.length > 0 ? [notInArray(posts.creator_id, hiddenCreatorIds)] : []),
    ...(dedupClause ? [dedupClause] : []),
  );

  // Ranked cursor: score__published_at__id (legacy plain created_at cursors
  // are no longer produced; treat any non-compound cursor as legacy).
  if (cursor) {
    const parts = cursor.split("__");
    if (parts.length === 3) {
      const [cs, ts, cid] = parts;
      conditions = and(
        conditions,
        sql`(${feedRankScore(userId)} < ${cs} OR (${feedRankScore(userId)} = ${cs} AND (${posts.published_at} < ${ts} OR (${posts.published_at} = ${ts} AND ${posts.id} < ${cid}))))`,
      );
    } else {
      conditions = and(conditions, sql`${posts.created_at} < ${cursor}`);
    }
  }

  const rows = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      caption: posts.caption,
      title: posts.title,
      visibility: posts.visibility,
      tier: posts.tier,
      thumbnail_url: posts.thumbnail_url,
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
      // Blended ranking score — also used for ordering + cursor.
      rank_score: feedRankScore(userId),
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(conditions)
    // Server-authoritative ranking: blended score, then freshness/id tiebreaks.
    .orderBy(desc(feedRankScore(userId)), desc(posts.published_at), desc(posts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  // Soft creator diversity within the page (deterministic reorder).
  const items = applyCreatorDiversity(slice);
  const postIds = items.map((p) => p.id);

  // Record what was served (feed dedup across requests).
  void recordFeedImpressions(userId, postIds).catch(() => {});

  const mediaRows = postIds.length > 0
    ? await db.select().from(media).where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];

  const likedSet: Set<string> = userId && postIds.length > 0
    ? await db.select({ post_id: post_likes.post_id }).from(post_likes)
        .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`))
        .then((r) => new Set(r.map((x) => x.post_id)))
    : new Set();

  // Map of creator_id → subscription tier
  const subscriptionMap: Map<string, string | null> = userId
    ? await db
        .select({ creator_id: subscriptions.creator_id, tier: subscriptions.tier })
        .from(subscriptions)
        .where(and(eq(subscriptions.subscriber_id, userId), eq(subscriptions.status, "active")))
        .then((r) => new Map(r.map((x) => [x.creator_id, x.tier])))
    : new Map();

  const mediaByPost = groupMediaByPost(mediaRows);

  const shorts = items.map((p) => {
    const isSubscribed = subscriptionMap.has(p.creator_id);
    const subTier = subscriptionMap.get(p.creator_id) ?? null;
    return buildShortRow(p, mediaByPost[p.id] ?? [], likedSet.has(p.id), isSubscribed, subTier);
  });

  // Cursor from the LOWEST-ranked shown row (pre-diversity slice).
  const cursorRow = slice[slice.length - 1];
  return ok({
    shorts,
    items: shorts,
    next_cursor: hasMore && cursorRow
      ? `${cursorRow.rank_score}__${cursorRow.published_at ?? cursorRow.created_at}__${cursorRow.id}`
      : null,
    has_more: hasMore,
    hasMore,
  });
}
