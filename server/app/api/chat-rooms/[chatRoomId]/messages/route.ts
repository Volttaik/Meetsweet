import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { ok, err, created } from "@/lib/api/response";
import { getMember, listRoomMessages } from "@/lib/services/chat-rooms";
import { parseBody } from "@/lib/api/validate";
import { emitEvent } from "@/lib/realtime/emit";
import {
  persistSweetSocketChatMessage,
  ensureSweetSocketChatSchema,
  type SweetSocketChatPayload,
} from "@/lib/services/sweet-socket-chat";
import { SWEETSOCKET_EVENT } from "@/lib/realtime/sweet-socket/event-map";

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
  client_message_id: z.string().min(1).max(160).nullable().optional(),
  body: z.string().max(5000).nullable().optional(),
  media_url: z.string().url().nullable().optional(),
  media_type: z.enum(["image", "video", "audio", "document", "gif", "sticker"]).nullable().optional(),
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
  const parsed = await parseBody(req, sendSchema);
  if (!parsed.success) return parsed.response;
  const clientMessageId = parsed.data.client_message_id;
  if (!clientMessageId) return err("client_message_id is required", 400, "CLIENT_MESSAGE_ID_REQUIRED");

  await ensureSweetSocketChatSchema();
  try {
    const d = parsed.data;
    const result = await persistSweetSocketChatMessage({
      roomId: chatRoomId,
      userId: auth.user.userId,
      clientMessageId,
      payload: {
        body: d.body,
        mediaUrl: d.media_url,
        mediaType: d.media_type,
        caption: d.caption,
        fileName: d.file_name,
        fileSize: d.file_size,
        mimeType: d.mime_type,
        audioDuration: d.audio_duration,
        fileType: d.file_type,
        isVoiceNote: d.is_voice_note,
        replyToId: d.reply_to_id,
      } satisfies SweetSocketChatPayload,
    });

    // HTTP is only the offline fallback. It still emits through SweetSocket's
    // shared event log so connected recipients receive the same event shape.
    // The canonical message event is messages:upsert (chats:upsert fanout for
    // the chat list is emitted by the persistence service itself).
    if (result.created) {
      void emitEvent({
        type: SWEETSOCKET_EVENT.messagesUpsert,
        channel: `chat:${chatRoomId}`,
        resourceId: result.message.id,
        userId: auth.user.userId,
        payload: {
          message: result.message,
          clientMessageId,
        },
      });
    }
    return result.created ? created({ message: result.message }) : ok({ message: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Message could not be sent";
    if (message === "Chat room not found") return err(message, 404);
    if (message.includes("cannot message") || message.includes("required") || message.includes("disabled")) return err(message, 403);
    return err(message, 500, "MESSAGE_SEND_FAILED");
  }
}
