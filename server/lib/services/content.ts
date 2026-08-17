import { and, eq, isNull, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { muted_users, blocked_users, hidden_posts, feed_impressions } from "@/lib/db/schema";

/**
 * Shared helpers for building video / short / comment response shapes.
 * Used by /api/videos/* and /api/shorts/* routes.
 */

// ─── Tier helpers ────────────────────────────────────────────────────────────

// Content tiers: free (public) → subscriber → subscriber_plus (most exclusive)
export const TIER_ORDER = ["free", "subscriber", "subscriber_plus"] as const;
export type ContentTier = typeof TIER_ORDER[number];
// Subscription tiers (what a subscriber holds): subscriber or subscriber_plus
export type SubscriptionTier = "subscriber" | "subscriber_plus";

/** Returns the numeric rank of a tier (higher = more access). -1 means no tier/unknown. */
/**
 * IDs of creators the viewer has muted or blocked — their content is excluded
 * from every feed (Hide Creator / Block persist server-side).
 */
export async function getHiddenCreatorIds(userId: string): Promise<string[]> {
  const [muted, blocked] = await Promise.all([
    db
      .select({ id: muted_users.muted_id })
      .from(muted_users)
      .where(eq(muted_users.muter_id, userId)),
    db
      .select({ id: blocked_users.blocked_id })
      .from(blocked_users)
      .where(eq(blocked_users.blocker_id, userId)),
  ]);
  return [...new Set([...muted.map((m) => m.id), ...blocked.map((b) => b.id)])];
}

/**
 * IDs of posts the viewer has explicitly hidden (Not Interested) — excluded
 * from feeds server-side so they don't reappear after a refresh.
 */
export async function getHiddenPostIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: hidden_posts.post_id })
    .from(hidden_posts)
    .where(eq(hidden_posts.user_id, userId));
  return rows.map((r) => r.id);
}

// ─── Feed ranking (server-authoritative, pure-SQL) ──────────────────────────
//
// Replaces chronological ordering. The score blends four signals so the feed
// behaves like modern discovery platforms:
//
//   1. popularity  — capped engagement points (like/comment/save/share/view).
//      The cap is the log-like dampener: an old viral post's raw counts stop
//      dominating past a ceiling, so it can't lock out everything forever.
//   2. engagement rate — interactions per view (capped). Small-but-loved
//      content ranks, and opening a video without watching can't inflate it
//      (the platform's 60s/90% view rule feeds view_count, so raw "opened"
//      events are not a ranking lever).
//   3. freshness — 1/(1+age_days): newest content gets a real but bounded
//      boost (≈5 at creation, ≈0.6 after a week) so new creators/posts can
//      surface without freshness being the whole ranking.
//   4. subscription boost — subscribed creators' content ranks slightly
//      higher for that viewer (personalization).
//   5. exploration jitter — a deterministic per-(user, post) term ∈ [0,0.8]
//      so different users see different (but per-user stable, pagination-safe)
//      rankings, and less-exposed content occasionally edges in.
//
// Everything is pure SQLite arithmetic (no log/exp needed), fully
// deterministic per user, and the same expression is reused for ordering,
// cursor comparison and the projected `rank_score` column. Fresh calls create
// fresh parameter instances so drizzle/libsql never shares bound params.

export function feedRankScore(userId: string | null): SQL {
  const seed = userId
    ? [...userId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1_000_003, 17)
    : 7;
  const subBoost = userId
    ? sql`CASE WHEN EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.subscriber_id = ${userId}
          AND s.creator_id = posts.creator_id
          AND s.status = 'active'
      ) THEN 1.2 ELSE 0 END`
    : sql`0`;
  return sql`(
    min(
      COALESCE(posts.like_count, 0) * 2
      + COALESCE(posts.comment_count, 0) * 4
      + COALESCE(posts.save_count, 0) * 3
      + COALESCE(posts.share_count, 0) * 3
      + COALESCE(posts.view_count, 0) * 0.02,
      60
    ) * 0.45
    + min(
      (
        COALESCE(posts.like_count, 0)
        + COALESCE(posts.comment_count, 0)
        + COALESCE(posts.save_count, 0)
        + COALESCE(posts.share_count, 0)
      ) * 100.0 / max(COALESCE(posts.view_count, 0), 10),
      100
    ) * 0.30
    + (1.0 / (1.0 + (julianday('now') - julianday(COALESCE(posts.published_at, posts.created_at))))) * 5.0
    + ${subBoost}
    + abs(((posts.rowid % 100000) * 48271 + ${seed}) % 1000) / 1000.0 * 0.8
  )`;
}

