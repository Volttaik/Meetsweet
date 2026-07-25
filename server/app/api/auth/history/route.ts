import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { login_history } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseQuery } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { z } from "zod";

const schema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(req.nextUrl.searchParams, schema);
  if (!parsed.success) return parsed.response;
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(login_history)
    .where(eq(login_history.user_id, auth.user.userId))
    .orderBy(desc(login_history.created_at))
    .limit(limit as number)
    .offset(offset);

  return ok({ history: rows, page, limit });
}
