import { findOrCreateChatRoom, getMember, getRoomParticipantIds, listRoomMessages, messagingAllowedError } from "@/lib/services/chat-rooms";
import { canViewContent } from "@/lib/services/content";
import { chat_room_members, chat_room_messages, posts, profiles, subscriptions, users } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { buildProvisionalChatMessage, persistSweetSocketChatMessage, type SweetSocketChatPayload } from "@/lib/services/sweet-socket-chat";
import { findFirstUrl, resolveAndPersistLinkPreview } from "@/lib/services/link-preview";
import { publish, publishDurable, publishForUsers } from "./persistence-bridge";
import { validRelayType } from "./validator";
import { SWEETSOCKET_ERROR } from "./event-map";
import { consumeCommandRateLimit, consumeRelayRateLimit } from "./rate-limit";
import * as manager from "./connection-manager";
import type { SweetSocketClientMessage, SweetSocketConnection } from "./types";

/**
 * Delete-for-everyone is only permitted for a limited time after the message
 * was sent (WhatsApp-style recall window). After this window the author can
 * still delete the message for themselves; only the shared recall is blocked.
 * Set to 0 to disable the window entirely.
 */
const DELETE_FOR_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

async function roomMemberIds(roomId: string): Promise<string[]> {
  return getRoomParticipantIds(roomId).catch(() => []);
}

function fanoutUserEvents(events: Awaited<ReturnType<typeof publishForUsers>>): void {
  for (const event of events) {
    manager.broadcastUsers([event.userId], event);
  }
}

/**
 * A legacy pre-deterministic room was adopted to its canonical derived id.
 * Tell both participants so their local replicas re-key from the old id (their
 * caches may still hold the legacy room) to the canonical one. Durable, so an
 * offline device re-keys on reconnect replay.
 */
async function broadcastRoomMigration(roomId: string, legacyRoomId: string): Promise<void> {
  const recipientIds = await roomMemberIds(roomId);
  const events = await publishForUsers({
    type: "room:migrated",
    userIds: recipientIds,
    roomId,
    resourceId: legacyRoomId,
    payload: { roomId, legacyRoomId },
  });
  fanoutUserEvents(events);
}

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
      manager.send(connection, {
        type: "error",
        code: SWEETSOCKET_ERROR.permission,
        message: "Relay is not allowed for this channel or event",
      });
      return;
    }
    if (!consumeRelayRateLimit(connection.userId, message.channel, message.eventType)) {
      manager.send(connection, {
        type: "error",
        code: SWEETSOCKET_ERROR.rateLimit,
        message: "Relay rate limit exceeded",
      });
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
  if (!consumeCommandRateLimit(connection.userId)) {
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      clientMessageId: message.clientMessageId,
      error: "Rate limit exceeded",
    });
    return;
  }

  if (message.command === "message.send") {
    await handleMessageSend(connection, message);
    return;
  }
  if (message.command === "chat.history") {
    await handleChatHistory(connection, message);
    return;
  }
  if (message.command === "chat.read") {
    await handleChatRead(connection, message);
    return;
  }
  if (message.command === "chat.clear") {
    await handleChatClear(connection, message);
    return;
  }
  if (message.command === "message.delete") {
    await handleMessageDelete(connection, message);
    return;
  }
  if (message.command === "message.edit") {
    await handleMessageEdit(connection, message);
    return;
  }
  if (message.command === "message.reaction") {
    await handleMessageReaction(connection, message);
    return;
  }

  manager.send(connection, {
    type: "ack",
    requestId: message.requestId,
    command: message.command,
    status: "failed",
    error: "Unsupported command",
  });
}

/**
 * chat:read — the reader marks the room read over the socket. Persists the
 * member's last_read_at durably (same write as the legacy /read route) and
 * emits a `message:read` event to the room so the other participant's bubbles
 * flip to read instantly — no HTTP round-trip for the initiating client.
 */
