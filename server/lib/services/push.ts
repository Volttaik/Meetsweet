/**
 * Expo Push Notification Service
 *
 * Sends push notifications to devices via the Expo Push API.
 * Automatically cleans up stale / unregistered tokens.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices, users, profiles, subscriptions, notifications, user_settings } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { emitEvent } from "@/lib/realtime/emit";
import { userChannel } from "@/lib/realtime/types";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type PushPayload = {
  title: string;
  body: string;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  data?: Record<string, unknown>;
};

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default" | null;
  badge: number;
  channelId?: string;
  data: Record<string, unknown>;
};

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

export type NotifPreferenceKey =
  | "notif_messages"
  | "notif_comments"
  | "notif_mentions"
  | "notif_likes"
  | "notif_new_subscribers"
  | "notif_creator_updates"
  | "notif_marketing";

/**
 * Whether push delivery is allowed for a user: the master `push_notifications`
 * switch must be on, and when a category is supplied, that category must also
 * be on. A missing settings row falls back to the schema defaults (all enabled
 * except marketing).
 */
async function isPushAllowed(
  userId: string,
  category?: NotifPreferenceKey,
): Promise<boolean> {
  try {
    const [settings] = await db
      .select()
      .from(user_settings)
      .where(eq(user_settings.user_id, userId))
      .limit(1);

    if (!settings) return true;
    if (settings.push_notifications === false) return false;
    if (!category) return true;
    return settings[category] !== false;
  } catch {
    // Preference lookup must never block delivery on a transient error.
    return true;
  }
}

/**
 * Whether an in-app notification category is enabled for a user. Unlike the
 * push gate (which also honors the master push_notifications switch), this is
 * category-only: a user who turned OFF "Comments" gets no comment event in
 * their in-app notification feed either — the setting is authoritative, not a
 * client-side filter. A missing settings row falls back to the schema default
 * (category enabled).
 */
export async function categoryEnabled(
  userId: string,
  category: NotifPreferenceKey,
): Promise<boolean> {
  try {
    const [settings] = await db
      .select()
      .from(user_settings)
      .where(eq(user_settings.user_id, userId))
      .limit(1);
    if (!settings) return true;
    return settings[category] !== false;
  } catch {
    // Preference lookup must never block an event on a transient error.
    return true;
  }
}

/**
 * The notification payload shape handed to clients. Mirrors the `data` block
 * of GET /api/notifications so a client can render the row and navigate to
 * the right screen from the event alone — no follow-up request required.
 */
export function notificationDataBlock(input: {
  entity_type?: string | null;
  entity_id?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_username?: string | null;
  actor_avatar?: string | null;
}): Record<string, unknown> {
  const { entity_type, entity_id, actor_id, actor_name, actor_username, actor_avatar } = input;
  return {
    // content_type lets the mobile app route to the correct screen
    content_type: ["post", "video", "short", "album"].includes(entity_type ?? "")
      ? entity_type
      : entity_type === "comment" ? "post" : null,
    entity_type: entity_type ?? null,
    entity_id: entity_id ?? null,
    // Private Inbox: the mobile app routes these to the message thread.
    private_message_id: entity_type === "private_message" ? entity_id : null,
    // Convenience aliases for each content type
    post_id: entity_type === "post" ? entity_id : null,
    video_id: entity_type === "video" ? entity_id : null,
    short_id: entity_type === "short" ? entity_id : null,
    album_id: entity_type === "album" ? entity_id : null,
    comment_id: entity_type === "comment" ? entity_id : null,
    actor_id: actor_id ?? null,
    actor_name: actor_name ?? null,
    actor_username: actor_username ?? null,
    actor_avatar: actor_avatar ?? null,
  };
}

/**
 * A notification row as inserted into the `notifications` table. `user_id`
 * (the recipient) and `created_at` are always present; the emit helper below
 * appends display data + the navigation block before fanning out.
 */
export type NotificationRow = {
  id: string;
  user_id: string;
  created_at: string;
  actor_id?: string | null;
  type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  body?: string | null;
};

/**
 * Emit `notification.created` for an already-persisted notification row.
 *
 * The row is the source of truth (the caller inserted it); this only delivers
 * the realtime event. Actor display data is loaded best-effort so the
 * recipient's client can render the row immediately. Fire-and-forget — never
 * throws and never blocks the API response.
 */
export function emitNotificationCreated(row: NotificationRow): void {
  void (async () => {
    try {
      let actor_name: string | null = null;
      let actor_username: string | null = null;
      let actor_avatar: string | null = null;
      if (row.actor_id) {
        const [actor] = await db
          .select({
            full_name: users.full_name,
            username: users.username,
            avatar_url: profiles.avatar_url,
          })
          .from(users)
          .leftJoin(profiles, eq(profiles.user_id, users.id))
          .where(eq(users.id, row.actor_id))
          .limit(1);
        if (actor) {
          actor_name = actor.full_name ?? null;
          actor_username = actor.username ?? null;
          actor_avatar = actor.avatar_url ?? null;
        }
      }

      emitEvent({
        type: "notification.created",
        channel: userChannel(row.user_id),
        userId: row.user_id,
        resourceId: row.id,
        payload: {
          notification: {
            id: row.id,
            type: row.type,
            entity_type: row.entity_type ?? null,
            entity_id: row.entity_id ?? null,
            body: row.body ?? null,
            actor_id: row.actor_id ?? null,
            created_at: row.created_at,
            is_read: false,
            actor_name,
            actor_username,
            actor_avatar,
            data: notificationDataBlock({
              entity_type: row.entity_type,
              entity_id: row.entity_id,
              actor_id: row.actor_id,
              actor_name,
              actor_username,
              actor_avatar,
            }),
          },
        },
      });
    } catch {
      // Delivery is best-effort — the DB row is already authoritative.
    }
  })();
}

