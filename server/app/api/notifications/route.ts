import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { signNotificationRow } from "@/lib/api/media";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      entity_type: notifications.entity_type,
      entity_id: notifications.entity_id,
      body: notifications.body,
      is_read: notifications.is_read,
      created_at: notifications.created_at,
      actor_id: notifications.actor_id,
      actor_username: users.username,
      actor_avatar: profiles.avatar_url,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actor_id))
    .leftJoin(profiles, eq(profiles.user_id, notifications.actor_id))
    .where(eq(notifications.user_id, auth.user.userId))
    .orderBy(desc(notifications.created_at))
    .limit(50);

  const signed = await Promise.all(rows.map(signNotificationRow));
  const unread = rows.filter((n) => !n.is_read).length;

  return ok({ notifications: signed, unread_count: unread });
}
