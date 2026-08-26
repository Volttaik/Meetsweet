import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { emitEvent } from "@/lib/realtime/emit";
import { userChannel } from "@/lib/realtime/types";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const now = new Date().toISOString();
  await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, auth.user.userId), eq(notifications.is_read, false)));

  // Realtime: every connected device of this user clears its badge instantly.
  emitEvent({
    type: "notification.read_all",
    channel: userChannel(auth.user.userId),
    userId: auth.user.userId,
    resourceId: auth.user.userId,
    payload: { read_at: now },
  });

  return ok({ updated: true });
}