/**
 * Create an in-app notification row for a user, gated by their notification
 * preference for that category. When the category is OFF, nothing is written
 * and the event never appears in their notification feed — enforced here so
 * the backend cannot be bypassed by calling the event API directly.
 * Fire-and-forget — never throws.
 */
export async function createNotification(
  userId: string,
  category: NotifPreferenceKey | null,
  values: {
    actor_id?: string | null;
    type: string;
    entity_type?: string | null;
    entity_id?: string | null;
    body?: string | null;
  },
): Promise<void> {
  try {
    if (category && !(await categoryEnabled(userId, category))) return;
    const notificationId = generateId();
    const createdAt = new Date().toISOString();
    const row: NotificationRow = {
      id: notificationId,
      user_id: userId,
      created_at: createdAt,
      ...values,
    };
    await db.insert(notifications).values(row);

    // Realtime: the recipient's notification feed/badge updates instantly
    // while the app is connected. The durable row above remains authoritative.
    emitNotificationCreated(row);
  } catch {
    // Notification writes are best-effort — never break the API response.
  }
}

/**
 * Send a push notification to one or more Expo push tokens.
 * Stale tokens that come back as DeviceNotRegistered are removed from the DB.
 */
export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<void> {
  const validTokens = tokens.filter(
    (t) => typeof t === "string" && t.startsWith("ExponentPushToken["),
  );
  if (validTokens.length === 0) return;

  const messages: ExpoMessage[] = validTokens.map((token) => ({
    to: token,
    title: payload.title,
    body: payload.body,
    sound: payload.sound ?? "default",
    badge: payload.badge ?? 1,
    channelId: payload.channelId ?? "default",
    data: payload.data ?? {},
  }));

  let tickets: ExpoTicket[] = [];
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: ExpoTicket[] };
      tickets = json.data ?? [];
    }
  } catch {
    // Non-critical — push delivery failure should never break the API response
  }

  // Remove stale tokens
  const staleTokens: string[] = [];
  tickets.forEach((ticket, i) => {
    if (
      ticket.status === "error" &&
      ticket.details?.error === "DeviceNotRegistered"
    ) {
      staleTokens.push(validTokens[i]);
    }
  });

  if (staleTokens.length > 0) {
    await Promise.all(
      staleTokens.map((token) =>
        db.delete(devices).where(eq(devices.push_token, token)).catch(() => {}),
      ),
    );
  }
}

/**
 * Look up all push tokens for a user and send them a notification.
 * Fire-and-forget — never throws.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  category?: NotifPreferenceKey,
): Promise<void> {
  try {
    if (!(await isPushAllowed(userId, category))) return;

    const rows = await db
      .select({ push_token: devices.push_token })
      .from(devices)
      .where(eq(devices.user_id, userId));

    const tokens = rows
      .map((r) => r.push_token)
      .filter((t): t is string => Boolean(t));

    if (tokens.length === 0) return;
    await sendPushToTokens(tokens, payload);
  } catch {
    // Non-critical
  }
}

/**
 * Look up all push tokens for a list of user IDs and send each their notification.
 * Batches tokens together in one Expo API call where possible.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
  category?: NotifPreferenceKey,
): Promise<void> {
  if (userIds.length === 0) return;
  await Promise.all(
    userIds.map((uid) => sendPushToUser(uid, payload, category)),
  );
}

/**
 * Get the actor username for notification bodies (best-effort).
 */
export async function getActorUsername(userId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.username ? `@${row.username}` : "Someone";
  } catch {
    return "Someone";
  }
}

/**
 * Notify every active subscriber when a creator publishes content.
 * The database notification is written alongside the push fan-out so users
 * still see the event in-app if push permissions are disabled.
 */
export async function notifySubscribersOfNewPost(input: {
  creatorId: string;
  postId: string;
  contentType: "post" | "video" | "short" | "album";
  title?: string | null;
}): Promise<void> {
  try {
    const [creator] = await db
      .select({ username: users.username, full_name: users.full_name })
      .from(users)
      .where(eq(users.id, input.creatorId))
      .limit(1);

    const subscribers = await db
      .select({ user_id: subscriptions.subscriber_id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.creator_id, input.creatorId),
          eq(subscriptions.status, "active"),
        ),
      );

    const recipientIds = subscribers
      .map((row) => row.user_id)
      .filter((id): id is string => Boolean(id) && id !== input.creatorId);
    if (recipientIds.length === 0) return;

    const creatorName = creator?.username
      ? `@${creator.username}`
      : creator?.full_name || "A creator";
    const contentTitle = input.title?.trim() || `a new ${input.contentType}`;
    const body = `${creatorName} just posted: ${contentTitle}`;
    const data = {
      type: "new_post",
      post_id: input.postId,
      content_id: input.postId,
      ...(input.contentType === "album" ? { album_id: input.postId } : {}),
      actor_id: input.creatorId,
      actor_username: creator?.username ?? null,
      content_type: input.contentType,
    };

    await Promise.all(
      recipientIds.map(async (userId) =>
        createNotification(userId, "notif_creator_updates", {
          actor_id: input.creatorId,
          type: "new_post",
          entity_type: input.contentType,
          entity_id: input.postId,
          body,
        }),
      ),
    );

    await sendPushToUsers(
      recipientIds,
      { title: "New Post", body, data },
      "notif_creator_updates",
    );
  } catch {
    // Publishing must not fail because a notification provider is unavailable.
  }
}
