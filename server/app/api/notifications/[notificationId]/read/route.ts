import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, notFound, forbidden } from "@/lib/api/response";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { notificationId } = await params;

  const [notification] = await db
    .select({ id: notifications.id, user_id: notifications.user_id })
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);

  if (!notification) return notFound("Notification not found");
  if (notification.user_id !== auth.user.userId) return forbidden();

  await db
    .update(notifications)
    .set({ is_read: true })
    .where(eq(notifications.id, notificationId));

  return ok({});
}