async function handleChatRead(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
): Promise<void> {
  const roomId = message.channel?.replace(/^chat:/, "") ?? "";
  if (!roomId) {
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      error: "room is required",
    });
    return;
  }
  const member = await getMember(roomId, connection.userId).catch(() => null);
  if (!member) {
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      error: "Not a member of this room",
    });
    return;
  }
  const lastReadAt = new Date().toISOString();
  await db
    .update(chat_room_members)
    .set({ last_read_at: lastReadAt })
    .where(eq(chat_room_members.id, member.id));
  const event = publish({
    type: "message:read",
    userId: connection.userId,
    channel: `chat:${roomId}`,
    roomId,
    resourceId: roomId,
    payload: { userId: connection.userId, lastReadAt, roomId },
    durable: false,
  });
  // Fan out to the room — the other participant sees "read" and the reader's
  // own devices zero the unread badge, all through the same store.
  manager.broadcast(`chat:${roomId}`, event);
  manager.send(connection, {
    type: "ack",
    requestId: message.requestId,
    command: message.command,
    status: "persisted",
    event,
  });
}

/**
 * chat:clear — the actor clears the room over the socket. Persists cleared_at
 * and emits a durable chat:clear to the actor's private channel so all their
 * devices drop the local replica immediately.
 */
async function handleChatClear(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
): Promise<void> {
  const roomId = message.channel?.replace(/^chat:/, "") ?? "";
  if (!roomId) {
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      error: "room is required",
    });
    return;
  }
  const member = await getMember(roomId, connection.userId).catch(() => null);
  if (!member) {
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      error: "Not a member of this room",
    });
    return;
  }
  const clearedAt = new Date().toISOString();
  await db.update(chat_room_members).set({ cleared_at: clearedAt }).where(eq(chat_room_members.id, member.id));
  const event = await publishDurable({
    type: "chat:clear",
    userId: connection.userId,
    channel: `user:${connection.userId}`,
    roomId,
    resourceId: roomId,
    payload: { roomId, userId: connection.userId, clearedAt },
  });
  manager.broadcastUsers([connection.userId], event);
  manager.send(connection, {
    type: "ack",
    requestId: message.requestId,
    command: message.command,
    status: "persisted",
    event,
  });
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseReactionArray(value: string | null): Array<{ emoji: string; user_ids: string[] }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { emoji?: unknown; user_ids?: unknown } => !!item && typeof item === "object")
      .map((item) => ({
        emoji: String(item.emoji ?? ""),
        user_ids: Array.isArray(item.user_ids) ? item.user_ids.map(String) : [],
      }))
      .filter((item) => item.emoji.length > 0);
  } catch {
    return [];
  }
}

/**
 * message:delete — validates authorization (recall requires the author/admin),
 * persists delete-for-me / recall, then broadcasts messages:delete to the room.
 */
async function handleMessageDelete(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
): Promise<void> {
  const roomId = message.channel?.replace(/^chat:/, "") ?? "";
  const messageId = typeof message.payload?.messageId === "string" ? message.payload.messageId : "";
  const scope = message.payload?.scope === "everyone" ? "everyone" : "me";
  if (!roomId || !messageId) return ackFail(connection, message, "room and messageId are required");
  const member = await getMember(roomId, connection.userId).catch(() => null);
  if (!member) return ackFail(connection, message, "Chat room not found");
  const [row] = await db
    .select({
      id: chat_room_messages.id,
      sender_id: chat_room_messages.sender_id,
      deleted_for: chat_room_messages.deleted_for,
      created_at: chat_room_messages.created_at,
    })
    .from(chat_room_messages)
    .where(and(eq(chat_room_messages.id, messageId), eq(chat_room_messages.chat_room_id, roomId)))
    .limit(1);
  if (!row) return ackFail(connection, message, "Message not found");
  if (scope === "everyone" && row.sender_id !== connection.userId) {
    return ackFail(connection, message, "Forbidden");
  }
  if (scope === "everyone" && DELETE_FOR_EVERYONE_WINDOW_MS > 0 && row.created_at) {
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > DELETE_FOR_EVERYONE_WINDOW_MS) {
      return ackFail(connection, message, "Delete for everyone is only available for a limited time after sending");
    }
  }
  if (scope === "everyone") {
    await db.update(chat_room_messages).set({ is_recalled: true, updated_at: new Date().toISOString() }).where(eq(chat_room_messages.id, messageId));
  } else {
    const deletedFor = parseJsonArray(row.deleted_for);
    if (!deletedFor.includes(connection.userId)) {
      deletedFor.push(connection.userId);
      await db.update(chat_room_messages).set({ deleted_for: JSON.stringify(deletedFor), updated_at: new Date().toISOString() }).where(eq(chat_room_messages.id, messageId));
    }
  }
  const recipients = await roomMemberIds(roomId);
  const userEvents = await publishForUsers({
    type: "messages:delete",
    userIds: recipients,
    roomId,
    resourceId: messageId,
    payload: { messageId, roomId, scope, userId: connection.userId },
  });
  fanoutUserEvents(userEvents);
  const event = userEvents.find((candidate) => candidate.userId === connection.userId) ?? userEvents[0];
  if (event) manager.send(connection, { type: "ack", requestId: message.requestId, command: message.command, status: "persisted", event });
}

