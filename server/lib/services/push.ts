/**
 * Expo Push Notification Service
 *
 * Sends push notifications to devices via the Expo Push API.
 * Automatically cleans up stale / unregistered tokens.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices, users, profiles } from "@/lib/db/schema";

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
