import { NextRequest } from "next/server";
import { eq, desc, and, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, posts, follows, subscriptions } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { resolveUrl } from "@/lib/services/r2";

export async function GET(req: NextRequest) {
  const auth = await optionalAuth(req);

  // Trending posts — most viewed published posts in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const trendingPosts = await db
    .select({
      id: posts.id,
      caption: posts.caption,
      view_count: posts.view_count,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      published_at: posts.published_at,
      unlock_price: posts.unlock_price,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: profiles.is_verified_creator,
    })
    .from(posts)
    .leftJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(
      and(
        eq(posts.status, "published"),
        isNull(posts.deleted_at),
        eq(posts.visibility, "public")
      )
    )
    .orderBy(desc(posts.view_count), desc(posts.published_at))
    .limit(20);

  // Trending creators — most subscribers
  const trendingCreators = await db
    .select({
      id: users.id,
      username: users.username,
      full_name: users.full_name,
      display_name: profiles.display_name,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      is_verified: profiles.is_verified_creator,
      subscription_price: profiles.subscription_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(and(eq(users.is_creator, true), eq(users.is_active, true)))
    .orderBy(desc(profiles.subscription_price))
    .limit(20);

  // Suggested creators — not yet following (if authed)
  let suggestedCreators: typeof trendingCreators = [];
  if (auth) {
    const following = await db
      .select({ following_id: follows.following_id })
      .from(follows)
      .where(eq(follows.follower_id, auth.userId));

    const followingIds = new Set(following.map((f) => f.following_id));
    followingIds.add(auth.userId);

    suggestedCreators = trendingCreators.filter((c) => !followingIds.has(c.id)).slice(0, 10);
  } else {
    suggestedCreators = trendingCreators.slice(0, 10);
  }

  // Sign URLs
  const signedTrendingPosts = await Promise.all(
    trendingPosts.map(async (p) => ({
      ...p,
      creator_avatar: await resolveUrl(p.creator_avatar),
    }))
  );

  const signedTrendingCreators = await Promise.all(
    trendingCreators.map(async (c) => ({
      ...c,
      avatar_url: await resolveUrl(c.avatar_url),
      banner_url: await resolveUrl(c.banner_url),
    }))
  );

  const signedSuggestedCreators = await Promise.all(
    suggestedCreators.map(async (c) => ({
      ...c,
      avatar_url: await resolveUrl(c.avatar_url),
      banner_url: await resolveUrl(c.banner_url),
    }))
  );

  return ok({
    trending_posts: signedTrendingPosts,
    trending_creators: signedTrendingCreators,
    suggested_creators: signedSuggestedCreators,
  });
}
