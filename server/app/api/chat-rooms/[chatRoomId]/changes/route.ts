import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { getMember, listRoomMessages } from "@/lib/services/chat-rooms";
import { typing_states } from "@/lib/db/schema";

/** Return userIds currently typing in a room, excluding the requesting user. */
async function getTypingUsers(chatRoomId: string, excludeUserId: string): Promise<string[]> {
  const now = new Date().toISOString();
  const rows = await db
    .select({ user_id: typing_states.user_id })
    .from(typing_states)
    .where(
      and(
        eq(typing_states.chat_room_id, chatRoomId),
        sql`${typing_states.expires_at} > ${now}`,
      ),
    );
  return rows.map((r) => r.user_id).filter((id) => id !== excludeUserId);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return ok({ changed: false, marker: null, messages: [] });

  const since = req.nextUrl.searchParams.get("since");
  const marker = new Date().toISOString();

  if (!since) {
    return ok({ changed: false, marker, messages: [] });
  }

  const messages = await listRoomMessages(chatRoomId, auth.user.userId, { after: since });
  const typingUserIds = await getTypingUsers(chatRoomId, auth.user.userId);
  return ok({ changed: messages.length > 0, marker, messages, typing: typingUserIds });
}
