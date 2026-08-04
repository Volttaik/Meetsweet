/**
 * Shared helpers for building video / short / comment response shapes.
 * Used by /api/videos/* and /api/shorts/* routes.
 */

// ─── Tier helpers ────────────────────────────────────────────────────────────

export const TIER_ORDER = ["bronze", "silver", "gold", "diamond"] as const;
export type ContentTier = typeof TIER_ORDER[number];

/** Returns the numeric rank of a tier (higher = more access). -1 means no tier. */
export function tierIndex(tier: string | null | undefined): number {
  if (!tier) return -1;
  return TIER_ORDER.indexOf(tier as ContentTier);
}

/**
 * Returns true if the subscriber's tier is sufficient to view content
 * that requires `requiredTier`.
 *
 * Rules:
 *   - No required tier → always accessible (subscription still required if visibility = "subscribers")
 *   - Required tier set but subscriber has no tier → locked
 *   - Subscriber tier index >= required tier index → accessible
 */
export function hasTierAccess(
  subscriptionTier: string | null | undefined,
  requiredTier: string | null | undefined,
): boolean {
  if (!requiredTier) return true;
  if (!subscriptionTier) return false;
  return tierIndex(subscriptionTier) >= tierIndex(requiredTier);
}

/**
 * Full access check combining visibility + tier.
 *
 * @param visibility  "public" | "subscribers" | "draft"
 * @param requiredTier  tier stored on the post (may be null)
 * @param isSubscribed  whether the viewer has an active subscription to this creator
 * @param subscriptionTier  the tier of that subscription (may be null)
 * @param isOwner  whether the viewer is the content creator
 *
 * Tier enforcement notes:
 *   - The mobile app currently subscribes without sending a tier (flat subscription model).
 *   - When `subscriptionTier` is null/undefined but the user IS subscribed, we grant access
 *     to ALL subscriber content regardless of `requiredTier` — matching the current mobile UX.
 *   - Once the mobile sends a tier on subscribe, set `subscriptionTier` to that value and
 *     this function will enforce proper tier gating automatically.
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
  // Public content with no tier gate → everyone can view
  if (visibility === "public" && !requiredTier) return true;
  // Any subscriber-gated or tiered content requires an active subscription first
  if (!isSubscribed) return false;
  // Subscribed with no stored tier → flat subscription; grant access to all subscriber content
  if (!subscriptionTier) return true;
  // Subscribed with a stored tier → enforce tier hierarchy
  return hasTierAccess(subscriptionTier, requiredTier);
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
  unlock_price?: number | null;
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

export function buildVideoRow(
  row: PostRow,
  mediaRows: MediaRow[],
  likedByMe: boolean,
  subscribedToCreator: boolean,
  previewComments: CommentRow[] = [],
  subscriptionTier?: string | null,
) {
  const sorted = [...mediaRows].sort((a, b) => a.sort_order - b.sort_order);
  const primary = sorted[0];
  const creator = buildCreator(row);

  // Post-level thumbnail takes priority; fall back to media-level thumbnail
  const thumbnailUrl = row.thumbnail_url ?? primary?.thumbnail_url ?? null;
  const isLocked = !canViewContent(
    row.visibility,
    row.tier,
    subscribedToCreator,
    subscriptionTier ?? null,
    false,
  );

  return {
    id: row.id,
    content_type: "video" as const,
    contentType: "video" as const,
    title: row.title ?? row.caption ?? "",
    description: row.description ?? row.caption ?? "",
    caption: row.caption ?? null,
    tier: row.tier ?? null,
    thumbnail_url: thumbnailUrl,
    thumbnailUrl,
    video_url: primary?.url ?? null,
    videoUrl: primary?.url ?? null,
    duration_secs: primary?.duration_seconds ?? 0,
    durationSecs: primary?.duration_seconds ?? 0,
    view_count: row.view_count,
    viewCount: row.view_count,
    like_count: row.like_count,
    likeCount: row.like_count,
    comment_count: row.comment_count,
    commentCount: row.comment_count,
    share_count: row.share_count ?? 0,
    shareCount: row.share_count ?? 0,
    is_premium: row.visibility === "subscribers" || !!row.tier,
    isPremium: row.visibility === "subscribers" || !!row.tier,
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
    media: sorted.map((m) => ({
      url: m.url,
      type: m.type,
      thumbnail_url: m.thumbnail_url,
      duration_secs: m.duration_seconds,
    })),
  };
}

export function buildShortRow(
  row: PostRow,
  mediaRows: MediaRow[],
  likedByMe: boolean,
  subscribedToCreator: boolean,
  subscriptionTier?: string | null,
) {
  const sorted = [...mediaRows].sort((a, b) => a.sort_order - b.sort_order);
  const primary = sorted[0];
  const creator = buildCreator(row);

  // Post-level thumbnail takes priority; fall back to media-level thumbnail
  const thumbnailUrl = row.thumbnail_url ?? primary?.thumbnail_url ?? null;
  const isLocked = !canViewContent(
    row.visibility,
    row.tier,
    subscribedToCreator,
    subscriptionTier ?? null,
    false,
  );

  return {
    id: row.id,
    content_type: "short" as const,
    contentType: "short" as const,
    caption: row.caption ?? row.title ?? "",
    tier: row.tier ?? null,
    thumbnail_url: thumbnailUrl,
    thumbnailUrl,
    video_url: primary?.url ?? null,
    videoUrl: primary?.url ?? null,
    duration_secs: primary?.duration_seconds ?? 0,
    durationSecs: primary?.duration_seconds ?? 0,
    view_count: row.view_count,
    viewCount: row.view_count,
    like_count: row.like_count,
    likeCount: row.like_count,
    comment_count: row.comment_count,
    commentCount: row.comment_count,
    share_count: row.share_count ?? 0,
    shareCount: row.share_count ?? 0,
    is_premium: row.visibility === "subscribers" || !!row.tier,
    isPremium: row.visibility === "subscribers" || !!row.tier,
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
    media: sorted.map((m) => ({
      url: m.url,
      type: m.type,
      thumbnail_url: m.thumbnail_url,
      duration_secs: m.duration_seconds,
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
