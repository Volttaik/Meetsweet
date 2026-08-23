/**
 * SweetSocket Event Map — the single source of truth for every realtime event
 * in MeetSweet.
 *
 * Architectural inspiration (adapted, not copied): Baileys models WhatsApp's
 * realtime surface as a typed event stream — messages.upsert / messages.update /
 * messages.delete / chats.upsert / presence.update — where state changes are
 * events, and a separate store listens to those events to keep application
 * state synchronized. SweetSocket does the same for MeetSweet's much simpler
 * domain: one canonical event name per state change, a typed payload, and one
 * broadcast channel. There is deliberately NO duplicate set of "domain" event
 * names scattered across the codebase — emitEvent() canonicalizes everything
 * through this map.
 *
 * Every event here has:
 *   - a canonical wire name (colon form, e.g. `messages:upsert`),
 *   - a typed payload (see SweetSocketEventMap),
 *   - a channel kind (who may receive it),
 *   - durability (whether it is appended to the Turso outbox for reconnect
 *     replay — ephemeral events like typing/presence are never persisted),
 *   - an auth requirement (who may subscribe to the channel).
 *
 * Legacy dotted aliases (message.new, chat.message.updated, …) map onto these
 * canonical names in event-emitter.ts and are accepted on the wire only during
 * client rollout.
 */

// ─── Canonical event names ────────────────────────────────────────────────────

export const SWEETSOCKET_EVENT = {
  // ── Connection / session ──────────────────────────────────────────────────
  connectionUpdate: "connection:update",
  connectionReady: "connection:ready",
  connectionClose: "connection:close",
  sessionUpdate: "session:update",
  sessionExpired: "session:expired",

  // ── Messages (Baileys-equivalents) ────────────────────────────────────────
  messagesUpsert: "messages:upsert",
  messagesUpdate: "messages:update",
  messagesDelete: "messages:delete",
  messagesReaction: "messages:reaction",
  messageReceipt: "message:receipt",
  messageRead: "message:read",
  messageFailed: "message:failed",
  // Legacy names still recognized (alias targets for older clients).
  messageCreated: "messages:upsert",
  messageUpdated: "messages:update",
  messageDeleted: "messages:delete",
  messageAck: "message:receipt",
  reactionUpdated: "messages:reaction",

  // ── Chats (chat list control) ─────────────────────────────────────────────
  chatsUpsert: "chats:upsert",
  chatsUpdate: "chats:update",
  chatsDelete: "chats:delete",
  chatOpen: "chat:open",
  chatClose: "chat:close",
  chatClear: "chat:clear",
  chatHistory: "chat:history",
  historySet: "history:set",

  // ── Ephemeral state ───────────────────────────────────────────────────────
  typingStart: "typing:start",
  typingStop: "typing:stop",
  recordingStart: "voice:start",
  recordingStop: "voice:stop",
  presenceOnline: "presence:online",
  presenceOffline: "presence:offline",
  presenceUpdated: "presence:updated",

  // ── Notifications ─────────────────────────────────────────────────────────
  notificationNew: "notification:new",
  notificationRead: "notification:read",
  notificationReadAll: "notification:read-all",
  notificationDeleted: "notification:delete",

  // ── Posts / social ────────────────────────────────────────────────────────
  postCreated: "post:created",
  postUpdated: "post:updated",
  postDeleted: "post:deleted",
  postLike: "like:created",
  postUnlike: "like:removed",
  likeUpdated: "like:updated",
  commentCreated: "comment:created",
  commentUpdated: "comment:updated",
  commentDeleted: "comment:deleted",
  shareCreated: "share:created",

  // ── Albums ────────────────────────────────────────────────────────────────
  albumPurchased: "album:purchased",

  // ── Wallet / payments / subscriptions ─────────────────────────────────────
  walletUpdated: "wallet:updated",
  balanceUpdated: "balance:updated",
  transactionCompleted: "transaction:completed",
  subscriptionCreated: "subscription:created",
  subscriptionCancelled: "subscription:cancelled",
  subscriptionUpdated: "subscription:updated",
} as const;

export type SweetSocketEventName = (typeof SWEETSOCKET_EVENT)[keyof typeof SWEETSOCKET_EVENT];

// ─── Typed payloads ───────────────────────────────────────────────────────────

export type SweetSocketChatMessagePayload = {
  message?: Record<string, unknown>;
  clientMessageId?: string;
  status?: "accepted" | "persisted";
};

