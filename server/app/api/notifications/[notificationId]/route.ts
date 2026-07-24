import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound } from "@/lib/api/response";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { notificationId } = await params;

  const [notif] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
  if (!notif) return notFound();
  if (notif.user_id !== auth.user.userId) return forbidden();

  await db.update(notifications).set({ is_read: true }).where(eq(notifications.id, notificationId));
  return ok(null, "Notification read");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { notificationId } = await params;

  const [notif] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
  if (!notif) return notFound();
  if (notif.user_id !== auth.user.userId) return forbidden();

  await db.delete(notifications).where(eq(notifications.id, notificationId));
  return ok(null, "Notification deleted");
}
