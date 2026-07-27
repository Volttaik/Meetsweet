import { NextRequest } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { recent_searches } from "@/lib/db/schema";
import { ok } from "@/lib/api/response";

/**
 * GET /api/search/trending
 *
 * Returns the most frequently searched terms across all users
 * (aggregated, not personalized) for the past 7 days.
 */
export async function GET(_req: NextRequest) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const rows = await db
      .select({
        query: recent_searches.query,
        count: sql<number>`COUNT(*)`.as("count"),
      })
      .from(recent_searches)
      .where(sql`${recent_searches.created_at} >= ${sevenDaysAgo}`)
      .groupBy(recent_searches.query)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(20);

    const trending = rows.map((r) => r.query);
    return ok({ trending, searches: trending, terms: trending });
  } catch {
    return ok({ trending: [], searches: [], terms: [] });
  }
}