export type SweetSocketChatRoomPayload = {
  room?: Record<string, unknown>;
  roomId?: string;
  patch?: Record<string, unknown>;
  userId?: string;
  clearedAt?: string;
};

export interface SweetSocketEventMap {
  "connection:update": { state: string; reason?: string };
  "connection:ready": { state: "ready" };
  "connection:close": { reason?: string; code?: number };
  "session:update": { state: "authenticated" | "session_expired" | "logout"; reason?: string };
  "session:expired": { reason?: string };

  "messages:upsert": SweetSocketChatMessagePayload;
  "messages:update": {
    messageId: string;
    roomId?: string;
    body?: string;
    isEdited?: boolean;
    message?: Record<string, unknown>;
  };
  "messages:delete": { messageId: string; roomId?: string; scope?: "me" | "everyone"; userId?: string };
  "messages:reaction": { messageId: string; roomId?: string; reactions: Array<{ emoji: string; userIds: string[] }> };
  "message:receipt": {
    messageId?: string;
    roomId?: string;
    userId: string;
    status: "sent" | "delivered" | "read";
    lastReadAt?: string;
    clientMessageId?: string;
    message?: Record<string, unknown>;
  };
  "message:read": { userId: string; lastReadAt: string; roomId?: string };
  "message:failed": { clientMessageId?: string; error?: string; roomId?: string };

  "chats:upsert": SweetSocketChatRoomPayload;
  "chats:update": SweetSocketChatRoomPayload;
  "chats:delete": { roomId: string; userId?: string };
  "chat:open": { roomId: string; userId: string };
  "chat:close": { roomId: string; userId: string };
  "chat:clear": { roomId: string; userId: string; clearedAt: string };
  "chat:history": { before?: string; after?: string; limit?: number };
  "history:set": { roomId: string; messages: unknown[]; before?: string; hasMore: boolean };

  "typing:start": { roomId?: string; userId: string };
  "typing:stop": { roomId?: string; userId: string };
  "voice:start": { roomId?: string; userId: string };
  "voice:stop": { roomId?: string; userId: string };
  "presence:online": { userId: string };
  "presence:offline": { userId: string };
  "presence:updated": { userId: string; online?: boolean };

  "notification:new": { notification?: Record<string, unknown>; count?: number };
  "notification:read": { notificationId?: string; all?: boolean };
  "notification:read-all": { all: true };
  "notification:delete": { notificationId: string };

  "post:created": { post?: Record<string, unknown>; postId?: string };
  "post:updated": { postId: string; post?: Record<string, unknown> };
  "post:deleted": { postId: string };
  "like:created": { postId?: string; likeCount?: number; liked?: boolean; userId?: string };
  "like:removed": { postId?: string; likeCount?: number; liked?: boolean; userId?: string };
  "like:updated": { postId?: string; likeCount?: number; liked?: boolean; userId?: string };
  "comment:created": { comment?: Record<string, unknown>; commentCount?: number; postId?: string };
  "comment:updated": { commentId?: string; comment?: Record<string, unknown> };
  "comment:deleted": { commentId?: string; commentCount?: number };
  "share:created": { contentId?: string; share?: Record<string, unknown> };

  "album:purchased": { albumId?: string; userId?: string };

  "wallet:updated": { balance?: number; newBalance?: number };
  "balance:updated": { balance?: number; newBalance?: number };
  "transaction:completed": { transactionId?: string; status?: string; amount?: number };
  "subscription:created": { creatorId?: string; tier?: string };
  "subscription:cancelled": { creatorId?: string };
  "subscription:updated": { creatorId?: string };
}

// ─── Event metadata (channel kind, durability, auth) ─────────────────────────

export type ChannelKind = "user" | "chat" | "post" | "comments";

export type SweetSocketEventMeta = {
  /** How the broadcast channel for this event is derived. */
  channel: (event: { userId?: string; roomId?: string; resourceId?: string }) => string | null;
  /** Whether the event is appended to the Turso outbox (reconnect replay). */
  durable: boolean;
  /** Auth needed to subscribe to the channel (see authorizeChannel). */
  auth: "self" | "member" | "public";
};

function userChannel(event: { userId?: string }): string | null {
  return event.userId ? `user:${event.userId}` : null;
}

function chatChannel(event: { roomId?: string; resourceId?: string }): string | null {
  return event.roomId ?? event.resourceId ? `chat:${event.roomId ?? event.resourceId ?? ""}` : null;
}

function postChannel(event: { resourceId?: string }): string | null {
  return event.resourceId ? `post:${event.resourceId}` : null;
}

