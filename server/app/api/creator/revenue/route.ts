import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseQuery } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { z } from "zod";

const schema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  if (auth.user.role === "user") return err("Creator access required", 403);

  const parsed = parseQuery(req.nextUrl.searchParams, schema);
  if (!parsed.success) return parsed.response;
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;

  const [wallet] = await db
    .select({ balance: wallets.balance, currency: wallets.currency })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const earnings = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, auth.user.userId),
        eq(transactions.status, "success"),
        eq(transactions.type, "credit")
      )
    )
    .orderBy(desc(transactions.created_at))
    .limit(limit as number)
    .offset(offset);

  return ok({
    balance: wallet?.balance ?? 0,
    currency: wallet?.currency ?? "NGN",
    earnings,
    page,
    limit,
  });
}
