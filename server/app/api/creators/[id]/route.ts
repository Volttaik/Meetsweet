import { NextRequest } from "next/server";
import { eq, and, count, sum, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, follows, subscriptions, posts, creator_settings, albums } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

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
      subscription_price: profiles.subscription_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(and(condition, eq(users.is_active, true)))
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

  // Is the viewer following / subscribed?
  const [isFollowing, isSubscribed] =
    userId
      ? await Promise.all([
          db.select({ id: follows.id }).from(follows)
            .where(and(eq(follows.follower_id, userId), eq(follows.following_id, user.id)))
            .then((r) => r.length > 0),
          db.select({ id: subscriptions.id }).from(subscriptions)
            .where(and(eq(subscriptions.subscriber_id, userId), eq(subscriptions.creator_id, user.id), eq(subscriptions.status, "active")))
            .then((r) => r.length > 0),
        ])
      : [false, false];

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
    category: null, // future: add category to profiles
    is_verified: user.is_verified_creator ?? user.is_verified,
    isVerified: user.is_verified_creator ?? user.is_verified,
    is_online: false, // future: real-time presence
    isOnline: false,
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
    subscription_price: settings?.subscription_price ?? user.subscription_price ?? 0,
    subscriptionPrice: settings?.subscription_price ?? user.subscription_price ?? 0,
    allow_dms: settings?.allow_dms ?? true,
    allow_comments: settings?.allow_comments ?? true,
    who_can_message: (settings?.who_can_message as 'everyone' | 'subscribers' | 'none') ?? 'everyone',
    is_following: isFollowing,
    isFollowing,
    is_subscribed: isSubscribed,
    isSubscribed,
    joined_at: user.created_at,
  };

  return ok({ creator });
}
