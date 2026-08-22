/**
 * Unified Realtime protocol — shared types for the WebSocket layer.
 *
 * Channels are the ONLY routing primitive. Every event is addressed to one
 * channel; a connection receives an event when it is subscribed to that
 * channel (subscriptions are authorized server-side at subscribe time).
 *
 *   user:{userId}   — private per-user channel (notifications, wallet, ...)
 *   chat:{roomId}   — a chat conversation (messages, typing, read, ...)
 *   post:{postId}   — a post (comments, like counts) — comment room id == post id
 *
 * Event naming (server-authored, consistent scheme):
 *   chat.message.created   chat.typing.started/stopped   chat.recording.started/stopped
 *   chat.message.read      chat.reaction.updated         chat.presence.updated
 *   post.comment.created/updated/deleted                 post.like.updated
 *   notification.created                                 subscription.count_updated
 *   wallet.updated
 *
 * DURABLE vs EPHEMERAL: durable events are appended to the Turso outbox
 * (realtime_events) with a monotonic `seq` so reconnecting clients can
 * recover missed events. Ephemeral events (typing, recording, presence) are
 * broadcast to the local Function instance only and are NEVER written to the
 * database — they are transient by design.
 */

export interface RealtimeEvent {
  /** UUID — the client dedupes on this (idempotent delivery). */
  id: string;
  /** Outbox sequence — null for ephemeral events. Monotonic per event. */
  seq: number | null;
  /** Event type, e.g. "chat.message.created". */
  type: string;
  /** Channel this event is addressed to, e.g. "chat:ROOM_1". */
  channel: string;
  /** ISO timestamp. */
  ts: string;
  /** The resource the event is about (message id, post id, ...). */
  resourceId?: string;
  /** The acting user id (server-set, never client-supplied). */
  userId?: string;
  /** Minimal, compact payload — enough to update client state immediately. */
  payload: Record<string, unknown>;
}

export interface EmitOptions {
  type: string;
  channel: string;
  resourceId?: string;
  userId?: string;
  payload?: Record<string, unknown>;
  /** Default true. Set false for ephemeral events (typing/recording/presence). */
  durable?: boolean;
}

/** Client → server messages. */
export type ClientMessage =
  | { type: "subscribe"; channels: string[] }
  | { type: "unsubscribe"; channels: string[] }
  | { type: "ping" }
  | { type: "sync"; since: number | null }
  /** Relay an ephemeral presence/typing/recording event to a channel the
   *  client is authorized for. Only allow-listed event types are accepted. */
  | { type: "relay"; channel: string; eventType: string; payload?: Record<string, unknown> };

/** Server → client messages. */
export type ServerMessage =
  | { type: "hello"; seq: number | null }
  | { type: "subscribed"; channels: string[]; denied: string[] }
  | { type: "unsubscribed"; channels: string[] }
  | { type: "synced"; since: number | null }
  | { type: "pong" }
  | { type: "event"; event: RealtimeEvent }
  | { type: "error"; code: string; message: string };

export const CHANNEL = {
  user: (id: string) => `user:${id}`,
  chat: (roomId: string) => `chat:${roomId}`,
  post: (postId: string) => `post:${postId}`,
} as const;

export const EVENT = {
  chatMessageCreated: "chat.message.created",
  chatMessageUpdated: "chat.message.updated",
  chatMessageDeleted: "chat.message.deleted",
  chatTypingStarted: "chat.typing.started",
  chatTypingStopped: "chat.typing.stopped",
  chatRecordingStarted: "chat.recording.started",
  chatRecordingStopped: "chat.recording.stopped",
  chatMessageRead: "chat.message.read",
  chatReactionUpdated: "chat.reaction.updated",
  chatPresenceUpdated: "chat.presence.updated",
  postCommentCreated: "post.comment.created",
  postCommentUpdated: "post.comment.updated",
  postCommentDeleted: "post.comment.deleted",
  postLikeUpdated: "post.like.updated",
  notificationCreated: "notification.created",
  notificationRead: "notification.read",
  subscriptionCountUpdated: "subscription.count_updated",
  walletUpdated: "wallet.updated",
  purchaseCompleted: "purchase.completed",
} as const;

/**
 * Ephemeral event types clients may RELAY (broadcast) to channels they are
 * authorized for. Anything durable — messages, comments, likes, financial
 * events — can never be relayed; those are emitted server-side only, after
 * the database write. The acting userId is always overwritten server-side.
 */
export const RELAYABLE_TYPES = new Set<string>([
  EVENT.chatTypingStarted,
  EVENT.chatTypingStopped,
  EVENT.chatRecordingStarted,
  EVENT.chatRecordingStopped,
  EVENT.chatPresenceUpdated,
]);
