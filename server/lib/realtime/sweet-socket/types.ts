import type { WebSocket } from "ws";

export type SweetSocketEvent = {
  id: string;
  version: 1;
  type: string;
  timestamp: number;
  userId: string;
  channel?: string;
  roomId?: string;
  resourceId?: string;
  clientMessageId?: string;
  sequence: number | null;
  payload: Record<string, unknown>;
};

export type SweetSocketConnection = {
  id: string;
  ws: WebSocket;
  userId: string;
  channels: Set<string>;
  lastSeen: number;
  authenticatedAt: number;
  lastAuthCheck: number;
};

export type SweetSocketClientMessage =
  | { type: "subscribe"; channels: string[] }
  | { type: "unsubscribe"; channels: string[] }
  | { type: "ping" }
  | { type: "sync"; since: number | null }
  | {
      type: "command";
      requestId: string;
      command: string;
      channel?: string;
      clientMessageId?: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: "relay";
      channel: string;
      eventType: string;
      payload?: Record<string, unknown>;
    };

export type SweetSocketServerMessage =
  | { type: "hello"; sequence: number | null }
  | { type: "auth"; state: "connected" | "authenticated" | "session_expired" | "logout" | "disconnected"; reason?: string }
  | { type: "connection"; state: "ready" | "authenticated" | "reconnecting" | "reconnected" }
  | { type: "subscribed"; channels: string[]; denied: string[] }
  | { type: "unsubscribed"; channels: string[] }
  | { type: "synced"; since: number | null }
  | { type: "ack"; requestId: string; command: string; status: "accepted" | "persisted" | "failed"; clientMessageId?: string; event?: SweetSocketEvent; error?: string }
  | { type: "pong" }
  | { type: "event"; event: SweetSocketEvent }
  | { type: "error"; code: string; message: string };

export const SWEETSOCKET_EVENT = {
  connectionOpen: "auth:connected",
  connectionReady: "auth:authenticated",
  connectionAuthenticated: "auth:authenticated",
  connectionClosed: "auth:disconnected",
  connectionError: "system:error",
  connectionReconnecting: "system:reconnecting",
  connectionReconnected: "system:reconnected",
  messageNew: "message:created",
  messageUpdated: "message:updated",
  messageDeleted: "message:deleted",
  messageAck: "message:acknowledged",
  messageFailed: "message:failed",
  messageRead: "message:read",
  reactionUpdated: "chat.reaction.updated",
  typingStart: "typing:start",
  typingStop: "typing:stop",
  recordingStart: "voice:start",
  recordingStop: "voice:stop",
  presenceOnline: "presence:online",
  presenceOffline: "presence:offline",
  postLike: "like:created",
  postUnlike: "like:removed",
  commentCreated: "comment:created",
  commentUpdated: "comment:updated",
  commentDeleted: "comment:deleted",
  notificationNew: "notification:new",
  notificationRead: "notification:read",
  walletUpdated: "wallet:updated",
  paymentCompleted: "transaction:completed",
  subscriptionCreated: "subscription:created",
  subscriptionCancelled: "subscription:cancelled",
} as const;

export function channel(kind: "user" | "conversation" | "chat" | "post" | "comments", id: string): string {
  if (kind === "conversation" || kind === "chat") return `chat:${id}`;
  if (kind === "comments") return `post:${id}`;
  return `${kind}:${id}`;
}
