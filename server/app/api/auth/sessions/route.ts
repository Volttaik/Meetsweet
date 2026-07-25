import { NextRequest } from "next/server";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { refresh_tokens } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const now = new Date().toISOString();

  const sessions = await db
    .select({
      id: refresh_tokens.id,
      device_id: refresh_tokens.device_id,
      created_at: refresh_tokens.created_at,
      expires_at: refresh_tokens.expires_at,
    })
    .from(refresh_tokens)
    .where(
      and(
        eq(refresh_tokens.user_id, auth.user.userId),
        isNull(refresh_tokens.revoked_at),
        gt(refresh_tokens.expires_at, now)
      )
    )
    .orderBy(refresh_tokens.created_at);

  return ok({ sessions });
}
