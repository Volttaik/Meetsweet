import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

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
    .where(eq(notifications.user_id, auth.user.userId))
    .orderBy(desc(notifications.created_at))
    .limit(limit);

  return ok({
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      entity_type: n.entity_type,
      entity_id: n.entity_id,
      body: n.body,
      is_read: n.is_read,
      created_at: n.created_at,
      actor: n.actor_id
        ? { id: n.actor_id, name: n.actor_name, username: n.actor_username, avatar_url: n.actor_avatar }
        : null,
    })),
  });
}
