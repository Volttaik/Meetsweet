import { NextRequest } from "next/server";
import { eq, and, desc, count, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creator_statistics,
  subscriptions,
  posts,
  transactions,
  wallets,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  if (auth.user.role === "user") return err("Creator access required", 403);

  const [wallet] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const [activeSubCount] = await db
    .select({ count: count() })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.creator_id, auth.user.userId),
        eq(subscriptions.status, "active")
      )
    );

  const [totalPostCount] = await db
    .select({ count: count() })
    .from(posts)
    .where(
      and(eq(posts.creator_id, auth.user.userId), eq(posts.status, "published"))
    );

  // Last 6 months of stats
  const stats = await db
    .select()
    .from(creator_statistics)
    .where(eq(creator_statistics.creator_id, auth.user.userId))
    .orderBy(desc(creator_statistics.period))
    .limit(6);

  // Revenue (completed transactions received)
  const [totalRevenue] = await db
    .select({ total: sum(transactions.amount) })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, auth.user.userId),
        eq(transactions.status, "success"),
        eq(transactions.type, "credit")
      )
    );

  return ok({
    wallet_balance: wallet?.balance ?? 0,
    active_subscribers: activeSubCount?.count ?? 0,
    total_posts: totalPostCount?.count ?? 0,
    total_revenue: totalRevenue?.total ?? 0,
    period_stats: stats,
  });
}
