import { getMember } from "@/lib/services/chat-rooms";
import { canViewContent } from "@/lib/services/content";
import { posts, subscriptions } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { persistSweetSocketChatMessage, type SweetSocketChatPayload } from "@/lib/services/sweet-socket-chat";
import { publish } from "./persistence-bridge";
import { validRelayType } from "./validator";
import * as manager from "./connection-manager";
import type { SweetSocketClientMessage, SweetSocketConnection, SweetSocketEvent } from "./types";

const commandTimestamps = new Map<string, number[]>();
const COMMAND_WINDOW_MS = 10_000;
const MAX_COMMANDS_PER_WINDOW = 40;

export async function authorizeChannel(channel: string, userId: string): Promise<boolean> {
  const separator = channel.indexOf(":");
  if (separator <= 0) return false;
  const kind = channel.slice(0, separator);
  const id = channel.slice(separator + 1);
  if (!id || id.length > 140) return false;
  if (kind === "user") return id === userId;
  if (kind === "chat" || kind === "conversation") return Boolean(await getMember(id, userId).catch(() => null));
  if (kind === "post") {
    const [post] = await db
      .select({ creatorId: posts.creator_id, visibility: posts.visibility, tier: posts.tier })
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);
    if (!post) return false;
    if (post.creatorId === userId) return true;
    if (post.visibility === "public" && (!post.tier || post.tier === "free")) return true;
    const [subscription] = await db
      .select({ tier: subscriptions.tier })
      .from(subscriptions)
      .where(and(
        eq(subscriptions.subscriber_id, userId),
        eq(subscriptions.creator_id, post.creatorId),
        eq(subscriptions.status, "active"),
      ))
      .limit(1);
    return canViewContent(
      post.visibility,
      post.tier,
      Boolean(subscription),
      subscription?.tier ?? null,
      false,
    );
  }
  return false;
}

export async function handleClientMessage(
  connection: SweetSocketConnection,
  message: SweetSocketClientMessage,
): Promise<void> {
  if (message.type === "relay") {
    if (!validRelayType(message.eventType) || !(await authorizeChannel(message.channel, connection.userId))) {
      manager.send(connection, { type: "error", code: "FORBIDDEN_RELAY", message: "Relay is not allowed for this channel or event" });
      return;
    }
    const eventType = normalizeRelayType(message.eventType);
    const event = publish({
      type: eventType,
      userId: connection.userId,
      channel: message.channel,
      roomId: message.channel.split(":")[1],
      payload: { ...(message.payload ?? {}), userId: connection.userId },
      durable: false,
    });
    if (message.channel) manager.broadcast(message.channel, event);
    return;
  }

  if (message.type !== "command") return;
  if (!consumeRateLimit(connection.userId)) {
    manager.send(connection, { type: "ack", requestId: message.requestId, command: message.command, status: "failed", clientMessageId: message.clientMessageId, error: "Rate limit exceeded" });
    return;
  }

  if (message.command === "message.send") {
    await handleMessageSend(connection, message);
    return;
  }

  manager.send(connection, { type: "ack", requestId: message.requestId, command: message.command, status: "failed", error: "Unsupported command" });
}

