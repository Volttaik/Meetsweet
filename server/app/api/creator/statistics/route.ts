import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { creator_statistics } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const period = req.nextUrl.searchParams.get("period");

  const query = db
    .select()
    .from(creator_statistics)
    .where(eq(creator_statistics.creator_id, auth.user.userId))
    .orderBy(desc(creator_statistics.period));

  const rows = await query;

  const filtered = period ? rows.filter((r) => r.period === period) : rows;

  return ok({ statistics: filtered });
}
