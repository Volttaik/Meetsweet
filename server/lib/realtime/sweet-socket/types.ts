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
  | { type: "connection"; state: "connecting" | "authenticated" | "ready" | "reconnecting" | "reconnected" | "disconnected" | "error"; reason?: string }
  | { type: "subscribed"; channels: string[]; denied: string[] }
  | { type: "unsubscribed"; channels: string[] }
  | { type: "synced"; since: number | null }
  | { type: "ack"; requestId: string; command: string; status: "accepted" | "persisted" | "failed"; clientMessageId?: string; event?: SweetSocketEvent; error?: string }
  | { type: "pong" }
  | { type: "event"; event: SweetSocketEvent }
  | { type: "error"; code: string; message: string };

// The canonical event map is the single source of truth for event names.
// `SWEETSOCKET_EVENT` is re-exported here for backward compatibility with
// call sites that import it from ./types.
export { SWEETSOCKET_EVENT, SWEETSOCKET_ERROR, SWEETSOCKET_EVENT_META } from "./event-map";
export type {
  SweetSocketEventMap,
  SweetSocketEventName,
  SweetSocketErrorCode,
} from "./event-map";

export function channel(kind: "user" | "conversation" | "chat" | "post" | "comments", id: string): string {
  if (kind === "conversation" || kind === "chat") return `chat:${id}`;
  if (kind === "comments") return `post:${id}`;
  return `${kind}:${id}`;
}
