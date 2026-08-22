/**
 * Expo Push Notification Service
 *
 * Sends push notifications to devices via the Expo Push API.
 * Automatically cleans up stale / unregistered tokens.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { emitEvent } from "@/lib/realtime/emit";
import { devices, users, subscriptions, notifications, user_settings } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

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
    await db.insert(notifications).values({
      id: notificationId,
      user_id: userId,
      created_at: createdAt,
      ...values,
    });

    // Realtime: this is the single choke point through which every in-app
    // notification is written, so a live event is emitted here — the target
    // user's badge/feed updates instantly on their connected devices. Durable
    // so a reconnecting client converges. Push (OS-level) is a separate,
    // complementary system (sendPushToUser).
    void emitEvent({
      type: "notification.created",
      channel: `user:${userId}`,
      resourceId: notificationId,
      userId: values.actor_id ?? undefined,
      payload: {
        notification: {
          id: notificationId,
          user_id: userId,
          actor_id: values.actor_id ?? null,
          type: values.type,
          entity_type: values.entity_type ?? null,
          entity_id: values.entity_id ?? null,
          body: values.body ?? null,
          created_at: createdAt,
        },
      },
    });
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
      recipientIds.map((userId) =>
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
