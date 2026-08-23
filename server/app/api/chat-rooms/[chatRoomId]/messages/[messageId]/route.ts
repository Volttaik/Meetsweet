/**
 * Chat message edit + delete (recall).
 *
 * PATCH  /api/chat-rooms/:chatRoomId/messages/:messageId  { body }
 *   Edit the message body (author only). Marks is_edited and broadcasts
 *   chat.message.updated so the other participant sees the edit instantly.
 *
 * DELETE /api/chat-rooms/:chatRoomId/messages/:messageId?scope=me|everyone
 *   scope=me       → "delete for me": the viewer's id is added to
 *                    deleted_for; the message stays visible to everyone else.
 *   scope=everyone → "recall": is_recalled is set; listRoomMessages already
 *                    hides recalled messages from every viewer.
 *   Broadcasts chat.message.deleted; clients remove the message (and its
 *   cached media) only when the event affects them.
 *
 * The DB remains authoritative — the events are emitted only after the write
 * succeeds.
 */

import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chat_room_messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { getMember } from "@/lib/services/chat-rooms";
import { emitEvent } from "@/lib/realtime/emit";
import { SWEETSOCKET_EVENT } from "@/lib/realtime/sweet-socket/event-map";

function parseDeletedFor(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string; messageId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId, messageId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return err("Chat room not found", 404);

  const [message] = await db
    .select({ id: chat_room_messages.id, sender_id: chat_room_messages.sender_id })
    .from(chat_room_messages)
    .where(and(eq(chat_room_messages.id, messageId), eq(chat_room_messages.chat_room_id, chatRoomId)))
    .limit(1);
  if (!message) return err("Message not found", 404);
  if (message.sender_id !== auth.user.userId) return err("Forbidden", 403);

  const parsed = await parseBody(req, z.object({ body: z.string().max(5000) }));
  if (!parsed.success) return parsed.response;

  await db
    .update(chat_room_messages)
    .set({ body: parsed.data.body, is_edited: true, updated_at: new Date().toISOString() })
    .where(eq(chat_room_messages.id, messageId));

  // Realtime: the other participant's bubble updates instantly. The canonical
  // event is messages:update; the chat list preview also needs the new body
  // (chats:update on the actor's private channel is enough — both participants'
  // previews are refreshed by their own client on the next list render, and the
  // room channel carries the bubble edit to everyone).
  void emitEvent({
    type: SWEETSOCKET_EVENT.messagesUpdate,
    channel: `chat:${chatRoomId}`,
    resourceId: messageId,
    userId: auth.user.userId,
    payload: { messageId, body: parsed.data.body, isEdited: true },
  });

  return ok({ updated: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string; messageId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId, messageId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return err("Chat room not found", 404);

  const scope = req.nextUrl.searchParams.get("scope") === "everyone" ? "everyone" : "me";

  const [message] = await db
    .select({
      id: chat_room_messages.id,
      sender_id: chat_room_messages.sender_id,
      deleted_for: chat_room_messages.deleted_for,
    })
    .from(chat_room_messages)
    .where(and(eq(chat_room_messages.id, messageId), eq(chat_room_messages.chat_room_id, chatRoomId)))
    .limit(1);
  if (!message) return err("Message not found", 404);

  // Recalling for everyone requires the author (or an admin). Delete-for-me
  // is available to any room member.
  if (scope === "everyone" && message.sender_id !== auth.user.userId && auth.user.role !== "admin") {
    return err("Forbidden", 403);
  }

  if (scope === "everyone") {
    await db
      .update(chat_room_messages)
      .set({ is_recalled: true, updated_at: new Date().toISOString() })
      .where(eq(chat_room_messages.id, messageId));
  } else {
    const deletedFor = parseDeletedFor(message.deleted_for);
    if (!deletedFor.includes(auth.user.userId)) {
      deletedFor.push(auth.user.userId);
      await db
        .update(chat_room_messages)
        .set({ deleted_for: JSON.stringify(deletedFor), updated_at: new Date().toISOString() })
        .where(eq(chat_room_messages.id, messageId));
    }
  }

  // Realtime: clients drop the message (and its cached media) only when the
  // event affects them — everyone for recall, the actor for delete-for-me.
  void emitEvent({
    type: SWEETSOCKET_EVENT.messagesDelete,
    channel: `chat:${chatRoomId}`,
    resourceId: messageId,
    userId: auth.user.userId,
    payload: { messageId, scope, userId: auth.user.userId },
  });

  return ok({ deleted: true });
}
