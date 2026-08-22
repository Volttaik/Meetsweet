import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { emitEvent } from "@/lib/realtime/emit";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, auth.user.userId), eq(notifications.is_read, false)));
  void emitEvent({ type: "notification:read", channel: `user:${auth.user.userId}`, userId: auth.user.userId, payload: { all: true } });

  return ok({ updated: true });
}
