import { NextRequest } from "next/server";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, posts, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

/**
 * Creator analytics — computed from the LIVE source tables (posts, subscriptions,
 * transactions) so the dashboard always reflects real engagement. The legacy
 * `creator_statistics` table was never populated, which left the dashboard
 * showing zeros/empty charts regardless of actual activity.
 *
 * Revenue = the creator's earning-side transactions (`subscription_earn` +
 * `album_unlock_earn`), which are the authoritative credits into the creator's
 * wallet. This is independent of later withdrawals, so "total earnings" stays
 * correct even after a payout.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const creatorId = auth.user.userId;
  const period = req.nextUrl.searchParams.get("period");

  const EARN_TYPES: Array<"subscription_earn" | "album_unlock_earn"> = [
    "subscription_earn",
    "album_unlock_earn",
  ];

  // ── Active subscribers (status = 'active') ──────────────────────────────
  const [activeSubRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.creator_id, creatorId),
        eq(subscriptions.status, "active"),
      ),
    );

  // ── Total published posts (all content types, not soft-deleted) ─────────
  const [postCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(posts)
    .where(
      and(
        eq(posts.creator_id, creatorId),
        eq(posts.status, "published"),
        isNull(posts.deleted_at),
      ),
    );

  // ── Total revenue (lifetime earnings, unaffected by withdrawals) ────────
  const [revenueRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, creatorId),
        inArray(transactions.type, EARN_TYPES),
        eq(transactions.status, "success"),
      ),
    );

  // ── Views + likes per publish month ─────────────────────────────────────
  const postPeriodRows = await db
    .select({
      period: sql<string>`strftime('%Y-%m', ${posts.published_at})`,
      views: sql<number>`COALESCE(SUM(${posts.view_count}), 0)`,
      likes: sql<number>`COALESCE(SUM(${posts.like_count}), 0)`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.creator_id, creatorId),
        eq(posts.status, "published"),
        isNull(posts.deleted_at),
        sql`${posts.published_at} IS NOT NULL`,
      ),
    )
    .groupBy(sql`strftime('%Y-%m', ${posts.published_at})`);

  // ── New subscribers per start month ─────────────────────────────────────
  const subPeriodRows = await db
    .select({
      period: sql<string>`strftime('%Y-%m', ${subscriptions.started_at})`,
      newSubs: sql<number>`count(*)`,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.creator_id, creatorId),
        sql`${subscriptions.started_at} IS NOT NULL`,
      ),
    )
    .groupBy(sql`strftime('%Y-%m', ${subscriptions.started_at})`);

  // ── Revenue per month ───────────────────────────────────────────────────
  const revenuePeriodRows = await db
    .select({
      period: sql<string>`strftime('%Y-%m', ${transactions.created_at})`,
      revenue: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, creatorId),
        inArray(transactions.type, EARN_TYPES),
        eq(transactions.status, "success"),
      ),
    )
    .groupBy(sql`strftime('%Y-%m', ${transactions.created_at})`);

  // ── Merge the three month series into a single per-period breakdown ─────
  type Period = {
    period: string;
    views: number;
    likes: number;
    new_subscribers: number;
    revenue: number;
  };
  const map = new Map<string, Period>();
  const bucket = (key: string | null): Period => {
    const k = key && key.length > 0 ? key : "unknown";
    let p = map.get(k);
    if (!p) {
      p = { period: k, views: 0, likes: 0, new_subscribers: 0, revenue: 0 };
      map.set(k, p);
    }
    return p;
  };

  for (const r of postPeriodRows) {
    const p = bucket(r.period);
    p.views += Number(r.views ?? 0);
    p.likes += Number(r.likes ?? 0);
  }
  for (const r of subPeriodRows) {
    bucket(r.period).new_subscribers += Number(r.newSubs ?? 0);
  }
  for (const r of revenuePeriodRows) {
    bucket(r.period).revenue += Number(r.revenue ?? 0);
  }

  // Newest-first, matching what the mobile dashboard expects (it reverses for
  // left→right chronological rendering).
  const all = Array.from(map.values()).sort((a, b) =>
    b.period.localeCompare(a.period),
  );

  const filtered = period ? all.filter((p) => p.period === period) : all;

  const period_stats = filtered.map((p) => ({
    period: p.period,
    views: p.views,
    likes: p.likes,
    new_subscribers: p.new_subscribers,
    revenue: p.revenue,
  }));

  return ok({
    period_stats,
    active_subscribers: activeSubRow?.count ?? 0,
    total_posts: postCountRow?.count ?? 0,
    total_revenue: Number(revenueRow?.total ?? 0),
  });
}
