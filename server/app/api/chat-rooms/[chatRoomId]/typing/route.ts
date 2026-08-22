/**
 * Typing broadcast endpoint.
 *
 * POST — the mobile app broadcasts "I'm typing" when the user interacts with
 * the input field. Typing is an EPHEMERAL realtime state: it is broadcast
 * immediately over the WebSocket layer (chat:typing.started) and never
 * written to the database per keystroke. A throttled short-lived row (30s
 * timeout) is no longer persisted; the event is ephemeral and lives only on
 * the authorized SweetSocket channel.
 *
 * DELETE — called when the user stops typing, sends a message, or leaves the
 * room. Clears the typing state immediately over SweetSocket.
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { getMember } from "@/lib/services/chat-rooms";
import { emitEvent } from "@/lib/realtime/emit";
import { SWEETSOCKET_EVENT } from "@/lib/realtime/sweet-socket/types";

const BROADCAST_THROTTLE_MS = 2_000;

// In-memory throttle state (per Function instance). Used only to pace writes
// and broadcasts — never authoritative; resets are harmless.
const lastBroadcast = new Map<string, number>();

const key = (userId: string, roomId: string) => `${userId}:${roomId}`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  if (!(await getMember(chatRoomId, auth.user.userId).catch(() => null))) return err("Chat room not found", 404);
  const now = Date.now();
  const k = key(auth.user.userId, chatRoomId);

  // Realtime first: typing.started is immediate (throttled to avoid storms).
  if ((lastBroadcast.get(k) ?? 0) + BROADCAST_THROTTLE_MS <= now) {
    lastBroadcast.set(k, now);
    void emitEvent({
      type: SWEETSOCKET_EVENT.typingStart,
      channel: `chat:${chatRoomId}`,
      resourceId: chatRoomId,
      userId: auth.user.userId,
      payload: { userId: auth.user.userId },
      durable: false,
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
  if (!(await getMember(chatRoomId, auth.user.userId).catch(() => null))) return err("Chat room not found", 404);

  const k = key(auth.user.userId, chatRoomId);
  lastBroadcast.delete(k);

  // Realtime: typing.stopped immediately.
  void emitEvent({
    type: SWEETSOCKET_EVENT.typingStop,
    channel: `chat:${chatRoomId}`,
    resourceId: chatRoomId,
    userId: auth.user.userId,
    payload: { userId: auth.user.userId },
    durable: false,
  });

  return ok({ success: true });
}
