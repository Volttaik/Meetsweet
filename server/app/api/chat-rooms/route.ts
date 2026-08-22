import { NextRequest } from "next/server";
import { eq, and, or, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, typing_states, user_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import {
  buildRoom,
  findOrCreateChatRoom,
  listVisibleRoomIds,
  messagingAllowedError,
} from "@/lib/services/chat-rooms";

/** Return a map of chatRoomId → array of user IDs currently typing. */
async function typingMap(roomIds: string[], excludeUserId: string): Promise<Record<string, string[]>> {
  if (!roomIds.length) return {};
  const now = new Date().toISOString();
  const rows = await db
    .select({ chat_room_id: typing_states.chat_room_id, user_id: typing_states.user_id })
    .from(typing_states)
    .leftJoin(user_settings, eq(user_settings.user_id, typing_states.user_id))
    .where(
      and(
        sql`${typing_states.expires_at} > ${now}`,
        // Privacy: a user who turned off the Typing Indicator never appears
        // as typing to others — enforced server-side, not just hidden on the
        // client. Missing settings rows default to visible.
        or(isNull(user_settings.typing_indicator), eq(user_settings.typing_indicator, true)),
      ),
    );
  const result: Record<string, string[]> = {};
  for (const r of rows) {
    if (r.user_id === excludeUserId) continue;
    if (!result[r.chat_room_id]) result[r.chat_room_id] = [];
    result[r.chat_room_id].push(r.user_id);
  }
  return result;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, z.object({ participant_id: z.string().min(1) }));
  if (!parsed.success) return parsed.response;

  const participantId = parsed.data.participant_id;
  if (participantId === auth.user.userId) {
    return err("Cannot open a chat room with yourself", 400);
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, participantId))
    .limit(1);
  if (!target) return err("User not found", 404);

  const restricted = await messagingAllowedError(auth.user.userId, participantId);
  if (restricted) {
    return err(restricted, 403, "MESSAGING_RESTRICTED");
  }

  const { chatRoomId, created: roomCreated } = await findOrCreateChatRoom(auth.user.userId, participantId);
  const room = await buildRoom(chatRoomId, auth.user.userId);

  return created({ created: roomCreated, ...room });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const tab = (req.nextUrl.searchParams.get("tab") ?? "all") === "archived" ? "archived" : "all";
  const ids = await listVisibleRoomIds(auth.user.userId, tab);

  const rooms = [];
  for (const id of ids) {
    const room = await buildRoom(id, auth.user.userId);
    if (room) rooms.push(room);
  }

  // Sort by last activity, most recent first.
  rooms.sort((a, b) => String(b.last_message_at ?? b.created_at).localeCompare(String(a.last_message_at ?? a.created_at)));

  // Attach typing state
  const typingUsers = await typingMap(ids, auth.user.userId);
  for (const room of rooms) {
    room.typing_user_ids = typingUsers[room.chat_room_id] ?? [];
    room.typingUserIds = typingUsers[room.chat_room_id] ?? [];
  }

  return ok({ chat_rooms: rooms, chatRooms: rooms });
}