/**
 * Posts this account has been served in discovery feeds within the window.
 * Feed dedup: content can resurface after the window, when the viewer
 * subscribes to the creator, or when they own it.
 */
export async function recentlySeenPostIds(
  userId: string,
  hours = 24,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = await db
    .select({ post_id: feed_impressions.post_id })
    .from(feed_impressions)
    .where(and(eq(feed_impressions.user_id, userId), sql`${feed_impressions.seen_at} > ${cutoff}`));
  return rows.map((r) => r.post_id);
}

/**
 * SQL exclusion for feed dedup — returns undefined for anonymous viewers.
 * Excludes posts seen within the window UNLESS the viewer owns them or is
 * subscribed to the creator (subscribed content always repeats by design).
 */
export function feedDedupClause(userId: string, hours = 24): SQL {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  return sql`(
    NOT EXISTS (
      SELECT 1 FROM feed_impressions fi
      WHERE fi.user_id = ${userId}
        AND fi.post_id = posts.id
        AND fi.seen_at > ${cutoff}
    )
    OR posts.creator_id = ${userId}
    OR EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.subscriber_id = ${userId}
        AND s.creator_id = posts.creator_id
        AND s.status = 'active'
    )
  )`;
}

// SQLite fails at statement PREPARE when a table is missing, so a guard inside
// the WHERE can't protect pre-migration deployments. Instead we check once per
// process whether feed_impressions exists and only apply the dedup clause when
// it does — feeds keep working (with dedup off) before the migration runs.
let _feedDedupAvailable: boolean | null = null;

