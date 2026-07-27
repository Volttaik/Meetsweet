import { NextRequest } from "next/server";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { refresh_tokens } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Revoke all active refresh tokens for this user
  const now = new Date().toISOString();
  await db
    .update(refresh_tokens)
    .set({ revoked_at: now })
    .where(
      eq(refresh_tokens.user_id, auth.user.userId),
    );

  return ok({ logged_out: true });
}
