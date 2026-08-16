import { NextRequest } from "next/server";
import { eq, and, count, isNull, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, follows, subscriptions, posts, creator_settings, albums, devices } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { resolveBasePrice } from "@/lib/services/pricing";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = (await optionalAuth(req))?.userId ?? null;

  // Accept both user-id and username
  const condition = id.includes("-") && id.length > 20
    ? eq(users.id, id)
    : eq(users.username, id);

  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      full_name: users.full_name,
      is_verified: users.is_verified,
      is_creator: users.is_creator,
      created_at: users.created_at,
      display_name: profiles.display_name,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      location: profiles.location,
      is_verified_creator: profiles.is_verified_creator,
      category: profiles.category,
      subscription_price: profiles.subscription_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(and(condition, eq(users.is_active, true), isNull(users.deleted_at)))
    .limit(1);

  if (!user || !user.is_creator) return err("Creator not found", 404);

  // Counts in parallel
  const [followerCount, subscriberCount, postCount, videoCount, shortCount, albumCount, settings] =
    await Promise.all([
      db.select({ n: count() }).from(follows).where(eq(follows.following_id, user.id))
        .then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(subscriptions)
        .where(and(eq(subscriptions.creator_id, user.id), eq(subscriptions.status, "active")))
        .then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(posts)
        .where(and(eq(posts.creator_id, user.id), eq(posts.status, "published"), isNull(posts.deleted_at), eq(posts.content_type, "post")))
        .then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(posts)
        .where(and(eq(posts.creator_id, user.id), eq(posts.status, "published"), isNull(posts.deleted_at), eq(posts.content_type, "video")))
        .then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(posts)
        .where(and(eq(posts.creator_id, user.id), eq(posts.status, "published"), isNull(posts.deleted_at), eq(posts.content_type, "short")))
        .then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(albums)
        .where(and(eq(albums.creator_id, user.id), isNull(albums.deleted_at)))
        .then((r) => r[0]?.n ?? 0),
      db.select().from(creator_settings).where(eq(creator_settings.user_id, user.id)).limit(1)
        .then((r) => r[0] ?? null),
    ]);

  // Is the viewer following / subscribed? Also expose the viewer's subscription
  // tier so the client can render the exact subscribed state (subscriber vs
  // subscriber_plus) without guessing.
  const [isFollowing, subRow] =
    userId
      ? await Promise.all([
          db.select({ id: follows.id }).from(follows)
            .where(and(eq(follows.follower_id, userId), eq(follows.following_id, user.id)))
            .then((r) => r.length > 0),
          db.select({ id: subscriptions.id, tier: subscriptions.tier }).from(subscriptions)
            .where(and(eq(subscriptions.subscriber_id, userId), eq(subscriptions.creator_id, user.id), eq(subscriptions.status, "active")))
            .limit(1)
            .then((r) => r[0] ?? null),
        ])
      : [false, null];
  const isSubscribed = Boolean(subRow);
  const subscriptionTier = subRow?.tier ?? null;
  const subscriptionId = subRow?.id ?? null;

  // Presence: "online" = a device seen within the last 10 minutes. This is the
  // app's real activity signal (devices.last_seen_at is updated on push-token
  // registration / app foreground) — not a hardcoded value.
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const [recentDevice] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.user_id, user.id), gte(devices.last_seen_at, tenMinutesAgo)))
    .limit(1);
  const isOnline = Boolean(recentDevice);

  // Pricing source of truth: creator_settings, falling back to the legacy
  // profiles.subscription_price. subscriber_plus falls back to 2× the base
  // price so the client always shows the real charge (never a fake "Free").
  const basePrice = resolveBasePrice(settings?.subscription_price, user.subscription_price);
  const plusPrice = settings?.subscription_plus_price ?? Math.round(basePrice * 2);

  const creator = {
    id: user.id,
    username: user.username,
    display_name: user.display_name ?? user.full_name,
    name: user.display_name ?? user.full_name,
    bio: user.bio ?? null,
    avatar_url: user.avatar_url ?? null,
    avatarUrl: user.avatar_url ?? null,
    banner_url: user.banner_url ?? null,
    bannerUrl: user.banner_url ?? null,
    website: user.website ?? null,
    location: user.location ?? null,
    category: user.category ?? null,
    is_verified: user.is_verified_creator ?? user.is_verified,
    isVerified: user.is_verified_creator ?? user.is_verified,
    is_online: isOnline,
    isOnline,
    follower_count: followerCount,
    followerCount,
    subscriber_count: subscriberCount,
    subscriberCount,
    post_count: postCount,
    postCount,
    video_count: videoCount,
    videoCount,
    short_count: shortCount,
    shortCount,
    album_count: albumCount,
    albumCount,
    subscription_price: basePrice,
    subscriptionPrice: basePrice,
    subscription_plus_price: plusPrice,
    subscriptionPlusPrice: plusPrice,
    allow_dms: settings?.allow_dms ?? true,
    allow_comments: settings?.allow_comments ?? true,
    who_can_message: (settings?.who_can_message as 'everyone' | 'subscribers' | 'none') ?? 'everyone',
    is_following: isFollowing,
    isFollowing,
    is_subscribed: isSubscribed,
    isSubscribed,
    // Mobile normalizer reads raw.subscribed_to_creator
    subscribed_to_creator: isSubscribed,
    subscribedToCreator: isSubscribed,
    subscription_tier: subscriptionTier,
    subscriptionTier,
    // Viewer's active subscription id for this creator — lets the app offer
    // Unsubscribe from the creator profile without another lookup.
    subscription_id: subscriptionId,
    subscriptionId,
    joined_at: user.created_at,
  };

  return ok({ creator });
}