/**
 * message:edit — author-only body edit. Persists is_edited and broadcasts
 * messages:update to the room.
 */
async function handleMessageEdit(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
): Promise<void> {
  const roomId = message.channel?.replace(/^chat:/, "") ?? "";
  const messageId = typeof message.payload?.messageId === "string" ? message.payload.messageId : "";
  const body = typeof message.payload?.body === "string" ? message.payload.body : null;
  const caption = typeof message.payload?.caption === "string" ? message.payload.caption : null;
  if (!roomId || !messageId || (body === null && caption === null)) {
    return ackFail(connection, message, "room, messageId and a body or caption are required");
  }
  const member = await getMember(roomId, connection.userId).catch(() => null);
  if (!member) return ackFail(connection, message, "Chat room not found");
  const [row] = await db
    .select({ id: chat_room_messages.id, sender_id: chat_room_messages.sender_id })
    .from(chat_room_messages)
    .where(and(eq(chat_room_messages.id, messageId), eq(chat_room_messages.chat_room_id, roomId)))
    .limit(1);
  if (!row) return ackFail(connection, message, "Message not found");
  if (row.sender_id !== connection.userId) return ackFail(connection, message, "Forbidden");
  // Body and/or caption may be updated independently — a caption-only edit must
  // not clobber the body (and vice versa).
  const patch: Record<string, unknown> = { is_edited: true, updated_at: new Date().toISOString() };
  if (body !== null) patch.body = body;
  if (caption !== null) patch.caption = caption;
  await db
    .update(chat_room_messages)
    .set(patch)
    .where(eq(chat_room_messages.id, messageId));
  const recipients = await roomMemberIds(roomId);
  const userEvents = await publishForUsers({
    type: "messages:update",
    userIds: recipients,
    roomId,
    resourceId: messageId,
    payload: { messageId, roomId, body, caption, isEdited: true },
  });
  fanoutUserEvents(userEvents);
  const event = userEvents.find((candidate) => candidate.userId === connection.userId) ?? userEvents[0];
  if (event) manager.send(connection, { type: "ack", requestId: message.requestId, command: message.command, status: "persisted", event });

  // Re-resolve the link preview after a BODY edit — the new body may contain a
  // different URL (or none). A caption-only edit leaves the body preview alone.
  // Fire-and-forget: the edit already broadcast.
  void (async () => {
    if (body === null) return;
    const url = findFirstUrl(body);
    if (url) {
      const preview = await resolveAndPersistLinkPreview(messageId, body);
      if (preview) {
        const previewUpdates = await publishForUsers({
          type: "messages:update",
          userIds: await roomMemberIds(roomId),
          roomId,
          resourceId: messageId,
          payload: { messageId, roomId, linkPreview: preview },
        });
        fanoutUserEvents(previewUpdates);
      }
    } else {
      // URL removed — clear any stored preview so the bubble doesn't keep a
      // stale card after the text is edited away.
      try {
        await db
          .update(chat_room_messages)
          .set({ link_preview: null, updated_at: new Date().toISOString() })
          .where(eq(chat_room_messages.id, messageId));
      } catch {}
      const clearedUpdates = await publishForUsers({
        type: "messages:update",
        userIds: await roomMemberIds(roomId),
        roomId,
        resourceId: messageId,
        payload: { messageId, roomId, linkPreview: null },
      });
      fanoutUserEvents(clearedUpdates);
    }
  })();
}

