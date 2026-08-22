import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat_room_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { getMember } from "@/lib/services/chat-rooms";
import { emitEvent } from "@/lib/realtime/emit";
import { EVENT } from "@/lib/realtime/types";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return ok({ read: true });

  const lastReadAt = new Date().toISOString();
  await db
    .update(chat_room_members)
    .set({ last_read_at: lastReadAt })
    .where(eq(chat_room_members.id, member.id));

  // Realtime read receipt — the other participant's messages flip to "read"
  // instantly. Ephemeral: on reconnect the read state is re-derived from the
  // member's last_read_at via the normal message fetch.
  void emitEvent({
    type: EVENT.chatMessageRead,
    channel: `chat:${chatRoomId}`,
    resourceId: chatRoomId,
    userId: auth.user.userId,
    payload: { userId: auth.user.userId, lastReadAt },
    durable: false,
  });

  return ok({ read: true });
}