async function isFeedDedupAvailable(): Promise<boolean> {
  if (_feedDedupAvailable !== null) return _feedDedupAvailable;
  try {
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'feed_impressions' LIMIT 1`,
    );
    _feedDedupAvailable = (rows?.length ?? 0) > 0;
  } catch {
    _feedDedupAvailable = false;
  }
  return _feedDedupAvailable;
}

/**
 * Feed-dedup WHERE clause for the viewer, or undefined when dedup isn't
 * available yet (table missing pre-migration or anonymous viewer).
 */
export async function getFeedDedupClause(
  userId: string | null,
  hours = 24,
): Promise<SQL | undefined> {
  if (!userId) return undefined;
  if (!(await isFeedDedupAvailable())) return undefined;
  return feedDedupClause(userId, hours);
}

/**
 * Record that a set of posts was served to a viewer (idempotent; refreshes
 * seen_at on repeat serves via the unique user+post constraint). Fire-and-
 * forget from routes — never blocks the feed response.
 */
export async function recordFeedImpressions(
  userId: string | null,
  postIds: string[],
): Promise<void> {
  if (!userId || postIds.length === 0) return;
  const now = new Date().toISOString();
  await db
    .insert(feed_impressions)
    .values(
      postIds.map((id) => ({
        id: `${userId}_${id}`,
        user_id: userId,
        post_id: id,
        seen_at: now,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Soft creator diversity for a page of ranked rows. Keeps the ranked order as
 * much as possible while (a) capping runs of the same creator and (b) capping
 * any single creator's share of the page — one creator can never monopolize a
 * feed. Fully deterministic (same ranked input → same page).
 */
export function applyCreatorDiversity<T extends { creator_id: string }>(
  rows: T[],
  maxConsecutive = 2,
  maxShare = 0.5,
): T[] {
  if (rows.length <= 2) return rows;
  const cap = Math.max(1, Math.round(rows.length * maxShare));
  const counts = new Map<string, number>();
  const out: T[] = [];
  const deferred: T[] = [];
  for (const row of rows) {
    const creator = row.creator_id;
    const seen = counts.get(creator) ?? 0;
    if (seen >= cap) {
      deferred.push(row);
      continue;
    }
    const tail = out.slice(-maxConsecutive);
    if (tail.length === maxConsecutive && tail.every((r) => r.creator_id === creator)) {
      deferred.push(row);
      continue;
    }
    out.push(row);
    counts.set(creator, seen + 1);
  }
  return [...out, ...deferred];
}

export function tierIndex(tier: string | null | undefined): number {
  if (!tier) return -1;
  return TIER_ORDER.indexOf(tier as ContentTier);
}

/**
 * Returns true if the subscriber's tier is sufficient to view content
 * that requires `requiredTier`.
 *
 * Rules:
 *   - No required tier, or "free" → always accessible
 *   - subscriber_plus content → only subscriber_plus holders can view
 *   - subscriber content → any subscription (subscriber or subscriber_plus)
 */
export function hasTierAccess(
  subscriptionTier: string | null | undefined,
  requiredTier: string | null | undefined,
): boolean {
  if (!requiredTier || requiredTier === "free") return true;
  if (!subscriptionTier) return false;
  return tierIndex(subscriptionTier) >= tierIndex(requiredTier);
}

/**
 * Full access check combining visibility + tier.
 *
 * Tier model:
 *   - "free"  content (or public visibility, no tier): visible to everyone
 *   - "subscriber" content: any active subscriber can view
 *   - "subscriber_plus" content: only subscriber_plus tier holders can view
 *
 * @param visibility       "public" | "subscribers" | "draft"
 * @param requiredTier     tier stored on the post: "free" | "subscriber" | "subscriber_plus" | null
 * @param isSubscribed     whether the viewer has an active subscription to this creator
 * @param subscriptionTier the viewer's subscription tier ("subscriber" | "subscriber_plus" | null)
 * @param isOwner          whether the viewer is the content creator
 */
export function canViewContent(
  visibility: string,
  requiredTier: string | null | undefined,
  isSubscribed: boolean,
  subscriptionTier: string | null | undefined,
  isOwner: boolean,
): boolean {
  if (isOwner) return true;
  if (visibility === "draft") return false;

  // "free" tier or public with no tier → visible to everyone
  if (requiredTier === "free" || (visibility === "public" && !requiredTier)) return true;

  // Any subscriber-gated content requires an active subscription
  if (!isSubscribed) return false;

  // subscriber_plus content: must hold a subscriber_plus subscription
  if (requiredTier === "subscriber_plus") {
    return subscriptionTier === "subscriber_plus";
  }

  // "subscriber" content: any active subscription qualifies
  return true;
}

/**
 * Build a SQL WHERE condition selecting only the posts a viewer may see on a
 * creator profile, mirroring canViewContent() exactly:
 *   - owner: everything (the caller skips this condition for the owner)
 *   - free content (tier "free", or public visibility with no tier): everyone
 *   - subscriber content: any active subscription
 *   - subscriber_plus content: subscriber_plus holders only
 * A non-subscriber therefore only ever receives free content — subscriber-gated
 * rows are excluded from the list entirely (metadata included).
 */
export function visibleContentCondition(
  visibilityCol: AnyColumn,
  tierCol: AnyColumn,
  isSubscribed: boolean,
  subTier: string | null,
) {
  const notDraft = ne(visibilityCol, "draft");
  const free = or(
    eq(tierCol, "free"),
    and(eq(visibilityCol, "public"), isNull(tierCol)),
  );

  if (!isSubscribed) {
    return and(notDraft, free);
  }

  const subscriberGated = or(
    eq(tierCol, "subscriber"),
    and(eq(visibilityCol, "subscribers"), isNull(tierCol)),
  );

  if (subTier === "subscriber_plus") {
    return and(notDraft, or(free, subscriberGated, eq(tierCol, "subscriber_plus")));
  }

  return and(notDraft, or(free, subscriberGated));
}

// ─── Grouping helper ─────────────────────────────────────────────────────────

/** Groups media rows by post_id. Avoids self-referential type inference issues with reduce. */
export function groupMediaByPost<T extends { post_id: string | null }>(
  mediaRows: T[],
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const m of mediaRows) {
    if (!m.post_id) continue;
    if (!result[m.post_id]) result[m.post_id] = [];
    result[m.post_id].push(m);
  }
  return result;
}

// ─── Row interfaces ──────────────────────────────────────────────────────────

interface MediaRow {
  id: string;
  url: string;
  type: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  sort_order: number;
}

interface PostRow {
  id: string;
  creator_id: string;
  title?: string | null;
  caption?: string | null;
  description?: string | null;
  visibility: string;
  tier?: string | null;
  thumbnail_url?: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count?: number | null;
  created_at: string;
  published_at?: string | null;
  creator_username: string | null;
  creator_display_name: string | null;
  creator_avatar: string | null;
  creator_is_verified: boolean | null;
}

interface CommentRow {
  id: string;
  body: string;
  like_count: number;
  reply_count?: number | null;
  is_pinned?: boolean | null;
  created_at: string;
  author_id?: string | null;
  author_name?: string | null;
  author_username?: string | null;
  author_avatar?: string | null;
  author_is_verified?: boolean | null;
}

// ─── Row builders ────────────────────────────────────────────────────────────

function buildCreator(row: PostRow) {
  return {
    id: row.creator_id,
    name: row.creator_display_name ?? row.creator_username ?? "Creator",
    username: row.creator_username ?? "",
    avatarUrl: row.creator_avatar ?? null,
    avatar_url: row.creator_avatar ?? null,
    isVerified: Boolean(row.creator_is_verified),
    is_verified: Boolean(row.creator_is_verified),
  };
}

/**
 * Playable quality variants for a video, derived from server-side media
 * metadata (the authoritative source — the client never invents qualities).
 *
 * Today the platform stores a single source file (no transcoding pipeline),
 * so the list contains exactly one "Auto" entry pointing at the original;
 * the player only shows a quality selector when a future transcoding
 * pipeline provides more than one variant. Locked content returns [] so no
 * media URL ever leaks to unauthorized callers.
 */
export function buildQualities(
  primary: MediaRow | undefined,
  isLocked: boolean,
): Array<{ label: string; url: string; height: number | null }> {
  if (!primary?.url || isLocked) return [];
  return [{
    label: "Auto",
    url: primary.url,
    height: primary.height ?? null,
  }];
}

export function buildVideoRow(
  row: PostRow,
  mediaRows: MediaRow[],
  likedByMe: boolean,
  subscribedToCreator: boolean,
  previewComments: CommentRow[] = [],
  subscriptionTier?: string | null,
  isOwner = false,
) {
  const sorted = [...mediaRows].sort((a, b) => a.sort_order - b.sort_order);
  const primary = sorted[0];
  const creator = buildCreator(row);
  // Media dimensions let the player size itself instantly (no layout jump
  // waiting for the first frame) and let feed cards keep the real aspect ratio.
  const mediaWidth = primary?.width ?? null;
  const mediaHeight = primary?.height ?? null;

  // Post-level thumbnail takes priority; fall back to media-level thumbnail
  const thumbnailUrl = row.thumbnail_url ?? primary?.thumbnail_url ?? null;
  const isLocked = !canViewContent(
    row.visibility,
    row.tier,
    subscribedToCreator,
    subscriptionTier ?? null,
    isOwner,
  );

  return {
    id: row.id,
    content_type: "video" as const,
    contentType: "video" as const,
    // Flat creator fields — kept at the top level (in addition to the nested
    // `creator` object) so client normalizers that read creator_id /
    // creator_username / creator_display_name / creator_avatar / creator_is_verified
    // (Explore previews and normalizePost) can resolve the author. Dropping these
    // is what caused video posts to be excluded from Explore and video authors to
    // render as "Anonymous".
    creator_id: row.creator_id,
    creatorId: row.creator_id,
    creator_username: row.creator_username,
    creatorUsername: row.creator_username,
    creator_display_name: row.creator_display_name,
    creatorDisplayName: row.creator_display_name,
    creator_avatar: row.creator_avatar,
    creatorAvatar: row.creator_avatar,
    creator_is_verified: Boolean(row.creator_is_verified),
    creatorIsVerified: Boolean(row.creator_is_verified),
    title: row.title ?? row.caption ?? "",
    description: row.description ?? row.caption ?? "",
    caption: row.caption ?? null,
    tier: row.tier ?? null,
    thumbnail_url: thumbnailUrl,
    thumbnailUrl,
    // Omit media URLs when content is locked so subscriber-only content
    // cannot be accessed by unauthenticated / non-subscribed callers.
    video_url: isLocked ? null : (primary?.url ?? null),
    videoUrl: isLocked ? null : (primary?.url ?? null),
    duration_secs: primary?.duration_seconds ?? 0,
    durationSecs: primary?.duration_seconds ?? 0,
    width: mediaWidth,
    height: mediaHeight,
    // Server-authoritative playable qualities (single Auto entry today; the
    // player shows a selector only when multiple variants exist).
    qualities: buildQualities(primary, isLocked),
    view_count: row.view_count,
    viewCount: row.view_count,
    like_count: row.like_count,
    likeCount: row.like_count,
    comment_count: row.comment_count,
    commentCount: row.comment_count,
    share_count: row.share_count ?? 0,
    shareCount: row.share_count ?? 0,
    is_locked: isLocked,
    isLocked,
    liked_by_me: likedByMe,
    likedByMe,
    subscribed_to_creator: subscribedToCreator,
    subscribedToCreator,
    subscription_tier: subscriptionTier ?? null,
    subscriptionTier: subscriptionTier ?? null,
    created_at: row.created_at,
    createdAt: row.created_at,
    published_at: row.published_at ?? row.created_at,
    creator,
    comments_preview: previewComments.map((c) => buildComment(c, null)),
    commentsPreview: previewComments.map((c) => buildComment(c, null)),
    media: isLocked ? [] : sorted.map((m) => ({
      url: m.url,
      type: m.type,
      thumbnail_url: m.thumbnail_url,
      duration_secs: m.duration_seconds,
      width: m.width ?? null,
      height: m.height ?? null,
    })),
  };
}

export function buildShortRow(
  row: PostRow,
  mediaRows: MediaRow[],
  likedByMe: boolean,
  subscribedToCreator: boolean,
  subscriptionTier?: string | null,
  isOwner = false,
) {
  const sorted = [...mediaRows].sort((a, b) => a.sort_order - b.sort_order);
  // A short's playable URL must be a video row, not a thumbnail/image row that
  // happens to sort first. Prefer the first video media; fall back to the
  // first row only when no video exists.
  const primary = sorted.find((m) => m.type === "video") ?? sorted[0];
  const creator = buildCreator(row);
  const mediaWidth = primary?.width ?? null;
  const mediaHeight = primary?.height ?? null;

  // Post-level thumbnail takes priority; fall back to media-level thumbnail
  const thumbnailUrl = row.thumbnail_url ?? primary?.thumbnail_url ?? null;
  const isLocked = !canViewContent(
    row.visibility,
    row.tier,
    subscribedToCreator,
    subscriptionTier ?? null,
    isOwner,
  );

  return {
    id: row.id,
    content_type: "short" as const,
    contentType: "short" as const,
    // Flat creator fields (see buildVideoRow) so client normalizers can resolve
    // the author from a short row without relying on the nested `creator` object.
    creator_id: row.creator_id,
    creatorId: row.creator_id,
    creator_username: row.creator_username,
    creatorUsername: row.creator_username,
    creator_display_name: row.creator_display_name,
    creatorDisplayName: row.creator_display_name,
    creator_avatar: row.creator_avatar,
    creatorAvatar: row.creator_avatar,
    creator_is_verified: Boolean(row.creator_is_verified),
    creatorIsVerified: Boolean(row.creator_is_verified),
    caption: row.caption ?? row.title ?? "",
    tier: row.tier ?? null,
    thumbnail_url: thumbnailUrl,
    thumbnailUrl,
    // Omit media URLs when content is locked so subscriber-only content
    // cannot be accessed by unauthenticated / non-subscribed callers.
    video_url: isLocked ? null : (primary?.url ?? null),
    videoUrl: isLocked ? null : (primary?.url ?? null),
    duration_secs: primary?.duration_seconds ?? 0,
    durationSecs: primary?.duration_seconds ?? 0,
    width: mediaWidth,
    height: mediaHeight,
    // Server-authoritative playable qualities (single Auto entry today; the
    // player shows a selector only when multiple variants exist).
    qualities: buildQualities(primary, isLocked),
    view_count: row.view_count,
    viewCount: row.view_count,
    like_count: row.like_count,
    likeCount: row.like_count,
    comment_count: row.comment_count,
    commentCount: row.comment_count,
    share_count: row.share_count ?? 0,
    shareCount: row.share_count ?? 0,
    is_locked: isLocked,
    isLocked,
    liked_by_me: likedByMe,
    likedByMe,
    subscribed_to_creator: subscribedToCreator,
    subscribedToCreator,
    subscription_tier: subscriptionTier ?? null,
    subscriptionTier: subscriptionTier ?? null,
    created_at: row.created_at,
    createdAt: row.created_at,
    creator,
    media: isLocked ? [] : sorted.map((m) => ({
      url: m.url,
      type: m.type,
      thumbnail_url: m.thumbnail_url,
      duration_secs: m.duration_seconds,
      width: m.width ?? null,
      height: m.height ?? null,
    })),
  };
}

export function buildComment(row: CommentRow, _viewerUserId: string | null) {
  return {
    id: row.id,
    body: row.body,
    like_count: row.like_count,
    likeCount: row.like_count,
    reply_count: row.reply_count ?? 0,
    replyCount: row.reply_count ?? 0,
    is_pinned: Boolean(row.is_pinned),
    created_at: row.created_at,
    createdAt: row.created_at,
    author: {
      id: row.author_id ?? "",
      name: row.author_name ?? row.author_username ?? "User",
      username: row.author_username ?? "",
      avatarUrl: row.author_avatar ?? null,
      avatar_url: row.author_avatar ?? null,
      isVerified: Boolean(row.author_is_verified),
      is_verified: Boolean(row.author_is_verified),
    },
  };
}
