import { NextRequest } from "next/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  profiles,
  conversations,
  conversation_members,
  messages,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

/**
 * GET /api/conversations/:id
 *
 * Returns detail for a single conversation including the other user,
 * last message, and unread count.
 *
 * DELETE /api/conversations/:id
 *
 * Removes the caller from the conversation (leave / delete for self).
 * If the other party already left, the conversation record is also deleted.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [membership] = await db
    .select({
      id: conversation_members.id,
      is_archived: conversation_members.is_archived,
      is_muted: conversation_members.is_muted,
      last_read_at: conversation_members.last_read_at,
    })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!membership) return err("Conversation not found", 404);

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  if (!conv) return err("Conversation not found", 404);

  // Get all members, find the other user
  const allMembers = await db
    .select({
      user_id: conversation_members.user_id,
      full_name: users.full_name,
      display_name: profiles.display_name,
      username: users.username,
      avatar_url: profiles.avatar_url,
      is_verified: users.is_verified,
    })
    .from(conversation_members)
    .innerJoin(users, eq(users.id, conversation_members.user_id))
    .leftJoin(profiles, eq(profiles.user_id, conversation_members.user_id))
    .where(eq(conversation_members.conversation_id, id));

  const otherMember = allMembers.find((m) => m.user_id !== auth.user.userId);

  // Last message
  const [lastMsg] = await db
    .select({ body: messages.body, created_at: messages.created_at })
    .from(messages)
    .where(eq(messages.conversation_id, id))
    .orderBy(desc(messages.created_at))
    .limit(1);

  // Unread count
  const [unreadRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, id),
        sql`${messages.sender_id} != ${auth.user.userId}`,
        ...(membership.last_read_at
          ? [sql`${messages.created_at} > ${membership.last_read_at}`]
          : []),
      ),
    );

  const unread_count = unreadRow?.count ?? 0;

  return ok({
    id: conv.id,
    lastMessageBody: lastMsg?.body ?? null,
    last_message_body: lastMsg?.body ?? null,
    lastMessageAt: conv.last_message_at,
    last_message_at: conv.last_message_at,
    createdAt: conv.created_at,
    created_at: conv.created_at,
    isMuted: membership.is_muted,
    is_muted: membership.is_muted,
    isArchived: membership.is_archived,
    is_archived: membership.is_archived,
    unreadCount: unread_count,
    unread_count,
    otherUser: otherMember
      ? {
          id: otherMember.user_id,
          name: otherMember.display_name ?? otherMember.full_name,
          display_name: otherMember.display_name ?? otherMember.full_name,
          displayName: otherMember.display_name ?? otherMember.full_name,
          username: otherMember.username,
          avatar_url: otherMember.avatar_url,
          avatarUrl: otherMember.avatar_url,
          is_verified: otherMember.is_verified,
          isVerified: otherMember.is_verified,
        }
      : null,
    other_user: otherMember
      ? {
          id: otherMember.user_id,
          name: otherMember.display_name ?? otherMember.full_name,
          display_name: otherMember.display_name ?? otherMember.full_name,
          displayName: otherMember.display_name ?? otherMember.full_name,
          username: otherMember.username,
          avatar_url: otherMember.avatar_url,
          avatarUrl: otherMember.avatar_url,
          is_verified: otherMember.is_verified,
          isVerified: otherMember.is_verified,
        }
      : null,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [membership] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!membership) return err("Conversation not found", 404);

  // Remove caller's membership
  await db
    .delete(conversation_members)
    .where(eq(conversation_members.id, membership.id));

  // If no members remain, clean up the conversation
  const [remaining] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversation_members)
    .where(eq(conversation_members.conversation_id, id));

  if ((remaining?.count ?? 0) === 0) {
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  return ok({ deleted: true });
}
