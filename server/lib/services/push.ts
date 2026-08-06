/**
 * Expo Push Notification Service
 *
 * Sends push notifications to devices via the Expo Push API.
 * Automatically cleans up stale / unregistered tokens.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices, users, profiles, subscriptions, notifications } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type PushPayload = {
  title: string;
  body: string;
  sound?: "default" | null;
  badge?: number;
  data?: Record<string, unknown>;
};

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default" | null;
  badge: number;
  data: Record<string, unknown>;
};

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

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
): Promise<void> {
  try {
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
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const rows = await db
      .select({ push_token: devices.push_token })
      .from(devices)
      .where(
        userIds.length === 1
          ? eq(devices.user_id, userIds[0])
          : // Use IN via raw SQL for multiple users
            eq(devices.user_id, userIds[0]), // fallback — will fan out below for >1
      );

    // For multiple users, query individually to keep it simple with Drizzle's
    // sqlite-core which doesn't support inArray on text pk in all versions.
    if (userIds.length > 1) {
      await Promise.all(userIds.map((uid) => sendPushToUser(uid, payload)));
      return;
    }

    const tokens = rows
      .map((r) => r.push_token)
      .filter((t): t is string => Boolean(t));
    if (tokens.length > 0) await sendPushToTokens(tokens, payload);
  } catch {
    // Non-critical
  }
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
        db.insert(notifications).values({
          id: generateId(),
          user_id: userId,
          actor_id: input.creatorId,
          type: "new_post",
          entity_type: input.contentType,
          entity_id: input.postId,
          body,
        }).catch(() => {}),
      ),
    );

    await sendPushToUsers(recipientIds, { title: "New Post", body, data });
  } catch {
    // Publishing must not fail because a notification provider is unavailable.
  }
}
