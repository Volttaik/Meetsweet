/**
 * Typing broadcast endpoint.
 *
 * POST — the mobile app broadcasts "I'm typing" when the user interacts with
 * the input field. The server upserts a short-lived record (30s timeout) so the
 * OTHER participant sees "User is typing…" via the /changes poll response.
 *
 * DELETE — called when the user stops typing, sends a message, or leaves the
 * room. Clears the typing state immediately.
 */

import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { typing_states } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

const TYPING_TIMEOUT_SECS = 30; // auto-expire after 30s

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TYPING_TIMEOUT_SECS * 1000).toISOString();

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