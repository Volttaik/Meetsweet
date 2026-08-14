import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chat_room_messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { getMember } from "@/lib/services/chat-rooms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseReactions(value: string | null): any[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string; messageId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId, messageId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return err("Chat room not found", 404);

  const [message] = await db
    .select({ id: chat_room_messages.id, reactions: chat_room_messages.reactions })
    .from(chat_room_messages)
    .where(and(eq(chat_room_messages.id, messageId), eq(chat_room_messages.chat_room_id, chatRoomId)))
    .limit(1);

  if (!message) return err("Message not found", 404);

  const parsed = await parseBody(req, z.object({ emoji: z.string().min(1).max(16) }));
  if (!parsed.success) return parsed.response;

  const emoji = parsed.data.emoji;
  const reactions = parseReactions(message.reactions);
  const idx = reactions.findIndex((r) => r.emoji === emoji);

  if (idx === -1) {
    reactions.push({ emoji, user_ids: [auth.user.userId] });
  } else {
    const ids = (reactions[idx].user_ids ?? []).map(String);
    const pos = ids.indexOf(auth.user.userId);
    if (pos === -1) {
      ids.push(auth.user.userId);
    } else {
      ids.splice(pos, 1);
    }
    reactions[idx].user_ids = ids;
    if (ids.length === 0) reactions.splice(idx, 1);
  }

  await db
    .update(chat_room_messages)
    .set({ reactions: JSON.stringify(reactions), updated_at: new Date().toISOString() })
    .where(eq(chat_room_messages.id, messageId));

  const shaped = reactions.map((r) => ({
    emoji: r.emoji,
    user_ids: (r.user_ids ?? []).map(String),
    userIds: (r.user_ids ?? []).map(String),
  }));

  return ok({ reactions: shaped });
}
