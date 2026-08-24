import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function DELETE(
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

  await db.delete(notifications).where(eq(notifications.id, id));

  return ok({ deleted: true });
}
