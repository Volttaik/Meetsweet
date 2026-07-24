import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { creator_statistics, subscriptions, posts, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  if (auth.user.role === "user") return err("Creator access required", 403);

  // Period stats
  const stats = await db
    .select()
    .from(creator_statistics)
    .where(eq(creator_statistics.creator_id, auth.user.userId))
    .orderBy(desc(creator_statistics.period))
    .limit(12);

  // Active subscribers count
  const activeSubscriptions = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.creator_id, auth.user.userId), eq(subscriptions.status, "active")));

  // Total posts
  const totalPosts = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.creator_id, auth.user.userId));

  return ok({
    period_stats: stats,
    active_subscribers: activeSubscriptions.length,
    total_posts: totalPosts.length,
  });
}
