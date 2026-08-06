import { NextRequest } from "next/server";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

function notificationTitle(type: string): string {
  const map: Record<string, string> = {
    like: "New Like",
    comment: "New Comment",
    follow: "New Follower",
    subscribe: "New Subscriber",
    new_post: "New Post",
    reply: "New Reply",
    mention: "You were mentioned",
    tip: "New Tip",
    payment: "Payment Received",
    system: "MeetSweet",
  };
  return map[type] ?? "Notification";
}

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
    .where(eq(notifications.user_id, auth.user.userId))
    .orderBy(desc(notifications.created_at))
    .limit(limit)
    .offset(offset);

  // Count unread notifications
  const [unreadRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, auth.user.userId),
        eq(notifications.is_read, false),
      ),
    );

  const unread_count = unreadRow?.count ?? 0;

  return ok({
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: notificationTitle(n.type ?? ""),
      body: n.body ?? "",
      is_read: n.is_read,
      created_at: n.created_at,
      // Mobile normalizer reads from raw.data sub-object
      data: {
        // content_type lets the mobile app route to the correct screen
        content_type: (["post", "video", "short", "album"].includes(n.entity_type ?? "")
          ? n.entity_type
          : n.entity_type === "comment" ? "post" : null) as string | null,
        entity_type: n.entity_type ?? null,
        entity_id: n.entity_id ?? null,
        // Convenience aliases for each content type
        post_id: n.entity_type === "post" ? n.entity_id : null,
        video_id: n.entity_type === "video" ? n.entity_id : null,
        short_id: n.entity_type === "short" ? n.entity_id : null,
        album_id: n.entity_type === "album" ? n.entity_id : null,
        comment_id: n.entity_type === "comment" ? n.entity_id : null,
        actor_id: n.actor_id ?? null,
        actor_name: n.actor_name ?? null,
        actor_username: n.actor_username ?? null,
        actor_avatar: n.actor_avatar ?? null,
      },
    })),
    unread_count,
  });
}