/**
 * message:reaction — toggles the caller's emoji on a message, persists, and
 * broadcasts messages:reaction to the room. Idempotent: same emoji again
 * removes the reaction.
 */
async function handleMessageReaction(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
): Promise<void> {
  const roomId = message.channel?.replace(/^chat:/, "") ?? "";
  const messageId = typeof message.payload?.messageId === "string" ? message.payload.messageId : "";
  const emoji = typeof message.payload?.emoji === "string" ? message.payload.emoji : "";
  if (!roomId || !messageId || !emoji) return ackFail(connection, message, "room, messageId and emoji are required");
  const member = await getMember(roomId, connection.userId).catch(() => null);
  if (!member) return ackFail(connection, message, "Chat room not found");
  const [row] = await db
    .select({ id: chat_room_messages.id, reactions: chat_room_messages.reactions })
    .from(chat_room_messages)
    .where(and(eq(chat_room_messages.id, messageId), eq(chat_room_messages.chat_room_id, roomId)))
    .limit(1);
  if (!row) return ackFail(connection, message, "Message not found");

  const reactions = parseReactionArray(row.reactions);
  const idx = reactions.findIndex((r) => r.emoji === emoji);
  if (idx === -1) {
    reactions.push({ emoji, user_ids: [connection.userId] });
  } else {
    const ids = (reactions[idx].user_ids ?? []).map(String);
    const pos = ids.indexOf(connection.userId);
    if (pos === -1) ids.push(connection.userId);
    else ids.splice(pos, 1);
    reactions[idx].user_ids = ids;
    if (ids.length === 0) reactions.splice(idx, 1);
  }
  await db
    .update(chat_room_messages)
    .set({ reactions: JSON.stringify(reactions), updated_at: new Date().toISOString() })
    .where(eq(chat_room_messages.id, messageId));
  const shaped = reactions.map((r) => ({
    emoji: r.emoji,
    user_ids: (r.user_ids ?? []).map(String),
    userIds: (r.user_ids ?? []).map(String),
  }));
  const recipients = await roomMemberIds(roomId);
  const userEvents = await publishForUsers({
    type: "messages:reaction",
    userIds: recipients,
    roomId,
    resourceId: messageId,
    payload: { messageId, roomId, reactions: shaped },
  });
  fanoutUserEvents(userEvents);
  const event = userEvents.find((candidate) => candidate.userId === connection.userId) ?? userEvents[0];
  if (event) manager.send(connection, { type: "ack", requestId: message.requestId, command: message.command, status: "persisted", event });
}

function ackFail(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
  error: string,
): void {
  manager.send(connection, { type: "ack", requestId: message.requestId, command: message.command, status: "failed", error });
}

/**
 * chat:history — explicitly request durable history from Turso over the
 * socket. This is the realtime equivalent of GET /messages (which remains the
 * offline/recovery fallback). The response is a `history:set` event delivered
 * only to the requesting connection, plus the command ack carrying the same
 * messages, so the client can resolve the command AND merge deterministically
 * by message id.
 */
