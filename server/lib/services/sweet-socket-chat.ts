import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat_room_members, chat_room_messages, chat_rooms, profiles, user_settings, users } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { buildMessage, getMember, isBlockedBetween, messagingAllowedError } from "@/lib/services/chat-rooms";

export type SweetSocketChatPayload = {
  body?: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "audio" | "document" | "gif" | "sticker" | null;
  caption?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  audioDuration?: number | null;
  fileType?: string | null;
  isVoiceNote?: boolean | null;
  replyToId?: string | null;
};

let schemaReady: Promise<void> | null = null;

/** Runtime-safe migration because this project deploys without checked-in SQL migrations. */
export function ensureSweetSocketChatSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await db.run(sql`ALTER TABLE chat_room_messages ADD COLUMN client_message_id TEXT`).catch(() => {});
    await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS chat_room_messages_sender_client_idx ON chat_room_messages(sender_id, client_message_id) WHERE client_message_id IS NOT NULL`).catch(() => {});
  })();
  return schemaReady;
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
    .select({ user_id: chat_room_members.user_id })
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
      created_at: now,
    });
    await db.update(chat_rooms).set({ last_message_at: now, updated_at: now }).where(eq(chat_rooms.id, roomId));

    if (other) {
      void import("@/lib/services/push").then(({ createNotification, getActorUsername, sendPushToUser }) => {
        void createNotification(other.user_id, "notif_messages", {
          actor_id: userId,
          type: "message",
          entity_type: "chat_room",
          entity_id: roomId,
          body: body?.slice(0, 100) || "Sent you a message",
        });
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
      })
      .from(chat_room_messages)
      .innerJoin(users, eq(users.id, chat_room_messages.sender_id))
      .leftJoin(profiles, eq(profiles.user_id, chat_room_messages.sender_id))
      .where(eq(chat_room_messages.id, row.reply_to_id))
      .limit(1);
    if (quoted) replyLookup = new Map([[quoted.id, quoted]]);
  }

  const message = await buildMessage(row, userId, replyLookup);
  return { message, created: !existing };
}
