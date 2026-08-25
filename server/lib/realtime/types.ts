/**
 * Realtime event protocol.
 *
 * The WebSocket layer is a NOTIFICATION transport only. Turso remains the
 * durable source of truth; every durable event is persisted to
 * `realtime_events` (the outbox) BEFORE/AS it is fanned out, so a client that
 * reconnects replays what it missed via `sync { since }`. Clients can never
 * publish events — there is deliberately no `relay` frame and no typing /
 * presence / read-receipt machinery (Private Inbox is correspondence, not chat).
 */

// ─── Channels ────────────────────────────────────────────────────────────────
// One channel kind only: the user's private stream. Inbox, outbox, wallet,
// and notification updates all arrive here — server-authorized at subscribe.

export function userChannel(userId: string): string {
  return `user:${userId}`;
}

export function parseChannel(channel: string): { kind: "user"; userId: string } | null {
  if (channel.startsWith("user:")) return { kind: "user", userId: channel.slice(5) };
  return null;
}

// ─── Durable event types ─────────────────────────────────────────────────────

export const REALTIME_EVENT_TYPES = [
  "private_message.created",
  "private_message.read",
  "private_message.reply_created",
  "private_message.updated",
  "private_message.approved",
  "private_message.deleted",
  "private_message.attachment_purchased",
  "private_inbox.settings_updated",
  "notification.created",
  "notification.read",
  "wallet.updated",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

// ─── Wire protocol ───────────────────────────────────────────────────────────

/** Client → server frames */
export type ClientFrame =
  | { type: "subscribe"; channels: string[] }
  | { type: "unsubscribe"; channels: string[] }
  | { type: "ping" }
  // Missed-event recovery after reconnect: replay my durable events with seq > since.
  | { type: "sync"; since: number };

/** Server → client frames */
export type ServerFrame =
  | { type: "hello"; seq: number } // seq = current head of the outbox
  | { type: "subscribed"; channels: string[]; denied: string[] }
  | { type: "event"; event: RealtimeEvent }
  | { type: "pong" }
  | { type: "synced"; since: number; count: number }
  | { type: "error"; code: string; message?: string };

/** The durable event envelope as delivered to clients. */
export interface RealtimeEvent {
  id: string;
  seq: number;
  type: RealtimeEventType;
  channel: string;
  ts: string;
  resourceId?: string | null;
  payload: Record<string, unknown>;
}

/** Input for emitEvent(). */
export interface EmitInput {
  type: RealtimeEventType;
  channel: string;
  /** Owning user of the channel — used for authorization + replay scoping. */
  userId: string;
  resourceId?: string | null;
  /** Enough data for the client to update its UI without a follow-up request. */
  payload: Record<string, unknown>;
}
