import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, follows, subscriptions, creator_settings, user_settings } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { resolveBasePrice } from "@/lib/services/pricing";

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
      settings_price: creator_settings.subscription_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .leftJoin(creator_settings, eq(creator_settings.user_id, users.id))
    // Deleted / deactivated accounts are not resolvable by username — a
    // hard-deleted account's row is gone, and soft-deleted legacy rows return
    // 404 so a deleted profile can never be viewed through a direct link.
    .where(and(eq(users.username, username), eq(users.is_active, true), isNull(users.deleted_at)))
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
  const isOwner = viewer?.userId === row.id;
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

  // ── Profile Visibility — enforced server-side, not just hidden on the client.
  // "nobody" hides the profile from everyone but the owner; "subscribers" shows
  // the full profile only to active subscribers (and the owner) — everyone else
  // gets a minimal shell. The owner always sees their own full profile.
  const [settings] = await db
    .select({ profile_visibility: user_settings.profile_visibility, private_account: user_settings.private_account })
    .from(user_settings)
    .where(eq(user_settings.user_id, row.id))
    .limit(1);
  const profileVisibility = settings?.profile_visibility ?? "everyone";
  const isPrivateAccount = settings?.private_account === true;

  if (!isOwner && profileVisibility === "nobody") {
    return err("User not found", 404);
  }

  let canViewFull = true;
  if (!isOwner && profileVisibility === "subscribers") {
    const [sub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.subscriber_id, viewer?.userId ?? ""),
          eq(subscriptions.creator_id, row.id),
          eq(subscriptions.status, "active"),
        ),
      )
      .limit(1);
    canViewFull = Boolean(viewer?.userId && sub);
  }

  // Same pricing resolution as /creators/:id — the authoritative price is
  // creator_settings, falling back to the legacy profiles value.
  const basePrice = resolveBasePrice(row.settings_price, row.subscription_price);

  if (!canViewFull) {
    // Limited profile shell for non-subscribers.
    return ok({
      user: {
        id: row.id,
        name: row.full_name,
        username: row.username,
        avatar_url: row.avatar_url,
        is_verified: row.is_verified,
        is_creator: row.is_creator,
        is_private: true,
        private_account: isPrivateAccount,
        content_locked: true,
      },
      isFollowing,
    });
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
      subscription_price: basePrice,
      subscriptionPrice: basePrice,
      follower_count: followerCount?.count ?? 0,
      following_count: followingCount?.count ?? 0,
      subscriber_count: subscriberCount?.count ?? 0,
      created_at: row.created_at,
      private_account: isPrivateAccount,
    },
    isFollowing,
  });
}
