import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat_room_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { getMember } from "@/lib/services/chat-rooms";
import { emitEvent } from "@/lib/realtime/emit";
import { SWEETSOCKET_EVENT } from "@/lib/realtime/sweet-socket/event-map";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return ok({ cleared: true });

  const clearedAt = new Date().toISOString();
  await db
    .update(chat_room_members)
    .set({ cleared_at: clearedAt })
    .where(eq(chat_room_members.id, member.id));

  // Realtime: the actor's own devices drop their local replica immediately.
  // Durable so a reconnecting client converges on the cleared state without a
  // full history reload.
  void emitEvent({
    type: SWEETSOCKET_EVENT.chatClear,
    channel: `user:${auth.user.userId}`,
    resourceId: chatRoomId,
    userId: auth.user.userId,
    payload: { roomId: chatRoomId, userId: auth.user.userId, clearedAt },
  });

  return ok({ cleared: true });
}
