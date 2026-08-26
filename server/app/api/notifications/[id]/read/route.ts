import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { emitEvent } from "@/lib/realtime/emit";
import { userChannel } from "@/lib/realtime/types";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [notif] = await db
    .select({ id: notifications.id, user_id: notifications.user_id })
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);

  if (!notif) return err("Notification not found", 404);
  if (notif.user_id !== auth.user.userId) return err("Forbidden", 403);

  await db.update(notifications).set({ is_read: true }).where(eq(notifications.id, id));

  // Realtime: every connected device of THIS user drops the badge for this
  // notification immediately (and reconnects replay it) via the durable
  // outbox. The DB row above remains authoritative.
  emitEvent({
    type: "notification.read",
    channel: userChannel(notif.user_id),
    userId: notif.user_id,
    resourceId: id,
    payload: { notification_id: id, read_at: new Date().toISOString() },
  });

  return ok({});
}
