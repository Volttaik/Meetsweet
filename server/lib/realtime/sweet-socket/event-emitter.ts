import { randomUUID } from "crypto";
import type { SweetSocketEvent } from "./types";

/**
 * Convert any legacy/alternate event name to its canonical `domain:event`
 * form (the names in SWEETSOCKET_EVENT). Every wire name flows through this
 * function, so no domain code ever has to remember a legacy spelling.
 */
export function canonicalEventType(type: string): string {
  const aliases: Record<string, string> = {
    // Messages — legacy spellings → canonical.
    "message.new": "messages:upsert",
    "message.created": "messages:upsert",
    "messages.new": "messages:upsert",
    "chat.message.created": "messages:upsert",
    "message.ack": "message:receipt",
    "message.acknowledged": "message:receipt",
    "message.updated": "messages:update",
    "messages.updated": "messages:update",
    "chat.message.updated": "messages:update",
    "message.deleted": "messages:delete",
    "messages.deleted": "messages:delete",
    "chat.message.deleted": "messages:delete",
    "chat.message.read": "message:read",
    "chat.reaction.updated": "messages:reaction",
    "reaction:updated": "messages:reaction",
    "chat.reaction.added": "messages:reaction",
    "chat.reaction.removed": "messages:reaction",

    // Chats
    "chat.typing.started": "typing:start",
    "chat.typing.stopped": "typing:stop",
    "chat.recording.started": "voice:start",
    "chat.recording.stopped": "voice:stop",
    "chat.presence.updated": "presence:updated",
    "presence.online": "presence:online",
    "presence.offline": "presence:offline",
    "chat.cleared": "chat:clear",

    // Social
    "post.comment.created": "comment:created",
    "post.comment.updated": "comment:updated",
    "post.comment.deleted": "comment:deleted",
    "post.like.updated": "like:updated",
    "post.like.created": "like:created",
    "post.like.removed": "like:removed",
    "notification.created": "notification:new",
    "notification.new": "notification:new",
    "notification.read": "notification:read",
    "notification.read_all": "notification:read-all",
    "notification.deleted": "notification:delete",
    "subscription.count_updated": "subscription:updated",
    "purchase.completed": "album:purchased",
    "payment.completed": "transaction:completed",
    "wallet.updated": "wallet:updated",
  };
  return aliases[type] ?? type;
}

export function createEvent(input: {
  type: string;
  userId: string;
  channel?: string;
  roomId?: string;
  resourceId?: string;
  clientMessageId?: string;
  sequence?: number | null;
  payload?: Record<string, unknown>;
}): SweetSocketEvent {
  return {
    id: randomUUID(),
    version: 1,
    type: canonicalEventType(input.type),
    timestamp: Date.now(),
    userId: input.userId,
    channel: input.channel,
    roomId: input.roomId,
    resourceId: input.resourceId,
    clientMessageId: input.clientMessageId,
    sequence: input.sequence ?? null,
    payload: input.payload ?? {},
  };
}
