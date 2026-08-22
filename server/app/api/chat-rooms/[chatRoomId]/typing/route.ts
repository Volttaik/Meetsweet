/**
 * Typing broadcast endpoint.
 *
 * POST — the mobile app broadcasts "I'm typing" when the user interacts with
 * the input field. Typing is an EPHEMERAL realtime state: it is broadcast
 * immediately over the WebSocket layer (chat:typing.started) and never
 * written to the database per keystroke. A throttled short-lived row (30s
 * timeout) is kept ONLY as a fallback so the /changes polling path still sees
 * typing when the WebSocket is unavailable — the DB write is throttled to at
 * most once every 5s per (user, room).
 *
 * DELETE — called when the user stops typing, sends a message, or leaves the
 * room. Clears the typing state immediately (realtime + fallback row).
 */

import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { typing_states } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { emitEvent } from "@/lib/realtime/emit";
import { EVENT } from "@/lib/realtime/types";

const TYPING_TIMEOUT_SECS = 30; // auto-expire after 30s (fallback row only)
const DB_WRITE_THROTTLE_MS = 5_000;
const BROADCAST_THROTTLE_MS = 2_000;

// In-memory throttle state (per Function instance). Used only to pace writes
// and broadcasts — never authoritative; resets are harmless.
const lastDbWrite = new Map<string, number>();
const lastBroadcast = new Map<string, number>();

const key = (userId: string, roomId: string) => `${userId}:${roomId}`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const now = Date.now();
  const k = key(auth.user.userId, chatRoomId);

  // Realtime first: typing.started is immediate (throttled to avoid storms).
  if ((lastBroadcast.get(k) ?? 0) + BROADCAST_THROTTLE_MS <= now) {
    lastBroadcast.set(k, now);
    void emitEvent({
      type: EVENT.chatTypingStarted,
      channel: `chat:${chatRoomId}`,
      resourceId: chatRoomId,
      userId: auth.user.userId,
      payload: { userId: auth.user.userId },
      durable: false,
    });
  }

  // Fallback DB row (for the polling path) — throttled so typing is not
  // continuously written into Turso. 30s expiry keeps it fresh either way.
  if ((lastDbWrite.get(k) ?? 0) + DB_WRITE_THROTTLE_MS > now) {
    return ok({ success: true });
  }
  lastDbWrite.set(k, now);

  const expiresAt = new Date(now + TYPING_TIMEOUT_SECS * 1000).toISOString();

  // Upsert: if this user already has a typing record for this room, refresh the
  // expiry. Otherwise insert a new one.
  const [existing] = await db
    .select({ id: typing_states.id })
    .from(typing_states)
    .where(
      and(
        eq(typing_states.chat_room_id, chatRoomId),
        eq(typing_states.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(typing_states)
      .set({ expires_at: expiresAt })
      .where(eq(typing_states.id, existing.id));
  } else {
    await db.insert(typing_states).values({
      id: generateId(),
      chat_room_id: chatRoomId,
      user_id: auth.user.userId,
      expires_at: expiresAt,
    });
  }

  return ok({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;

  const k = key(auth.user.userId, chatRoomId);
  lastBroadcast.delete(k);
  lastDbWrite.delete(k);

  // Realtime: typing.stopped immediately.
  void emitEvent({
    type: EVENT.chatTypingStopped,
    channel: `chat:${chatRoomId}`,
    resourceId: chatRoomId,
    userId: auth.user.userId,
    payload: { userId: auth.user.userId },
    durable: false,
  });

  await db
    .delete(typing_states)
    .where(
      and(
        eq(typing_states.chat_room_id, chatRoomId),
        eq(typing_states.user_id, auth.user.userId),
      ),
    );

  return ok({ success: true });
}
