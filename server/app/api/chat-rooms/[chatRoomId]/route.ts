import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat_room_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { buildRoom, getMember } from "@/lib/services/chat-rooms";
import { emitEvent } from "@/lib/realtime/emit";
import { SWEETSOCKET_EVENT } from "@/lib/realtime/sweet-socket/event-map";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return err("Chat room not found", 404);

  const room = await buildRoom(chatRoomId, auth.user.userId);
  return ok({ chat_room: room, chatRoom: room, ...room });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return err("Chat room not found", 404);

  // Remove from the viewer's list only — the room and the other participant's
  // membership stay intact.
  await db
    .update(chat_room_members)
    .set({ left_at: new Date().toISOString(), is_archived: false })
    .where(eq(chat_room_members.id, member.id));

  // Realtime: every device of this user drops the room from its chat list
  // immediately (chats:delete on the private user channel). Durable so a
  // reconnecting client also stops showing it.
  void emitEvent({
    type: SWEETSOCKET_EVENT.chatsDelete,
    channel: `user:${auth.user.userId}`,
    resourceId: chatRoomId,
    userId: auth.user.userId,
    payload: { roomId: chatRoomId, userId: auth.user.userId },
  });

  return ok({ removed: true });
}
