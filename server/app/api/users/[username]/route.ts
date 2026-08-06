import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, follows, subscriptions } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const [row] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
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
    .where(eq(users.username, username))
    .limit(1);

  if (!row) return err("User not found", 404);

  // Follower / following counts
  const [followerCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(follows)
    .where(eq(follows.following_id, row.id));

  const [followingCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(follows)
    .where(eq(follows.follower_id, row.id));

  // subscriber_count: active subscriptions to this user (as a creator)
  const [subscriberCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(and(eq(subscriptions.creator_id, row.id), eq(subscriptions.status, "active")));

  // Check if requester is following (optional auth — public profile is readable by anyone)
  let isFollowing = false;
  const viewer = await optionalAuth(req);
  if (viewer?.userId) {
    const [existing] = await db
      .select({ id: follows.id })
      .from(follows)
      .where(
        and(
          eq(follows.follower_id, viewer.userId),
          eq(follows.following_id, row.id),
        ),
      )
      .limit(1);
    isFollowing = !!existing;
  }

  return ok({
    user: {
      id: row.id,
      name: row.full_name,
      username: row.username,
      bio: row.bio,
      avatar_url: row.avatar_url,
      banner_url: row.banner_url,
      website: row.website,
      location: row.location,
      is_verified: row.is_verified,
      is_creator: row.is_creator,
      is_verified_creator: row.is_verified_creator,
      subscription_price: row.subscription_price,
      follower_count: followerCount?.count ?? 0,
      following_count: followingCount?.count ?? 0,
      subscriber_count: subscriberCount?.count ?? 0,
      created_at: row.created_at,
    },
    isFollowing,
  });
}
