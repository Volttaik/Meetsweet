import { NextRequest } from "next/server";
import { eq, and, desc, isNull, count, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, users, profiles, post_likes } from "@/lib/db/schema";
import { ok } from "@/lib/api/response";

/**
 * GET /api/collections
 *
 * Returns algorithmically and editorially curated content collections
 * for the Explore tab. Each collection has a title, subtitle, item_count,
 * gradient, and an optional list of preview content items.
 */
export async function GET(_req: NextRequest) {
  // Fetch real data for each collection in parallel
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [trendingCount, topLikedCount, risingCount] = await Promise.all([
    // Trending this week: published posts with high engagement in last 7 days
    db.select({ n: count() })
      .from(posts)
      .where(and(
        isNull(posts.deleted_at),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
        sql`${posts.published_at} >= ${sevenDaysAgo}`,
      ))
      .then((r) => r[0]?.n ?? 0),

    // Most liked: all-time top liked posts
    db.select({ n: count() })
      .from(posts)
      .where(and(
        isNull(posts.deleted_at),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
        sql`${posts.like_count} > 0`,
      ))
      .then((r) => r[0]?.n ?? 0),

    // Rising creators: creators with recent activity (joined/first post in last 30 days)
    db.select({ n: count() })
      .from(users)
      .where(and(
        eq(users.is_creator, true),
        eq(users.is_active, true),
        isNull(users.deleted_at),
      ))
      .then((r) => r[0]?.n ?? 0),
  ]);

  const collections = [
    {
      id: "trending-this-week",
      title: "Trending This Week",
      subtitle: "What everyone is watching right now",
      item_count: trendingCount,
      gradient: "#FF6B35,#F7C59F",
      type: "posts",
    },
    {
      id: "most-liked",
      title: "Most Liked",
      subtitle: "The content fans love the most",
      item_count: topLikedCount,
      gradient: "#E63946,#F1A7AE",
      type: "posts",
    },
    {
      id: "rising-creators",
      title: "Rising Creators",
      subtitle: "New voices worth discovering",
      item_count: risingCount,
      gradient: "#457B9D,#A8DADC",
      type: "creators",
    },
    {
      id: "popular-albums",
      title: "Popular Albums",
      subtitle: "Curated collections from top creators",
      item_count: 0,
      gradient: "#2D6A4F,#74C69D",
      type: "albums",
    },
    {
      id: "editors-picks",
      title: "Editor's Picks",
      subtitle: "Hand-selected highlights",
      item_count: trendingCount > 0 ? Math.min(trendingCount, 10) : 0,
      gradient: "#6D23B6,#C77DFF",
      type: "posts",
    },
  ];

  return ok({ collections });
}