export const SWEETSOCKET_EVENT_META: Record<SweetSocketEventName, SweetSocketEventMeta> = {
  // Connection frames are transport-level, not broadcast events.
  "connection:update": { channel: () => null, durable: false, auth: "self" },
  "connection:ready": { channel: () => null, durable: false, auth: "self" },
  "connection:close": { channel: () => null, durable: false, auth: "self" },
  "session:update": { channel: () => null, durable: false, auth: "self" },
  "session:expired": { channel: () => null, durable: false, auth: "self" },

  // Messages fan out to the room; durable so a reconnecting client converges.
  "messages:upsert": { channel: chatChannel, durable: true, auth: "member" },
  "messages:update": { channel: chatChannel, durable: true, auth: "member" },
  "messages:delete": { channel: chatChannel, durable: true, auth: "member" },
  "messages:reaction": { channel: chatChannel, durable: true, auth: "member" },
  "message:receipt": { channel: chatChannel, durable: false, auth: "member" },
  "message:read": { channel: chatChannel, durable: false, auth: "member" },
  "message:failed": { channel: chatChannel, durable: false, auth: "member" },

  // Chat-list events target the affected participant's private channel so a
  // NEW conversation surfaces without the client subscribing to the room.
  "chats:upsert": { channel: userChannel, durable: true, auth: "self" },
  "chats:update": { channel: userChannel, durable: true, auth: "self" },
  "chats:delete": { channel: userChannel, durable: true, auth: "self" },
  "chat:open": { channel: chatChannel, durable: false, auth: "member" },
  "chat:close": { channel: chatChannel, durable: false, auth: "member" },
  "chat:clear": { channel: userChannel, durable: true, auth: "self" },
  "chat:history": { channel: () => null, durable: false, auth: "self" },
  "history:set": { channel: () => null, durable: false, auth: "self" },

  // Ephemeral — never persisted.
  "typing:start": { channel: chatChannel, durable: false, auth: "member" },
  "typing:stop": { channel: chatChannel, durable: false, auth: "member" },
  "voice:start": { channel: chatChannel, durable: false, auth: "member" },
  "voice:stop": { channel: chatChannel, durable: false, auth: "member" },
  "presence:online": { channel: userChannel, durable: false, auth: "self" },
  "presence:offline": { channel: userChannel, durable: false, auth: "self" },
  "presence:updated": { channel: chatChannel, durable: false, auth: "member" },

  "notification:new": { channel: userChannel, durable: true, auth: "self" },
  "notification:read": { channel: userChannel, durable: true, auth: "self" },
  "notification:read-all": { channel: userChannel, durable: true, auth: "self" },
  "notification:delete": { channel: userChannel, durable: true, auth: "self" },

  "post:created": { channel: userChannel, durable: true, auth: "self" },
  "post:updated": { channel: postChannel, durable: true, auth: "public" },
  "post:deleted": { channel: postChannel, durable: true, auth: "public" },
  "like:created": { channel: postChannel, durable: true, auth: "public" },
  "like:removed": { channel: postChannel, durable: true, auth: "public" },
  "like:updated": { channel: postChannel, durable: true, auth: "public" },
  "comment:created": { channel: postChannel, durable: true, auth: "public" },
  "comment:updated": { channel: postChannel, durable: true, auth: "public" },
  "comment:deleted": { channel: postChannel, durable: true, auth: "public" },
  "share:created": { channel: postChannel, durable: true, auth: "public" },

  "album:purchased": { channel: userChannel, durable: true, auth: "self" },

  "wallet:updated": { channel: userChannel, durable: true, auth: "self" },
  "balance:updated": { channel: userChannel, durable: true, auth: "self" },
  "transaction:completed": { channel: userChannel, durable: true, auth: "self" },
  "subscription:created": { channel: userChannel, durable: true, auth: "self" },
  "subscription:cancelled": { channel: userChannel, durable: true, auth: "self" },
  "subscription:updated": { channel: userChannel, durable: true, auth: "self" },
};

// ─── Structured error codes ───────────────────────────────────────────────────

export const SWEETSOCKET_ERROR = {
  auth: "error:auth",
  permission: "error:permission",
  validation: "error:validation",
  rateLimit: "error:rate-limit",
  server: "error:server",
} as const;

export type SweetSocketErrorCode = (typeof SWEETSOCKET_ERROR)[keyof typeof SWEETSOCKET_ERROR];

/** Whether an event name is a known canonical event (not a legacy alias). */
export function isCanonicalEvent(type: string): type is SweetSocketEventName {
  return type in SWEETSOCKET_EVENT_META;
}
