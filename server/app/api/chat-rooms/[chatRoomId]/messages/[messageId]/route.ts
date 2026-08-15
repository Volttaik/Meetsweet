import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chat_room_messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
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
    .select({
      id: chat_room_messages.id,
      sender_id: chat_room_messages.sender_id,
      media_url: chat_room_messages.media_url,
      media_type: chat_room_messages.media_type,
    })
    .from(chat_room_messages)
    .where(and(eq(chat_room_messages.id, messageId), eq(chat_room_messages.chat_room_id, chatRoomId)))
    .limit(1);

  if (!message) return err("Message not found", 404);
  if (message.sender_id !== auth.user.userId) return err("Forbidden", 403);

  // Only text messages may be edited. Media/audio/voice messages carry no
  // editable body and must never be modified through this route.
  if (message.media_url || message.media_type) {
    return err("Only text messages can be edited", 400);
  }

  const parsed = await parseBody(req, z.object({ body: z.string().min(1).max(5000) }));
  if (!parsed.success) return parsed.response;

  await db
    .update(chat_room_messages)
    .set({ body: parsed.data.body, is_edited: true, updated_at: new Date().toISOString() })
    .where(eq(chat_room_messages.id, messageId));

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

  const scope = req.nextUrl.searchParams.get("scope") ?? "me";

  if (scope === "everyone") {
    if (message.sender_id !== auth.user.userId) return err("Forbidden", 403);
    await db
      .update(chat_room_messages)
      .set({ is_recalled: true, updated_at: new Date().toISOString() })
      .where(eq(chat_room_messages.id, messageId));
  } else {
    // delete-for-me: add the viewer to the message's deleted_for list.
    const deletedFor = parseJsonArray(message.deleted_for);
    if (!deletedFor.includes(auth.user.userId)) {
      deletedFor.push(auth.user.userId);
      await db
        .update(chat_room_messages)
        .set({ deleted_for: JSON.stringify(deletedFor), updated_at: new Date().toISOString() })
        .where(eq(chat_room_messages.id, messageId));
    }
  }

  return ok({ deleted: true });
}
