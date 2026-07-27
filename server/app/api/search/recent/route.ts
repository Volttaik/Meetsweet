import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { recent_searches } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const rows = await db
    .select({
      id: recent_searches.id,
      query: recent_searches.query,
      created_at: recent_searches.created_at,
    })
    .from(recent_searches)
    .where(eq(recent_searches.user_id, auth.user.userId))
    .orderBy(desc(recent_searches.created_at))
    .limit(20);

  // Return as array directly (mobile expects array, not wrapped object)
  return ok(rows);
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  await db
    .delete(recent_searches)
    .where(eq(recent_searches.user_id, auth.user.userId));

  return ok({ cleared: true });
}