async function handleChatHistory(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
): Promise<void> {
  const channelRoomId = message.channel?.replace(/^chat:/, "") ?? "";
  if (!channelRoomId) {
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      error: "room is required",
    });
    return;
  }
  const payload = message.payload ?? {};
  const before = typeof payload.before === "string" ? payload.before : undefined;
  const after = typeof payload.after === "string" ? payload.after : undefined;
  const limitRaw = typeof payload.limit === "number" ? payload.limit : undefined;
  const participantId = typeof payload.participantId === "string" ? payload.participantId : "";
  let roomId = channelRoomId;
  try {
    if (participantId) {
      // Fresh/virtual room: resolve (and lazily materialize) the canonical
      // derived room for the pair — no HTTP get-or-create needed. The client
      // derives the same id locally, so this always matches.
      const policyError = await messagingAllowedError(connection.userId, participantId);
      if (policyError) {
        manager.send(connection, {
          type: "ack",
          requestId: message.requestId,
          command: message.command,
          status: "failed",
          error: policyError,
        });
        return;
      }
      const resolved = await findOrCreateChatRoom(connection.userId, participantId);
      roomId = resolved.chatRoomId;
      if (resolved.migratedFrom) {
        await broadcastRoomMigration(roomId, resolved.migratedFrom);
      }
    } else if (!(await authorizeChannel(`chat:${roomId}`, connection.userId))) {
      manager.send(connection, {
        type: "ack",
        requestId: message.requestId,
        command: message.command,
        status: "failed",
        error: "Chat room not found",
      });
      return;
    }
    const messages = await listRoomMessages(roomId, connection.userId, {
      before,
      after,
      limit: limitRaw,
    });
    const event = publish({
      type: "history:set",
      userId: connection.userId,
      roomId,
      resourceId: roomId,
      payload: { roomId, messages, before, hasMore: messages.length >= (limitRaw ?? 30) },
      durable: false,
    });
    // history:set targets only the requesting connection — never broadcast.
    manager.send(connection, { type: "event", event });
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "persisted",
      event,
    });
  } catch (error) {
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      error: error instanceof Error ? error.message : "History could not be loaded",
    });
  }
}

