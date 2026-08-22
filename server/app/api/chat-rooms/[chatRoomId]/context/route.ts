import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat_room_messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { getMember } from "@/lib/services/chat-rooms";

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return err("Chat room not found", 404);

  // Full membership of this user's context, newest first. The mobile client
  // reconciles its local replica against `message_ids` AS A SNAPSHOT: any
  // locally cached message NOT in this list is no longer part of the context
  // and is removed locally (row + media). It MUST therefore contain every
  // message this user can currently see — an empty array would wipe the whole
  // conversation on every sync (the bug this fixes).
  // Removed ids = messages the viewer must drop from their local replica
  // (delete-for-everyone / delete-for-me / cleared).
  const rows = await db
    .select({ id: chat_room_messages.id, is_recalled: chat_room_messages.is_recalled, deleted_for: chat_room_messages.deleted_for, created_at: chat_room_messages.created_at })
    .from(chat_room_messages)
    .where(eq(chat_room_messages.chat_room_id, chatRoomId))
    .orderBy(desc(chat_room_messages.created_at), desc(chat_room_messages.id))
    .limit(2000);

  const removed: string[] = [];
  const visible: string[] = [];
  for (const r of rows) {
    if (r.is_recalled) removed.push(r.id);
    else if (parseJsonArray(r.deleted_for).includes(auth.user.userId)) removed.push(r.id);
    else if (member.cleared_at && r.created_at <= member.cleared_at) removed.push(r.id);
    else visible.push(r.id);
  }

  return ok({
    chat_room_id: chatRoomId,
    chatRoomId,
    context_id: member.context_id,
    contextId: member.context_id,
    user_id: auth.user.userId,
    context_auth: {
      message_ids: visible,
      messageIds: visible,
      removed_message_ids: removed,
      removedMessageIds: removed,
      marker: new Date().toISOString(),
    },
  });
}
