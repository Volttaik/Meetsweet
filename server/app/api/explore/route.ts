import { NextRequest } from "next/server";
import { eq, and, desc, isNull, inArray, notInArray, or, sql, count, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  profiles,
  posts,
  media,
  albums,
  post_likes,
  saved_posts,
  hidden_posts,
  subscriptions,
  devices,
  user_settings,
} from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import {
  buildVideoRow,
  buildShortRow,
  getHiddenCreatorIds,
  groupMediaByPost,
  feedRankScore,
  getFeedDedupClause,
  applyCreatorDiversity,
  recordFeedImpressions,
} from "@/lib/services/content";

/**
 * GET /api/explore
 *
 * Returns a mixed-content discovery feed (posts, videos, shorts) from a
 * SINGLE combined query so global pagination is stable — no items are
 * skipped or duplicated when the client advances pages.
 *
 * Albums are returned as a supplementary section; they live in a separate
 * table and cannot participate in the same ranked sort, so they are never
 * mixed into the paginated `items` array.
 *
 * Pagination strategy:
 *   - page + offset (client sends ?page=N&limit=M)
 *   - server fetches limit+1 rows to determine `has_more`
 *   - response trims to exactly `limit` items
 *   - `has_more` is derived from the true result set, not quota estimates
 *
 * Ranking: server-authoritative blended score (capped popularity + engagement
 * rate + freshness decay + subscription boost + deterministic per-user
 * exploration jitter), then freshness/id tiebreaks for stable pagination.
 * The same score is projected as rank_score on every row.
 */
