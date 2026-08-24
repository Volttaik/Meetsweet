import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat_room_members, chat_room_messages, chat_rooms, profiles, users } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { buildMessage, buildRoom, getMember, isBlockedBetween, messagingAllowedError } from "@/lib/services/chat-rooms";
import { emitEvent } from "@/lib/realtime/emit";
import { SWEETSOCKET_EVENT } from "@/lib/realtime/sweet-socket/event-map";

export type SweetSocketChatPayload = {
  body?: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "audio" | "document" | "gif" | null;
  caption?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  audioDuration?: number | null;
  fileType?: string | null;
  isVoiceNote?: boolean | null;
  replyToId?: string | null;
  linkPreview?: Record<string, unknown> | null;
};

let schemaReady: Promise<void> | null = null;

/** Runtime-safe migration because this project deploys without checked-in SQL migrations. */
export function ensureSweetSocketChatSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await db.run(sql`ALTER TABLE chat_room_messages ADD COLUMN client_message_id TEXT`).catch(() => {});
    await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS chat_room_messages_sender_client_idx ON chat_room_messages(sender_id, client_message_id) WHERE client_message_id IS NOT NULL`).catch(() => {});
    await db.run(sql`ALTER TABLE chat_room_messages ADD COLUMN link_preview TEXT`).catch(() => {});
  })();
  return schemaReady;
}

/**
 * Build the PROVISIONAL message object broadcast with the `accepted` event
 * before the durable write lands.
 *
 * This object must carry the FULL media metadata — the same fields the
 * persisted message carries — because recipients render this provisional
 * bubble immediately. Dropping `isVoiceNote`/`audioDuration` here is what made
 * voice notes flash as file cards until the persisted event arrived, and it
 * stripped audio durations / file metadata from the sender's own bubble.
 */
export function buildProvisionalChatMessage(input: {
  clientMessageId: string;
  roomId: string;
  userId: string;
  payload: SweetSocketChatPayload;
  sender?: Record<string, unknown> | null;
  createdAt?: string;
}): Record<string, unknown> {
  const { clientMessageId, roomId, userId, payload } = input;
  return {
    id: clientMessageId,
    chatRoomId: roomId,
    body: payload.body ?? null,
    mediaUrl: payload.mediaUrl ?? null,
    mediaType: payload.mediaType ?? null,
    caption: payload.caption ?? null,
    fileName: payload.fileName ?? null,
    fileSize: payload.fileSize ?? null,
    mimeType: payload.mimeType ?? null,
    audioDuration: payload.audioDuration ?? null,
    fileType: payload.fileType ?? null,
    isVoiceNote: payload.isVoiceNote ?? null,
    replyToId: payload.replyToId ?? null,
    linkPreview: payload.linkPreview ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    // The accepted event is rendered before the durable join can complete.
    // Include the same participant shape as the persisted event so the sender
    // never flashes from a placeholder avatar/name to the real profile.
    sender: input.sender ?? { id: userId, name: "User", username: "", avatarUrl: null },
    isDeleted: false,
    clientMessageId,
    pending: true,
  };
}

export async function persistSweetSocketChatMessage(input: {
  roomId: string;
  userId: string;
  clientMessageId: string;
  payload: SweetSocketChatPayload;
}): Promise<{ message: any; created: boolean }> {
  await ensureSweetSocketChatSchema();
  const { roomId, userId, clientMessageId, payload } = input;
  const member = await getMember(roomId, userId);
  if (!member) throw new Error("Chat room not found");

  const body = payload.body?.trim() || null;
  if (!body && !payload.mediaUrl) throw new Error("Message must have a body or media");

  const [other] = await db
    .select({ user_id: chat_room_members.user_id, is_muted: chat_room_members.is_muted })
    .from(chat_room_members)
    .where(and(eq(chat_room_members.chat_room_id, roomId), sql`${chat_room_members.user_id} != ${userId}`))
    .limit(1);
  if (other) {
    if (await isBlockedBetween(userId, other.user_id)) throw new Error("You cannot message this user");
    const restricted = await messagingAllowedError(userId, other.user_id);
    if (restricted) throw new Error(restricted);
  }

  const [existing] = await db
    .select({ id: chat_room_messages.id })
    .from(chat_room_messages)
    .where(and(eq(chat_room_messages.sender_id, userId), eq(chat_room_messages.client_message_id, clientMessageId)))
    .limit(1);
  const messageId = existing?.id ?? (clientMessageId || generateId());

  if (!existing) {
    const now = new Date().toISOString();
    await db.insert(chat_room_messages).values({
      id: messageId,
      chat_room_id: roomId,
      sender_id: userId,
      client_message_id: clientMessageId,
      reply_to_id: payload.replyToId ?? null,
      body,
      media_url: payload.mediaUrl ?? null,
      media_type: payload.mediaType ?? null,
      caption: payload.caption ?? null,
      file_name: payload.fileName ?? null,
      file_size: payload.fileSize ?? null,
      mime_type: payload.mimeType ?? null,
      audio_duration: payload.audioDuration ?? null,
      file_type: payload.fileType ?? null,
      is_voice_note: payload.isVoiceNote ?? false,
      link_preview: payload.linkPreview ? JSON.stringify(payload.linkPreview) : null,
      created_at: now,
    });
    await db.update(chat_rooms).set({ last_message_at: now, updated_at: now }).where(eq(chat_rooms.id, roomId));

    if (other && !other.is_muted) {
      // DMs may produce an OS push, but never a permanent in-app feed row.
      // The notification feed is reserved for meaningful social activity.
      // A room the recipient muted never wakes their device — the message
      // still lands in the room and the socket delivers it when they open it.
      void import("@/lib/services/push").then(({ getActorUsername, sendPushToUser }) => {
        void getActorUsername(userId).then((actor) => sendPushToUser(other.user_id, {
          title: "New Message",
          body: body ? `${actor}: ${body.slice(0, 80)}` : `${actor} sent you a message`,
          data: { type: "message", chat_room_id: roomId, actor_id: userId },
        }, "notif_messages"));
      });
    }
  }

  const [row] = await db
    .select({
      id: chat_room_messages.id,
      chat_room_id: chat_room_messages.chat_room_id,
      sender_id: chat_room_messages.sender_id,
      reply_to_id: chat_room_messages.reply_to_id,
      body: chat_room_messages.body,
      media_url: chat_room_messages.media_url,
      media_type: chat_room_messages.media_type,
      caption: chat_room_messages.caption,
      file_name: chat_room_messages.file_name,
      file_size: chat_room_messages.file_size,
      mime_type: chat_room_messages.mime_type,
      audio_duration: chat_room_messages.audio_duration,
      file_type: chat_room_messages.file_type,
      is_voice_note: chat_room_messages.is_voice_note,
      link_preview: chat_room_messages.link_preview,
      reactions: chat_room_messages.reactions,
      deleted_for: chat_room_messages.deleted_for,
      is_edited: chat_room_messages.is_edited,
      is_recalled: chat_room_messages.is_recalled,
      created_at: chat_room_messages.created_at,
      sender_name: users.full_name,
      sender_display_name: profiles.display_name,
      sender_username: users.username,
      sender_avatar: profiles.avatar_url,
      sender_is_verified: users.is_verified,
      sender_is_creator: users.is_creator,
    })
    .from(chat_room_messages)
    .innerJoin(users, eq(users.id, chat_room_messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, chat_room_messages.sender_id))
    .where(eq(chat_room_messages.id, messageId))
    .limit(1);
  if (!row) throw new Error("Message could not be loaded after persistence");

  let replyLookup: Map<string, any> | undefined;
  if (row.reply_to_id) {
    const [quoted] = await db
      .select({
        id: chat_room_messages.id,
        body: chat_room_messages.body,
        media_type: chat_room_messages.media_type,
        media_url: chat_room_messages.media_url,
        sender_name: users.full_name,
        sender_display_name: profiles.display_name,
        sender_username: users.username,
        is_recalled: chat_room_messages.is_recalled,
      })
      .from(chat_room_messages)
      .innerJoin(users, eq(users.id, chat_room_messages.sender_id))
      .leftJoin(profiles, eq(profiles.user_id, chat_room_messages.sender_id))
      .where(eq(chat_room_messages.id, row.reply_to_id))
      .limit(1);
    if (quoted) replyLookup = new Map([[quoted.id, quoted]]);
  }

  const message = await buildMessage(row, userId, replyLookup);

  // Chat-list fanout: every participant's private channel receives a
  // `chats:upsert` carrying the authoritative room metadata (preview, unread
  // count, other participant). This is what makes a NEW conversation appear in
  // the recipient's chat list instantly WITHOUT a refetch — the recipient is
  // not subscribed to the room's chat channel yet, so the room event must ride
  // their private `user:` channel. Emitted only for genuinely new messages;
  // the message events themselves are broadcast by the callers (socket router
  // or HTTP route) on the chat channel.
  if (!existing) {
    try {
      const members = await db
        .select({ user_id: chat_room_members.user_id })
        .from(chat_room_members)
        .where(eq(chat_room_members.chat_room_id, roomId));
      await Promise.all(members.map(async (member) => {
        const room = await buildRoom(roomId, member.user_id);
        if (!room) return;
        await emitEvent({
          type: SWEETSOCKET_EVENT.chatsUpsert,
          channel: `user:${member.user_id}`,
          resourceId: roomId,
          userId: member.user_id,
          payload: { room, roomId },
        });
      }));
    } catch {
      // Chat-list fanout is best-effort — never break message persistence.
    }
  }

  return { message, created: !existing };
}
