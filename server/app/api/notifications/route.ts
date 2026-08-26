import { NextRequest } from "next/server";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { notificationTitle } from "@/lib/services/notifications";
import { notificationDataBlock } from "@/lib/services/push";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      entity_type: notifications.entity_type,
      entity_id: notifications.entity_id,
      body: notifications.body,
      is_read: notifications.is_read,
      created_at: notifications.created_at,
      actor_id: users.id,
      actor_name: users.full_name,
      actor_username: users.username,
      actor_avatar: profiles.avatar_url,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actor_id))
    .leftJoin(profiles, eq(profiles.user_id, notifications.actor_id))
    // Direct messages can still trigger OS push, but they do not belong in
    // the permanent social notification feed. Exclude legacy DM rows too so
    // users are not flooded by messages created before the socket fix.
    .where(and(
      eq(notifications.user_id, auth.user.userId),
      sql`${notifications.type} NOT IN ('message', 'dm')`,
    ))
    .orderBy(desc(notifications.created_at))
    .limit(limit)
    .offset(offset);

  // Count unread notifications
  const [unreadRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(
      eq(notifications.user_id, auth.user.userId),
      eq(notifications.is_read, false),
      sql`${notifications.type} NOT IN ('message', 'dm')`,
    ));

  const unread_count = unreadRow?.count ?? 0;

  return ok({
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: notificationTitle(n.type ?? ""),
      body: n.body ?? "",
      is_read: n.is_read,
      created_at: n.created_at,
      // Mobile normalizer reads from raw.data sub-object — the SAME navigation
      // block the realtime event and the push carry (single source of truth).
      data: notificationDataBlock({
        entity_type: n.entity_type,
        entity_id: n.entity_id,
        actor_id: n.actor_id,
        actor_name: n.actor_name,
        actor_username: n.actor_username,
        actor_avatar: n.actor_avatar,
      }),
    })),
    unread_count,
  });
}
