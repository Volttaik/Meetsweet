import { randomUUID } from "crypto";
import type { SweetSocketEvent } from "./types";

/** Convert legacy dotted names to the canonical domain:event protocol. */
export function canonicalEventType(type: string): string {
  const aliases: Record<string, string> = {
    "message.new": "message:created",
    "message.ack": "message:acknowledged",
    "message.failed": "message:failed",
    "message.updated": "message:updated",
    "message.deleted": "message:deleted",
    "chat.message.created": "message:created",
    "chat.message.updated": "message:updated",
    "chat.message.deleted": "message:deleted",
    "chat.message.read": "message:read",
    "chat.typing.started": "typing:start",
    "chat.typing.stopped": "typing:stop",
    "chat.recording.started": "voice:start",
    "chat.recording.stopped": "voice:stop",
    "chat.presence.updated": "presence:updated",
    "presence.online": "presence:online",
    "presence.offline": "presence:offline",
    "post.comment.created": "comment:created",
    "post.comment.updated": "comment:updated",
    "post.comment.deleted": "comment:deleted",
    "post.like.updated": "like:updated",
    "notification.created": "notification:new",
    "notification.new": "notification:new",
    "notification.read": "notification:read",
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