async function handleMessageSend(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
): Promise<void> {
  const roomId = message.channel?.replace(/^chat:/, "") ?? "";
  const clientMessageId = message.clientMessageId ?? "";
  if (!roomId || !clientMessageId) {
    manager.send(connection, { type: "ack", requestId: message.requestId, command: message.command, status: "failed", error: "room and clientMessageId are required" });
    return;
  }
  const payload = message.payload ?? {};
  try {
    // Verify membership before any live event is emitted. This prevents an
    // unauthorized sender from briefly projecting a message that persistence
    // will later reject.
    if (!(await authorizeChannel(`chat:${roomId}`, connection.userId))) {
      manager.send(connection, {
        type: "ack",
        requestId: message.requestId,
        command: message.command,
        status: "failed",
        clientMessageId,
        error: "Chat room not found",
      });
      return;
    }

    // Push the accepted event before awaiting Turso. The client already has
    // the same optimistic object and reconciles this event by client ID.
    const provisional = publish({
      type: "message.new",
      userId: connection.userId,
      channel: `chat:${roomId}`,
      roomId,
      resourceId: clientMessageId,
      clientMessageId,
      durable: false,
      payload: {
        message: {
          id: clientMessageId,
          chatRoomId: roomId,
          body: typeof payload.body === "string" ? payload.body : null,
          mediaUrl: typeof payload.mediaUrl === "string" ? payload.mediaUrl : null,
          mediaType: typeof payload.mediaType === "string" ? payload.mediaType : null,
          caption: typeof payload.caption === "string" ? payload.caption : null,
          createdAt: new Date().toISOString(),
          sender: { id: connection.userId },
          // The recipient derives ownership from the authenticated session;
          // do not mark a broadcast payload as own for every client.
          isDeleted: false,
          clientMessageId,
          pending: true,
        },
        clientMessageId,
        status: "accepted",
      },
    });
    manager.broadcast(`chat:${roomId}`, provisional);
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "accepted",
      clientMessageId,
      event: provisional,
    });

    const result = await persistSweetSocketChatMessage({
      roomId,
      userId: connection.userId,
      clientMessageId,
      payload: normalizeChatPayload(payload),
    });
    const persisted = publish({
      type: "message.ack",
      userId: connection.userId,
      channel: `chat:${roomId}`,
      roomId,
      resourceId: result.message.id,
      clientMessageId,
      payload: { message: result.message, clientMessageId, status: "persisted" },
    });
    manager.broadcast(`chat:${roomId}`, persisted);
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "persisted",
      clientMessageId,
      event: persisted,
    });
  } catch (error) {
    const failed = publish({
      type: "message.failed",
      userId: connection.userId,
      channel: `chat:${roomId}`,
      roomId,
      resourceId: clientMessageId,
      clientMessageId,
      payload: { clientMessageId, error: error instanceof Error ? error.message : "Message persistence failed" },
    });
    manager.broadcast(`chat:${roomId}`, failed);
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      clientMessageId,
      event: failed,
      error: error instanceof Error ? error.message : "Message persistence failed",
    });
  }
}

function normalizeChatPayload(payload: Record<string, unknown>): SweetSocketChatPayload {
  return {
    body: typeof payload.body === "string" ? payload.body : null,
    mediaUrl: typeof payload.mediaUrl === "string" ? payload.mediaUrl : typeof payload.media_url === "string" ? payload.media_url : null,
    mediaType: typeof payload.mediaType === "string" ? payload.mediaType as SweetSocketChatPayload["mediaType"] : typeof payload.media_type === "string" ? payload.media_type as SweetSocketChatPayload["mediaType"] : null,
    caption: typeof payload.caption === "string" ? payload.caption : null,
    fileName: typeof payload.fileName === "string" ? payload.fileName : null,
    fileSize: typeof payload.fileSize === "number" ? payload.fileSize : null,
    mimeType: typeof payload.mimeType === "string" ? payload.mimeType : null,
    audioDuration: typeof payload.audioDuration === "number" ? payload.audioDuration : null,
    fileType: typeof payload.fileType === "string" ? payload.fileType : null,
    isVoiceNote: typeof payload.isVoiceNote === "boolean" ? payload.isVoiceNote : null,
    replyToId: typeof payload.replyToId === "string" ? payload.replyToId : typeof payload.reply_to_id === "string" ? payload.reply_to_id : null,
  };
}

function normalizeRelayType(type: string): string {
  // Legacy dotted names from the pre-canonical protocol are mapped to the
  // canonical domain:event names the mobile client listens for. Presence is
  // delivered as presence:updated with the `online` flag in the payload (the
  // emitting client announces connect/disconnect with the same event type), so
  // the old alias that always produced presence.online is gone.
  const aliases: Record<string, string> = {
    "chat.typing.started": "typing:start",
    "chat.typing.stopped": "typing:stop",
    "chat.recording.started": "voice:start",
    "chat.recording.stopped": "voice:stop",
    "chat.presence.updated": "presence:updated",
    "typing.start": "typing:start",
    "typing.stop": "typing:stop",
    "recording.start": "voice:start",
    "recording.stop": "voice:stop",
    "presence.online": "presence:online",
    "presence.offline": "presence:offline",
  };
  return aliases[type] ?? type;
}

function consumeRateLimit(userId: string): boolean {
  const now = Date.now();
  const current = (commandTimestamps.get(userId) ?? []).filter((timestamp) => timestamp > now - COMMAND_WINDOW_MS);
  if (current.length >= MAX_COMMANDS_PER_WINDOW) {
    commandTimestamps.set(userId, current);
    return false;
  }
  current.push(now);
  commandTimestamps.set(userId, current);
  return true;
}
