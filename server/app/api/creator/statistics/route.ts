import { NextRequest } from "next/server";
import { eq, sql, desc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { creator_statistics, subscriptions, posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const period = req.nextUrl.searchParams.get("period");

  const rows = await db
    .select()
    .from(creator_statistics)
    .where(eq(creator_statistics.creator_id, auth.user.userId))
    .orderBy(desc(creator_statistics.period));

  const filtered = period ? rows.filter((r) => r.period === period) : rows;

  // Mobile expects { period_stats, active_subscribers, total_posts, total_revenue }
  const period_stats = filtered.map((r) => ({
    period: r.period,
    views: r.total_views,
    likes: r.total_likes,
    new_subscribers: r.new_subscribers,
    revenue: r.total_revenue,
  }));

  // Active subscribers: count active subscriptions where this user is the creator
  const [activeSubRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(eq(subscriptions.creator_id, auth.user.userId));

  // Total posts: count non-deleted posts
  const [postCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(posts)
    .where(eq(posts.creator_id, auth.user.userId));

  // Total revenue: sum of all periods' revenue
  const total_revenue = filtered.reduce((acc, r) => acc + (r.total_revenue ?? 0), 0);

  return ok({
    period_stats,
    active_subscribers: activeSubRow?.count ?? 0,
    total_posts: postCountRow?.count ?? 0,
    total_revenue,
    statistics: filtered, // backward compat
  });
}