export async function GET(req: NextRequest) {
  const page  = Math.max(1, Number(req.nextUrl.searchParams.get("page")  ?? 1));
  const limit = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20)), 50);
  const offset = (page - 1) * limit;

  const userId = await optionalAuth(req).then((a) => a?.userId ?? null);

  // Hidden/blocked creators never appear in Explore (content or creator rows).
  const hiddenCreatorIds = userId ? await getHiddenCreatorIds(userId) : [];

  // ── Hidden posts: collect IDs the viewer has explicitly hidden ───────────
  let hiddenPostIds: string[] = [];
  if (userId) {
    const hidden = await db
      .select({ post_id: hidden_posts.post_id })
      .from(hidden_posts)
      .where(eq(hidden_posts.user_id, userId));
    hiddenPostIds = hidden.map((h) => h.post_id);
  }

  // ── Single combined query: post + video + short ─────────────────────────
  // All three types live in the posts table, so one query + one sort gives
  // a globally consistent ranking that pages correctly across all types.
  const dedupClause = await getFeedDedupClause(userId);

  const contentRows = await db
    .select({
      id:                   posts.id,
      content_type:         posts.content_type,
      creator_id:           posts.creator_id,
      creator_username:     users.username,
      creator_display_name: profiles.display_name,
      creator_avatar:       profiles.avatar_url,
      creator_is_verified:  users.is_verified,
      caption:              posts.caption,
      title:                posts.title,
      description:          posts.description,
      visibility:           posts.visibility,
      tier:                 posts.tier,
      like_count:           posts.like_count,
      comment_count:        posts.comment_count,
      save_count:           posts.save_count,
      view_count:           posts.view_count,
      share_count:          posts.share_count,
      published_at:         posts.published_at,
      created_at:           posts.created_at,
      // Blended ranking score (see feedRankScore) — also used for ordering.
      rank_score:           feedRankScore(userId),
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(
      and(
        isNull(posts.deleted_at),
        eq(users.is_active, true),
        isNull(users.deleted_at),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
        // Explore shows ONLY free-tier content — subscriber-gated posts must never appear here.
        or(eq(posts.tier, "free"), isNull(posts.tier)),
        // Shorts are exclusive to the Shorts feed — never appear in Explore.
        // Mobile already skips them client-side, but the backend should not send them.
        inArray(posts.content_type, ["post", "video"]),
        // Exclude posts the viewer has explicitly hidden
        ...(hiddenPostIds.length > 0 ? [notInArray(posts.id, hiddenPostIds)] : []),
        // Exclude content from hidden/blocked creators
        ...(hiddenCreatorIds.length > 0 ? [notInArray(posts.creator_id, hiddenCreatorIds)] : []),
        // Feed dedup: don't re-serve content the viewer saw within 24h (unless
        // they own it or subscribe to the creator).
        ...(dedupClause ? [dedupClause] : []),
      ),
    )
    // Three-level ordering for full determinism at every page boundary:
    // 1. blended rank score (primary), 2. freshness, 3. id (unique tiebreaker)
    .orderBy(desc(feedRankScore(userId)), desc(posts.published_at), desc(posts.id))
    .limit(limit + 1)   // over-fetch by 1 to detect has_more
    .offset(offset);

  // True has_more: determined from actual result count before trim
  const hasMore = contentRows.length > limit;
  const slice   = hasMore ? contentRows.slice(0, limit) : contentRows;
  // Soft creator diversity — reorder within the page (deterministic) so a
  // single creator can never monopolize the discovery feed.
  const rows = applyCreatorDiversity(slice);

  // ── Supplementary albums (separate table, separate section) ─────────────
  const albumRows = await db
    .select({
      id:                   albums.id,
      creator_id:           albums.creator_id,
      creator_username:     users.username,
      creator_display_name: profiles.display_name,
      creator_avatar:       profiles.avatar_url,
      creator_is_verified:  users.is_verified,
      title:                albums.title,
      description:          albums.description,
      cover_url:            albums.cover_url,
      price_credits:        albums.price_credits,
      is_premium:           albums.is_premium,
      item_count:           albums.item_count,
      created_at:           albums.created_at,
    })
    .from(albums)
    .innerJoin(users, eq(users.id, albums.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, albums.creator_id))
    .where(and(isNull(albums.deleted_at), eq(albums.visibility, "public"), eq(users.is_active, true), isNull(users.deleted_at)))
    .orderBy(desc(albums.created_at))
    .limit(Math.ceil(limit * 0.15))
    .offset(offset);

  // ── Fetch media for all post-type rows ───────────────────────────────────

  const postIds = rows.map((r) => r.id);

  const allMediaRows =
    postIds.length > 0
      ? await db
          .select()
          .from(media)
          .where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];

  const mediaByPost = groupMediaByPost(allMediaRows);

  // ── Liked / bookmarked sets ─────────────────────────────────────────────

  let likedSet = new Set<string>();
  let savedSet = new Set<string>();

  if (userId && postIds.length > 0) {
    const idList = sql.join(postIds.map((id) => sql`${id}`), sql`, `);
    const [liked, saved] = await Promise.all([
      db.select({ post_id: post_likes.post_id })
        .from(post_likes)
        .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${idList})`)),
      db.select({ post_id: saved_posts.post_id })
        .from(saved_posts)
        .where(and(eq(saved_posts.user_id, userId), sql`${saved_posts.post_id} IN (${idList})`)),
    ]);
    likedSet = new Set(liked.map((l) => l.post_id));
    savedSet = new Set(saved.map((s) => s.post_id));
  }

  // ── Record what was served (feed dedup) — fire-and-forget ───────────────
  void recordFeedImpressions(userId, rows.map((r) => r.id)).catch(() => {});

  // ── Build typed items ───────────────────────────────────────────────────

  const items = rows.map((r) => {
    const rawMedia = mediaByPost[r.id] ?? [];

    if (r.content_type === "video") {
      return buildVideoRow(
        { ...r, share_count: r.share_count ?? 0 },
        rawMedia,
        likedSet.has(r.id),
        false,
      );
    }

    if (r.content_type === "short") {
      return buildShortRow(
        { ...r, share_count: r.share_count ?? 0 },
        rawMedia,
        likedSet.has(r.id),
        false,
      );
    }

    // post — Explore only returns free-tier content (filtered at query level),
    // so is_locked is always false here. tier is included for client contract compliance.
    const postMedia = rawMedia.map((m) => ({
      url: m.url,
      type: m.type,
      thumbnail_url: m.thumbnail_url ?? null,
      duration_secs: m.duration_seconds,
      width: m.width,
      height: m.height,
    }));
    return {
      id:                   r.id,
      content_type:         "post" as const,
      creator_id:           r.creator_id,
      creator_username:     r.creator_username,
      creator_display_name: r.creator_display_name,
      creator_avatar:       r.creator_avatar,
      creator_is_verified:  r.creator_is_verified,
      caption:              r.caption,
      visibility:           r.visibility,
      tier:                 r.tier ?? null,
      is_locked:            false,
      isLocked:             false,
      like_count:           r.like_count,
      comment_count:        r.comment_count,
      save_count:           r.save_count,
      view_count:           r.view_count,
      published_at:         r.published_at,
      created_at:           r.created_at,
      liked_by_me:          likedSet.has(r.id),
      bookmarked_by_me:     savedSet.has(r.id),
      thumbnail_url:        postMedia[0]?.thumbnail_url ?? null,
      media:                postMedia,
    };
  });

  const builtAlbums = albumRows.map((a) => ({
    id:                   a.id,
    content_type:         "album" as const,
    creator_id:           a.creator_id,
    creator_username:     a.creator_username,
    creator_display_name: a.creator_display_name,
    creator_avatar:       a.creator_avatar,
    creator_is_verified:  a.creator_is_verified,
    creator: {
      id:        a.creator_id,
      name:      a.creator_display_name ?? a.creator_username ?? "Creator",
      username:  a.creator_username ?? "",
      avatarUrl: a.creator_avatar ?? null,
      avatar_url: a.creator_avatar ?? null,
      isVerified: Boolean(a.creator_is_verified),
    },
    title:         a.title,
    description:   a.description,
    thumbnail_url: a.cover_url ?? null,
    cover_url:     a.cover_url ?? null,
    price_credits: a.price_credits,
    is_premium:    a.is_premium,
    item_count:    a.item_count,
    created_at:    a.created_at,
  }));

  // ── Featured creators ──────────────────────────────────────────────────

  const creatorRows = await db
    .select({
      id:                  users.id,
      full_name:           users.full_name,
      username:            users.username,
      avatar_url:          profiles.avatar_url,
      banner_url:          profiles.banner_url,
      bio:                 profiles.bio,
      is_verified:         users.is_verified,
      is_creator:          users.is_creator,
      is_verified_creator: profiles.is_verified_creator,
      category:            profiles.category,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .leftJoin(user_settings, eq(user_settings.user_id, users.id))
    .where(
      and(
        eq(users.is_creator, true),
        eq(users.is_active, true),
        isNull(users.deleted_at),
        // Private accounts are not discoverable — reachable only via a direct
        // profile link, never surfaced in Explore.
        or(isNull(user_settings.private_account), eq(user_settings.private_account, false)),
        ...(hiddenCreatorIds.length > 0 ? [notInArray(users.id, hiddenCreatorIds)] : []),
      ),
    )
    .limit(10)
    .offset(offset);

  // ── Active subscriber counts for featured creators (single grouped query) ──
  const creatorIds = creatorRows.map((u) => u.id);
  const subCountRows =
    creatorIds.length > 0
      ? await db
          .select({ creator_id: subscriptions.creator_id, n: count() })
          .from(subscriptions)
          .where(
            and(
              inArray(subscriptions.creator_id, creatorIds),
              eq(subscriptions.status, "active"),
            ),
          )
          .groupBy(subscriptions.creator_id)
      : [];
  const subCountMap = new Map(subCountRows.map((r) => [r.creator_id, r.n]));

  // Viewer's active subscription tier for each featured creator, so the client
  // can render the exact subscribed state (Subscribed vs Subscribe) without a
  // second request per creator.
  const viewerSubMap = new Map<string, string | null>();
  if (userId && creatorIds.length > 0) {
    const viewerSubRows = await db
      .select({ creator_id: subscriptions.creator_id, tier: subscriptions.tier })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.subscriber_id, userId),
          eq(subscriptions.status, "active"),
          inArray(subscriptions.creator_id, creatorIds),
        ),
      );
    for (const r of viewerSubRows) viewerSubMap.set(r.creator_id, r.tier ?? null);
  }

  // Presence for featured creators (online = device seen within 10 minutes).
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const onlineRows =
    creatorIds.length > 0
      ? await db
          .select({ user_id: devices.user_id })
          .from(devices)
          .where(
            and(
              inArray(devices.user_id, creatorIds),
              gte(devices.last_seen_at, tenMinutesAgo),
            ),
          )
          .groupBy(devices.user_id)
      : [];
  const onlineSet = new Set(onlineRows.map((r) => r.user_id));

  // Privacy: accounts that turned off Online Status / Activity Status are
  // never reported as online, regardless of device activity (server-enforced).
  const hiddenPresenceRows =
    creatorIds.length > 0
      ? await db
          .select({ user_id: user_settings.user_id })
          .from(user_settings)
          .where(
            and(
              inArray(user_settings.user_id, creatorIds),
              or(eq(user_settings.online_status, false), eq(user_settings.activity_status, false)),
            ),
          )
      : [];
  for (const r of hiddenPresenceRows) onlineSet.delete(r.user_id);

  return ok({
    // Main paginated items (exactly limit rows, global engagement ranking)
    items,
    // Per-type slices derived from items (legacy compat keys)
    posts:  items.filter((i) => i.content_type === "post"),
    videos: items.filter((i) => i.content_type === "video"),
    shorts: items.filter((i) => i.content_type === "short"),
    // Supplementary sections (not part of main pagination)
    albums: builtAlbums,
    users:  creatorRows.map((u) => ({
      id:                  u.id,
      name:                u.full_name,
      full_name:           u.full_name,
      username:            u.username,
      avatar_url:          u.avatar_url,
      avatarUrl:           u.avatar_url,
      banner_url:          u.banner_url,
      bannerUrl:           u.banner_url,
      bio:                 u.bio,
      is_verified:         u.is_verified,
      isVerified:          u.is_verified,
      is_creator:          u.is_creator,
      is_verified_creator: u.is_verified_creator,
      category:            u.category ?? null,
      is_online:           onlineSet.has(u.id),
      isOnline:            onlineSet.has(u.id),
      subscriber_count:    subCountMap.get(u.id) ?? 0,
      subscriberCount:     subCountMap.get(u.id) ?? 0,
      subscribed_to_creator: viewerSubMap.has(u.id),
      subscribedToCreator:   viewerSubMap.has(u.id),
      subscription_tier:     viewerSubMap.get(u.id) ?? null,
      subscriptionTier:      viewerSubMap.get(u.id) ?? null,
    })),
    // Pagination metadata
    page,
    limit,
    has_more:   hasMore,
    hasMore,
    next_page:  hasMore ? page + 1 : null,
    nextPage:   hasMore ? page + 1 : null,
    next_cursor: hasMore ? String(page + 1) : null,
    nextCursor:  hasMore ? String(page + 1) : null,
  });
}
