import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.user_id, auth.user.userId))
    .orderBy(desc(transactions.created_at))
    .limit(limit);

  return ok({ transactions: rows });
}