async function handleMessageSend(
  connection: SweetSocketConnection,
  message: Extract<SweetSocketClientMessage, { type: "command" }>,
): Promise<void> {
  const channelRoomId = message.channel?.replace(/^chat:/, "") ?? "";
  const clientMessageId = message.clientMessageId ?? "";
  if (!channelRoomId || !clientMessageId) {
    manager.send(connection, {
      type: "ack",
      requestId: message.requestId,
      command: message.command,
      status: "failed",
      error: "room and clientMessageId are required",
    });
    return;
  }
  const payload = message.payload ?? {};
  const participantId = typeof payload.participantId === "string" ? payload.participantId : "";
  let roomId = channelRoomId;
  try {
    // Fresh/virtual room: the client derives the canonical room id locally
    // (deterministicDmRoomId mirror) and sends the recipient's id so the
    // server can materialize the room lazily — no HTTP get-or-create, and the
    // recipient's messaging policy is enforced right here on first contact.
    if (participantId) {
      const policyError = await messagingAllowedError(connection.userId, participantId);
      if (policyError) {
        manager.send(connection, {
          type: "ack",
          requestId: message.requestId,
          command: message.command,
          status: "failed",
          clientMessageId,
          error: policyError,
        });
        return;
      }
      const resolved = await findOrCreateChatRoom(connection.userId, participantId);
      roomId = resolved.chatRoomId;
      if (resolved.migratedFrom) {
        await broadcastRoomMigration(roomId, resolved.migratedFrom);
      }
    } else if (!(await authorizeChannel(`chat:${roomId}`, connection.userId))) {
      // Existing room: verify membership before any live event is emitted.
      // This prevents an unauthorized sender from briefly projecting a message
      // that persistence will later reject.
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
    //
    // The provisional message MUST carry the full media metadata (the same
    // fields the persisted event carries) — the recipient renders the
    // provisional bubble immediately, so a voice note must already know it is
    // a voice note and an image must keep its mime/file metadata. Dropping
    // these fields here is what made voice notes flash as file bubbles and
    // audio durations vanish until the persisted event arrived.
    const chatPayload = normalizeChatPayload(payload);
    const provisional = publish({
      type: "messages:upsert",
      userId: connection.userId,
      channel: `chat:${roomId}`,
      roomId,
      resourceId: clientMessageId,
      clientMessageId,
      durable: false,
      payload: {
        message: buildProvisionalChatMessage({
          clientMessageId,
          roomId,
          userId: connection.userId,
          payload: chatPayload,
          sender: await senderPayload(connection.userId),
        }),
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
    // The durable authoritative event is private-user fanout. Every member
    // receives it through their always-on authenticated channel, regardless of
    // whether a room screen is open or the other device is offline.
    const recipients = await roomMemberIds(roomId);
    const persistedEvents = await publishForUsers({
      type: "messages:upsert",
      userIds: recipients,
      roomId,
      resourceId: result.message.id,
      clientMessageId,
      payload: { message: result.message, clientMessageId, status: "persisted" },
    });
    fanoutUserEvents(persistedEvents);
    const persisted = persistedEvents.find((event) => event.userId === connection.userId) ?? persistedEvents[0];
    if (persisted) {
      manager.send(connection, {
        type: "ack",
        requestId: message.requestId,
        command: message.command,
        status: "persisted",
        clientMessageId,
        event: persisted,
      });
    }

    // Rich link preview: resolve the pasted URL's metadata in parallel with
    // the send (never blocking it). When it lands, persist it on the row and
    // broadcast a messages:update so BOTH participants' bubbles gain the card
    // the moment metadata is available — no re-fetch on chat open, no polling.
    const url = findFirstUrl(chatPayload.body);
    if (url) {
      void (async () => {
        const preview = await resolveAndPersistLinkPreview(result.message.id, chatPayload.body);
        if (!preview) return;
        const updates = await publishForUsers({
          type: "messages:update",
          userIds: await roomMemberIds(roomId),
          roomId,
          resourceId: result.message.id,
          payload: {
            messageId: result.message.id,
            roomId,
            linkPreview: preview,
          },
        });
        fanoutUserEvents(updates);
      })();
    }

    // Auto delivery receipt (Baileys message-receipt.update equivalent): when
    // the recipient currently has a live connection subscribed to this room,
    // tell the sender their message was delivered — no HTTP round-trip, no
    // polling. Idempotent per persisted message id; read state remains the
    // durable signal via chat_room_members.read_at.
    // Auto delivery receipt (Baileys message-receipt.update equivalent): when
    // the recipient has ANY live connection (not just the room open), tell the
    // sender their message was delivered — WhatsApp shows "delivered" once the
    // recipient's device received it, whether or not they are viewing the chat.
    const liveRecipients = (await roomMemberIds(roomId)).filter((id) => id !== connection.userId);
    for (const recipientId of liveRecipients) {
      if (manager.connectionsForUser(recipientId).length > 0) {
        const delivered = publish({
          type: "message:receipt",
          userId: connection.userId,
          channel: `user:${connection.userId}`,
          roomId,
          resourceId: result.message.id,
          payload: {
            messageId: result.message.id,
            roomId,
            userId: recipientId,
            status: "delivered",
          },
          durable: false,
        });
        manager.broadcastUsers([connection.userId], delivered);
      }
    }
  } catch (error) {
    const failed = await publishDurable({
      type: "message:failed",
      userId: connection.userId,
      channel: `user:${connection.userId}`,
      roomId,
      resourceId: clientMessageId,
      clientMessageId,
      payload: { clientMessageId, roomId, error: error instanceof Error ? error.message : "Message persistence failed" },
    });
    manager.broadcastUsers([connection.userId], failed);
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

async function senderPayload(userId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      is_verified: users.is_verified,
      is_creator: users.is_creator,
      display_name: profiles.display_name,
      avatar_url: profiles.avatar_url,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  return {
    id: userId,
    name: row?.display_name ?? row?.full_name ?? "User",
    username: row?.username ?? "",
    avatarUrl: row?.avatar_url ?? null,
    avatar_url: row?.avatar_url ?? null,
    is_verified: Boolean(row?.is_verified),
    is_creator: Boolean(row?.is_creator),
  };
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


