import { eq, and, count, inArray, gte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, devices, user_settings } from "@/lib/db/schema";

/**
 * Raw creator row shape produced by discovery selects (users + profiles join).
 * Extra columns (e.g. a `relevance` score used only for ordering) are ignored.
 */
export interface CreatorRow {
  id: string;
  full_name: string | null;
  username: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  bio?: string | null;
  is_verified?: boolean | null;
  is_creator?: boolean | null;
  is_verified_creator?: boolean | null;
  category?: string | null;
}

/**
 * Enrich creator rows with live discovery data — active subscriber counts,
 * the viewer's subscription state, and online presence — and shape them into
 * the canonical `users`-list object consumed by Explore creator surfaces
 * (same contract as the featured-creators list on GET /api/explore).
 */
export async function enrichCreatorRows(
  rows: CreatorRow[],
  userId: string | null,
): Promise<Record<string, unknown>[]> {
  const ids = rows.map((u) => u.id);

  // ── Active subscriber counts (single grouped query) ─────────────────────
  const subCountRows =
    ids.length > 0
      ? await db
          .select({ creator_id: subscriptions.creator_id, n: count() })
          .from(subscriptions)
          .where(
            and(
              inArray(subscriptions.creator_id, ids),
              eq(subscriptions.status, "active"),
            ),
          )
          .groupBy(subscriptions.creator_id)
      : [];
  const subCountMap = new Map(subCountRows.map((r) => [r.creator_id, r.n]));

  // ── Viewer's active subscription tier per creator ───────────────────────
  const viewerSubMap = new Map<string, string | null>();
  if (userId && ids.length > 0) {
    const viewerSubRows = await db
      .select({ creator_id: subscriptions.creator_id, tier: subscriptions.tier })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.subscriber_id, userId),
          eq(subscriptions.status, "active"),
          inArray(subscriptions.creator_id, ids),
        ),
      );
    for (const r of viewerSubRows) viewerSubMap.set(r.creator_id, r.tier ?? null);
  }

  // ── Presence: online = a device seen within the last 10 minutes ─────────
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const onlineRows =
    ids.length > 0
      ? await db
          .select({ user_id: devices.user_id })
          .from(devices)
          .where(
            and(
              inArray(devices.user_id, ids),
              gte(devices.last_seen_at, tenMinutesAgo),
            ),
          )
          .groupBy(devices.user_id)
      : [];
  const onlineSet = new Set(onlineRows.map((r) => r.user_id));

  // Privacy: accounts that turned off Online Status / Activity Status are
  // never reported as online, regardless of device activity (server-enforced).
  const hiddenPresenceRows =
    ids.length > 0
      ? await db
          .select({ user_id: user_settings.user_id })
          .from(user_settings)
          .where(
            and(
              inArray(user_settings.user_id, ids),
              or(
                eq(user_settings.online_status, false),
                eq(user_settings.activity_status, false),
              ),
            ),
          )
      : [];
  for (const r of hiddenPresenceRows) onlineSet.delete(r.user_id);

  return rows.map((u) => ({
    id: u.id,
    name: u.full_name,
    full_name: u.full_name,
    display_name: u.display_name ?? null,
    username: u.username,
    avatar_url: u.avatar_url ?? null,
    avatarUrl: u.avatar_url ?? null,
    banner_url: u.banner_url ?? null,
    bannerUrl: u.banner_url ?? null,
    bio: u.bio ?? null,
    is_verified: Boolean(u.is_verified),
    isVerified: Boolean(u.is_verified),
    is_creator: Boolean(u.is_creator),
    is_verified_creator: Boolean(u.is_verified_creator),
    category: u.category ?? null,
    is_online: onlineSet.has(u.id),
    isOnline: onlineSet.has(u.id),
    subscriber_count: subCountMap.get(u.id) ?? 0,
    subscriberCount: subCountMap.get(u.id) ?? 0,
    subscribed_to_creator: viewerSubMap.has(u.id),
    subscribedToCreator: viewerSubMap.has(u.id),
    subscription_tier: viewerSubMap.get(u.id) ?? null,
    subscriptionTier: viewerSubMap.get(u.id) ?? null,
  }));
}
