import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chat_room_members, chat_room_messages, chat_rooms, profiles, user_settings, users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import {
  buildMessage,
  getMember,
  isBlockedBetween,
  listRoomMessages,
  messagingAllowedError,
} from "@/lib/services/chat-rooms";
import { sendPushToUser, getActorUsername, createNotification } from "@/lib/services/push";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return err("Chat room not found", 404);

  const before = req.nextUrl.searchParams.get("before") ?? undefined;
  const after = req.nextUrl.searchParams.get("after") ?? undefined;
  const messages = await listRoomMessages(chatRoomId, auth.user.userId, { before, after });

  return ok({ messages, has_more: false, hasMore: false });
}

const sendSchema = z.object({
  body: z.string().max(5000).nullable().optional(),
  media_url: z.string().url().nullable().optional(),
  media_type: z.enum(["image", "video", "audio", "document"]).nullable().optional(),
  caption: z.string().max(2000).nullable().optional(),
  file_name: z.string().max(255).nullable().optional(),
  file_size: z.number().int().nullable().optional(),
  mime_type: z.string().max(255).nullable().optional(),
  audio_duration: z.number().nullable().optional(),
  file_type: z.string().max(20).nullable().optional(),
  is_voice_note: z.boolean().nullable().optional(),
  reply_to_id: z.string().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return err("Chat room not found", 404);

  // Resolve the other participant for messaging-rule + block checks.
  const [other] = await db
    .select({ user_id: chat_room_members.user_id })
    .from(chat_room_members)
    .where(and(eq(chat_room_members.chat_room_id, chatRoomId), sql`${chat_room_members.user_id} != ${auth.user.userId}`))
    .limit(1);

  if (other) {
    const blocked = await isBlockedBetween(auth.user.userId, other.user_id);
    if (blocked) return err("You cannot message this user", 403, "BLOCKED");

    const restricted = await messagingAllowedError(auth.user.userId, other.user_id);
    if (restricted) return err(restricted, 403, "MESSAGING_RESTRICTED");
  }

  const parsed = await parseBody(req, sendSchema);
  if (!parsed.success) return parsed.response;

  const d = parsed.data;
  const hasContent = (d.body && d.body.trim().length > 0) || d.media_url;
  if (!hasContent) return err("Message must have a body or media", 400);

  const now = new Date().toISOString();
  const messageId = generateId();
  await db.insert(chat_room_messages).values({
    id: messageId,
    chat_room_id: chatRoomId,
    sender_id: auth.user.userId,
    reply_to_id: d.reply_to_id ?? null,
    body: d.body ?? null,
    media_url: d.media_url ?? null,
    media_type: d.media_type ?? null,
    caption: d.caption ?? null,
    file_name: d.file_name ?? null,
    file_size: d.file_size ?? null,
    mime_type: d.mime_type ?? null,
    audio_duration: d.audio_duration ?? null,
    file_type: d.file_type ?? null,
    is_voice_note: d.is_voice_note ?? false,
  });

  await db
    .update(chat_rooms)
    .set({ last_message_at: now, updated_at: now })
    .where(eq(chat_rooms.id, chatRoomId));

  // Notify the other participant. The in-app notification row is gated by
  // their Messages preference — when OFF, no event is written and no push is
  // sent (the push below is already gated).
  if (other) {
    await createNotification(other.user_id, "notif_messages", {
      actor_id: auth.user.userId,
      type: "message",
      entity_type: "chat_room",
      entity_id: chatRoomId,
      body: (d.body ?? "").slice(0, 100) || "Sent you a message",
    });

    getActorUsername(auth.user.userId).then((actor) =>
      sendPushToUser(other.user_id, {
        title: "New Message",
        body: d.body ? `${actor}: ${d.body.slice(0, 80)}` : `${actor} sent you a message`,
        data: {
          type: "message",
          chat_room_id: chatRoomId,
          actor_id: auth.user.userId,
          actor_username: actor.replace(/^@/, ""),
        },
      }, "notif_messages"),
    );
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

  // Read marker for the just-inserted message: the OTHER participant's
  // last_read_at (so the sender sees an honest read state for their message).
  // Only reported when that participant has Read Receipts enabled — their
  // privacy setting is enforced here, so a disabled read receipt can never
  // leak through the send confirmation.
  let readThrough: string | null = null;
  let readReceiptsEnabled = true;
  if (other) {
    const [otherMember] = await db
      .select({
        last_read_at: chat_room_members.last_read_at,
        read_receipts: user_settings.read_receipts,
      })
      .from(chat_room_members)
      .leftJoin(user_settings, eq(user_settings.user_id, chat_room_members.user_id))
      .where(
        and(eq(chat_room_members.chat_room_id, chatRoomId), eq(chat_room_members.user_id, other.user_id)),
      )
      .limit(1);
    readThrough = otherMember?.last_read_at ?? null;
    readReceiptsEnabled = otherMember?.read_receipts !== false;
  }

  // Resolve the quoted message for reply_to_id so the send response carries
  // the same reply preview the GET/changes endpoints return. Without this the
  // reply relationship would be missing from the send confirmation and the
  // sending client's optimistic reply preview would be dropped until a full
  // refetch.
  let replyLookup: Map<string, any> | undefined;
  if (d.reply_to_id) {
    const [replyRow] = await db
      .select({
        id: chat_room_messages.id,
        body: chat_room_messages.body,
        media_type: chat_room_messages.media_type,
        media_url: chat_room_messages.media_url,
        sender_name: users.full_name,
        sender_display_name: profiles.display_name,
        sender_username: users.username,
        sender_avatar: profiles.avatar_url,
      })
      .from(chat_room_messages)
      .innerJoin(users, eq(users.id, chat_room_messages.sender_id))
      .leftJoin(profiles, eq(profiles.user_id, chat_room_messages.sender_id))
      .where(eq(chat_room_messages.id, d.reply_to_id))
      .limit(1);
    if (replyRow) replyLookup = new Map([[replyRow.id, replyRow]]);
  }

  const message = await buildMessage(row, auth.user.userId, replyLookup, readThrough, readReceiptsEnabled);
  return created({ message });
}
