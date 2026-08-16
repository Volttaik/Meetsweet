import { NextRequest } from "next/server";
import { eq, and, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, blocked_users, chat_room_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

/**
 * POST /api/users/:username/block   — block a user
 * DELETE /api/users/:username/block — unblock a user
 *
 * Blocking also archives any existing direct chat room between the two users
 * for the blocker, so the chat disappears from their inbox immediately.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { username } = await params;

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!target) return err("User not found", 404);
  if (target.id === auth.user.userId) return err("You cannot block yourself", 400);

  // Insert block record (idempotent)
  const [existing] = await db
    .select({ id: blocked_users.id })
    .from(blocked_users)
    .where(and(eq(blocked_users.blocker_id, auth.user.userId), eq(blocked_users.blocked_id, target.id)))
    .limit(1);

  if (!existing) {
    await db.insert(blocked_users).values({
      id: generateId(),
      blocker_id: auth.user.userId,
      blocked_id: target.id,
    });
  }

  // Archive any shared direct chat room for the blocker so it leaves the inbox.
  // Find rooms that both users are members of (a direct room has exactly the two
  // participants).
  const myRooms = await db
    .select({ chat_room_id: chat_room_members.chat_room_id })
    .from(chat_room_members)
    .where(eq(chat_room_members.user_id, auth.user.userId));

  for (const room of myRooms) {
    const [theirMembership] = await db
      .select({ id: chat_room_members.id })
      .from(chat_room_members)
      .where(
        and(
          eq(chat_room_members.chat_room_id, room.chat_room_id),
          eq(chat_room_members.user_id, target.id),
        ),
      )
      .limit(1);

    if (theirMembership) {
      // Archive the room for the blocker only
      await db
        .update(chat_room_members)
        .set({ is_archived: true })
        .where(
          and(
            eq(chat_room_members.chat_room_id, room.chat_room_id),
            eq(chat_room_members.user_id, auth.user.userId),
          ),
        );
      break; // Direct rooms are unique pairs; stop after first match
    }
  }

  return ok({ blocked: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { username } = await params;

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!target) return err("User not found", 404);

  await db
    .delete(blocked_users)
    .where(and(eq(blocked_users.blocker_id, auth.user.userId), eq(blocked_users.blocked_id, target.id)));

  return ok({ blocked: false });
}
