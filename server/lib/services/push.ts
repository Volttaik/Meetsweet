/**
 * Expo Push Transport
 *
 * The low-level delivery layer for OS-level push notifications. Sends to Expo
 * Push Service, checks push receipts for delivery errors (DeviceNotRegistered
 * tokens are removed so the server stops failing on dead devices), and owns
 * the user preference gates. Notification ORCHESTRATION (the durable row, the
 * realtime event, the feature-specific payloads) lives in
 * `lib/services/notifications.ts` — routes never talk to this module directly.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices, users, user_settings } from "@/lib/db/schema";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

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

type ExpoReceipt =
  | { status: "ok" }
  | { status: "error"; message?: string; details?: { error?: string } };

// ─── Pending push-receipt tracking ───────────────────────────────────────────
// Expo push tickets only prove the payload was RECEIVED by Expo; actual
// delivery outcome (DeviceNotRegistered, MessageTooBig, …) is only known from
// the push receipt. We track ticket ids → token here and poll receipts shortly
// after sending so dead tokens are removed instead of failing forever.
const pendingTickets = new Map<string, string>();
const MAX_PENDING_TICKETS = 5000;
let receiptCheckScheduled = false;

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
 * their in-app notification feed either. A missing settings row falls back to
 * the schema default (category enabled).
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
 * The notification navigation payload shape handed to clients. Mirrors the
 * `data` block of GET /api/notifications so a client can render the row and
 * navigate to the right screen from the event alone — no follow-up request.
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

/** Delete a device row for a permanently-invalid push token. */
async function removeStaleToken(token: string): Promise<void> {
  try {
    await db.delete(devices).where(eq(devices.push_token, token));
    console.warn("[push] removed unregistered device token");
  } catch (e) {
    console.error("[push] failed to remove stale token:", e);
  }
}

/** Schedule a best-effort push-receipt poll for any pending tickets. */
function scheduleReceiptCheck(delayMs = 60_000): void {
  if (receiptCheckScheduled) return;
  receiptCheckScheduled = true;
  setTimeout(() => {
    receiptCheckScheduled = false;
    void checkPendingPushReceipts();
  }, delayMs);
}

/**
 * Check push receipts for pending tickets and handle delivery errors:
 *  • DeviceNotRegistered → the token is permanently dead — remove it so the
 *    server stops attempting delivery to that device.
 *  • MessageTooBig / MessageRateExceeded / credential errors → log so the
 *    failure is visible instead of silently swallowed.
 * Receipts with no result yet are kept for the next poll. Best-effort and
 * fire-and-forget — never throws.
 */
async function checkPendingPushReceipts(): Promise<void> {
  const ids = Array.from(pendingTickets.keys()).slice(0, 1000);
  if (ids.length === 0) return;
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      console.warn(`[push] receipt check failed: HTTP ${res.status}`);
      return;
    }
    const json = (await res.json()) as { data?: Record<string, ExpoReceipt> };
    const data = json.data ?? {};
    for (const id of ids) {
      const receipt = data[id];
      if (!receipt) continue; // not ready yet — poll again next time
      const token = pendingTickets.get(id);
      pendingTickets.delete(id);
      if (receipt.status === "ok") continue;

      const error = receipt.details?.error ?? "unknown";
      console.warn(
        `[push] delivery error for ticket ${id}: ${error}${receipt.message ? ` — ${receipt.message}` : ""}`,
      );
      // The device unsubscribed or the app was uninstalled — this token can
      // never deliver again. Drop it so we stop paying to fail on it.
      if (error === "DeviceNotRegistered" && token) {
        await removeStaleToken(token);
      }
      // MessageTooBig / MessageRateExceeded / InvalidCredentials / … are
      // already logged above; they don't invalidate the token itself.
    }
  } catch (e) {
    console.error("[push] receipt check failed:", e);
  }
}

/**
 * Send a push notification to one or more Expo push tokens.
 *
 * Failures are LOGGED, not swallowed: HTTP/request-level errors, per-ticket
 * errors, and (via the receipt poll) per-delivery errors are all surfaced.
 * Tokens that come back as DeviceNotRegistered — at the ticket OR receipt
 * level — are removed from the DB so dead devices stop receiving attempts.
 * Fire-and-forget: push delivery must never break the API response.
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
    const json = (await res.json().catch(() => null)) as {
      data?: ExpoTicket[];
      errors?: Array<{ message?: string; code?: string }>;
    } | null;
    if (!res.ok) {
      // Request-level failure (invalid payload, no credentials, 429, 5xx…).
      const detail =
        json?.errors?.map((e) => e.message ?? e.code).filter(Boolean).join("; ") ??
        `HTTP ${res.status}`;
      console.error(`[push] Expo push request failed (HTTP ${res.status}): ${detail}`);
      return;
    }
    tickets = json?.data ?? [];
  } catch (e) {
    // Network failure reaching Expo's service.
    console.error("[push] Expo push request failed:", e);
    return;
  }

  tickets.forEach((ticket, i) => {
    const token = validTokens[i];
    if (ticket.status === "error") {
      const error = ticket.details?.error ?? "unknown";
      console.warn(
        `[push] ticket error: ${error}${ticket.message ? ` — ${ticket.message}` : ""}`,
      );
      if (error === "DeviceNotRegistered" && token) {
        void removeStaleToken(token);
      }
      return;
    }
    // Status ok → Expo accepted it; the delivery outcome is only known from
    // the push receipt, so track the ticket for the receipt poll.
    if (ticket.id && token) {
      if (pendingTickets.size >= MAX_PENDING_TICKETS) {
        // Evict oldest first so the map never grows unbounded.
        const oldest = pendingTickets.keys().next().value;
        if (oldest !== undefined) pendingTickets.delete(oldest);
      }
      pendingTickets.set(ticket.id, token);
    }
  });

  if (pendingTickets.size > 0) scheduleReceiptCheck();
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
 * Look up all push tokens for a list of user IDs and send each their
 * notification. Batches tokens together in one Expo API call where possible.
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
