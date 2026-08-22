import { NextRequest } from "next/server";
import { eq, and, count, inArray, gte, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, subscriptions, creator_settings, devices, user_settings } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { resolveBasePrice } from "@/lib/services/pricing";

/**
 * GET /api/creators
 *
 * Creator list for discovery surfaces (home "Top Creators", new-user welcome).
 * Returns the same authoritative pricing + subscriber counts as
 * GET /creators/[id] so a creator's price is never hardcoded or divergent
 * between screens.
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50)), 100);

  const creatorRows = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      avatar_url: profiles.avatar_url,
      bio: profiles.bio,
      is_verified: users.is_verified,
      is_creator: users.is_creator,
      is_verified_creator: profiles.is_verified_creator,
      category: profiles.category,
      profile_price: profiles.subscription_price,
      settings_price: creator_settings.subscription_price,
      settings_plus_price: creator_settings.subscription_plus_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .leftJoin(creator_settings, eq(creator_settings.user_id, users.id))
    .where(and(eq(users.is_creator, true), eq(users.is_active, true), isNull(users.deleted_at)))
    .limit(limit);

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

  // Presence: online = a device seen within the last 10 minutes.
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

  // Per-viewer subscription state — LIVE server data, so Explore never shows a
  // stale "Subscribe" button for a user who already subscribed (even after a
  // refresh or a new session). The client normalizer reads
  // `subscribed_to_creator` / `subscription_tier` from this same response.
  const viewer = (await optionalAuth(req))?.userId ?? null;
  const viewerSubRows =
    viewer && creatorIds.length > 0
      ? await db
          .select({
            creator_id: subscriptions.creator_id,
            tier: subscriptions.tier,
          })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.subscriber_id, viewer),
              inArray(subscriptions.creator_id, creatorIds),
              eq(subscriptions.status, "active"),
            ),
          )
      : [];
  const viewerSubMap = new Map(
    viewerSubRows.map((r) => [r.creator_id, r.tier ?? "subscriber"]),
  );

  const creators = creatorRows.map((u) => {
    // Same pricing resolution as GET /creators/[id] and the subscribe route, so
    // the advertised price is always the same single source of truth.
    const basePrice = resolveBasePrice(u.settings_price, u.profile_price);
    const plusPrice = Math.round(u.settings_plus_price ?? basePrice * 2);
    return {
      id: u.id,
      name: u.full_name,
      full_name: u.full_name,
      username: u.username,
      avatar_url: u.avatar_url,
      avatarUrl: u.avatar_url,
      bio: u.bio,
      is_verified: u.is_verified,
      isVerified: u.is_verified,
      is_creator: u.is_creator,
      is_verified_creator: u.is_verified_creator,
      category: u.category ?? null,
      is_online: onlineSet.has(u.id),
      isOnline: onlineSet.has(u.id),
      subscriber_count: subCountMap.get(u.id) ?? 0,
      subscriberCount: subCountMap.get(u.id) ?? 0,
      subscription_price: basePrice,
      subscriptionPrice: basePrice,
      subscription_plus_price: plusPrice,
      subscriptionPlusPrice: plusPrice,
      // Viewing user's own subscription state for this creator (undefined for
      // anonymous visitors).
      subscribed_to_creator: viewerSubMap.has(u.id),
      subscribedToCreator: viewerSubMap.has(u.id),
      subscription_tier: viewerSubMap.get(u.id) ?? null,
      subscriptionTier: viewerSubMap.get(u.id) ?? null,
    };
  });

  // "Top creators" = highest active-subscriber count first.
  creators.sort((a, b) => b.subscriber_count - a.subscriber_count);

  return ok({ creators });
}
