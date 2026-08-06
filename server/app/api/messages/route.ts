import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  users,
  profiles,
  conversations,
  conversation_members,
  messages,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { sendPushToUsers } from "@/lib/services/push";

/**
 * POST /api/messages
 *
 * Flat alias for POST /api/conversations/:id/messages.
 * Mobile app sends { conversation_id, body, media_url, ... } to this endpoint.
 */

const sendSchema = z
  .object({
    conversation_id: z.string().min(1),
    body: z.string().max(4000).optional(),
    caption: z.string().max(1000).optional(),
    media_url: z.string().url().nullable().optional(),
    mediaUrl: z.string().url().nullable().optional(),
    media_type: z.enum(["image", "video", "audio", "document"]).nullable().optional(),
    mediaType: z.enum(["image", "video", "audio", "document"]).nullable().optional(),
    reply_to_id: z.string().optional(),
    mime_type: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
    fileName: z.string().nullable().optional(),
    file_size: z.number().int().nullable().optional(),
    fileSize: z.number().int().nullable().optional(),
    audio_duration: z.number().nullable().optional(),
    audioDuration: z.number().nullable().optional(),
  })
  .refine((d) => d.body || d.caption || d.media_url || d.mediaUrl, {
    message: "body, caption, or media_url is required",
  });

const MSG_SELECT = {
  id: messages.id,
  body: messages.body,
  caption: messages.caption,
  media_url: messages.media_url,
  media_type: messages.media_type,
  mime_type: messages.mime_type,
  file_name: messages.file_name,
  file_size: messages.file_size,
  audio_duration: messages.audio_duration,
  is_recalled: messages.is_recalled,
  is_edited: messages.is_edited,
  reply_to_id: messages.reply_to_id,
  reactions: messages.reactions,
  created_at: messages.created_at,
  sender_id: users.id,
  sender_name: users.full_name,
  sender_username: users.username,
  sender_avatar: profiles.avatar_url,
};

function formatMessage(m: Record<string, unknown>, myUserId: string) {
  const isOwn = m.sender_id === myUserId;
  const isRecalled = Boolean(m.is_recalled);
  return {
    id: m.id,
    body: isRecalled ? null : m.body,
    caption: isRecalled ? null : m.caption,
    mediaUrl: isRecalled ? null : (m.media_url ?? null),
    media_url: isRecalled ? null : (m.media_url ?? null),
    mediaType: m.media_type ?? null,
    media_type: m.media_type ?? null,
    mimeType: m.mime_type ?? null,
    mime_type: m.mime_type ?? null,
    fileName: m.file_name ?? null,
    file_name: m.file_name ?? null,
    fileSize: m.file_size ?? null,
    file_size: m.file_size ?? null,
    audioDuration: m.audio_duration ?? null,
    audio_duration: m.audio_duration ?? null,
    isDeleted: isRecalled,
    is_deleted: isRecalled,
    is_recalled: isRecalled,
    isEdited: Boolean(m.is_edited),
    is_edited: Boolean(m.is_edited),
    isOwn,
    is_own: isOwn,
    reply_to_id: m.reply_to_id ?? null,
    createdAt: m.created_at,
    created_at: m.created_at,
    reactions: [],
    sender: {
      id: m.sender_id,
      name: m.sender_name,
      username: m.sender_username,
      avatar_url: m.sender_avatar,
      avatarUrl: m.sender_avatar,
    },
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, sendSchema);
  if (!parsed.success) return parsed.response;

  const d = parsed.data;
  const convId = d.conversation_id;

  // Verify conversation exists and user is a member
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, convId))
    .limit(1);
  if (!conv) return err("Conversation not found", 404);

  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, convId),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);
  if (!member) return err("Forbidden", 403);

  const mediaUrl = d.media_url ?? d.mediaUrl ?? null;
  const mediaType = d.media_type ?? d.mediaType ?? null;
  const mimeType = d.mime_type ?? d.mimeType ?? null;
  const fileName = d.file_name ?? d.fileName ?? null;
  const fileSize = d.file_size ?? d.fileSize ?? null;
  const audioDuration = d.audio_duration ?? d.audioDuration ?? null;

  const msgId = generateId();
  const now = new Date().toISOString();
  const msgType = mediaUrl ? (mediaType ?? "media") : "text";

  await db.insert(messages).values({
    id: msgId,
    conversation_id: convId,
    sender_id: auth.user.userId,
    body: d.body ?? null,
    caption: d.caption ?? null,
    media_url: mediaUrl,
    media_type: mediaType,
    reply_to_id: d.reply_to_id ?? null,
    type: msgType,
    mime_type: mimeType,
    file_name: fileName,
    file_size: fileSize,
    audio_duration: audioDuration,
  });

  await db
    .update(conversations)
    .set({ last_message_at: now, updated_at: now })
    .where(eq(conversations.id, convId));

  const [row] = await db
    .select(MSG_SELECT)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(eq(messages.id, msgId))
    .limit(1);

  // Push notification to other members
  const otherMembers = await db
    .select({ user_id: conversation_members.user_id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, convId),
        eq(conversation_members.is_muted, false),
      ),
    );

  const recipientIds = otherMembers
    .map((m) => m.user_id)
    .filter((uid) => uid !== auth.user.userId);

  if (recipientIds.length > 0) {
    const preview = d.body
      ? d.body.length > 60 ? d.body.slice(0, 57) + "…" : d.body
      : d.caption
      ? d.caption.slice(0, 60)
      : "Sent an attachment";

    const senderRow = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, auth.user.userId))
      .limit(1)
      .then((r) => r[0]);

    const actor = senderRow?.username ? `@${senderRow.username}` : "Someone";

    sendPushToUsers(recipientIds, {
      title: "New Message",
      body: `${actor}: ${preview}`,
      data: {
        type: "message",
        conversation_id: convId,
        actor_id: auth.user.userId,
        actor_username: senderRow?.username ?? null,
      },
    });
  }

  return ok({
    message: formatMessage(row as Record<string, unknown>, auth.user.userId),
  });
}
