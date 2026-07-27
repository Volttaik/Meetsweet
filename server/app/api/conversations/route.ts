import { NextRequest } from "next/server";
import { eq, and, desc, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, conversations, conversation_members, messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const tab = req.nextUrl.searchParams.get("tab") ?? "all";
  const archived = tab === "archived";

  const memberships = await db
    .select({
      conversation_id: conversation_members.conversation_id,
      is_archived: conversation_members.is_archived,
      is_muted: conversation_members.is_muted,
      last_read_at: conversation_members.last_read_at,
    })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.user_id, auth.user.userId),
        eq(conversation_members.is_archived, archived),
      ),
    );

  if (memberships.length === 0) return ok({ conversations: [] });

  const convIds = memberships.map((m) => m.conversation_id);

  const result = [];
  for (const convId of convIds) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId))
      .limit(1);
    if (!conv) continue;

    const membership = memberships.find((m) => m.conversation_id === convId)!;

    // Get all members of the conversation, then pick the other user
    const allMembers = await db
      .select({
        user_id: conversation_members.user_id,
        full_name: users.full_name,
        username: users.username,
        avatar_url: profiles.avatar_url,
        is_verified: users.is_verified,
      })
      .from(conversation_members)
      .innerJoin(users, eq(users.id, conversation_members.user_id))
      .leftJoin(profiles, eq(profiles.user_id, conversation_members.user_id))
      .where(eq(conversation_members.conversation_id, convId));

    const otherMember = allMembers.find((m) => m.user_id !== auth.user.userId);

    // Fetch last message body
    const [lastMsg] = await db
      .select({ body: messages.body, created_at: messages.created_at })
      .from(messages)
      .where(eq(messages.conversation_id, convId))
      .orderBy(desc(messages.created_at))
      .limit(1);

    // Count unread messages (messages after last_read_at from other users)
    // When last_read_at is null, count all messages from others
    let unread_count = 0;
    const [unreadRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(
          eq(messages.conversation_id, convId),
          sql`${messages.sender_id} != ${auth.user.userId}`,
          ...(membership.last_read_at
            ? [sql`${messages.created_at} > ${membership.last_read_at}`]
            : []),
        ),
      );
    unread_count = unreadRow?.count ?? 0;

    result.push({
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
      // camelCase for mobile normalizer
      otherUser: otherMember
        ? {
            id: otherMember.user_id,
            name: otherMember.full_name,
            username: otherMember.username,
            avatar_url: otherMember.avatar_url,
            avatarUrl: otherMember.avatar_url,
            is_verified: otherMember.is_verified,
            isVerified: otherMember.is_verified,
          }
        : null,
    });
  }

  result.sort((a, b) => {
    const aTime = a.last_message_at ?? a.created_at;
    const bTime = b.last_message_at ?? b.created_at;
    return bTime.localeCompare(aTime);
  });

  return ok({ conversations: result });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Accept both camelCase (userId) and snake_case (user_id)
  const schema = z.object({
    userId: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
  });

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const targetId = parsed.data.userId ?? parsed.data.user_id;
  if (!targetId) return err("userId or user_id is required", 400);

  const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!targetUser) return err("User not found", 404);
  if (targetId === auth.user.userId) return err("Cannot start a conversation with yourself", 400);

  // Check if direct conversation already exists between the two users
  const myConvs = await db
    .select({ conversation_id: conversation_members.conversation_id })
    .from(conversation_members)
    .where(eq(conversation_members.user_id, auth.user.userId));

  const myConvIds = myConvs.map((m) => m.conversation_id);

  for (const convId of myConvIds) {
    const [match] = await db
      .select({ id: conversation_members.id })
      .from(conversation_members)
      .where(and(eq(conversation_members.conversation_id, convId), eq(conversation_members.user_id, targetId)))
      .limit(1);
    if (match) {
      return ok({ conversationId: convId, conversation_id: convId, created: false });
    }
  }

  const convId = generateId();
  await db.insert(conversations).values({ id: convId, type: "direct", created_by: auth.user.userId });
  await db.insert(conversation_members).values([
    { id: generateId(), conversation_id: convId, user_id: auth.user.userId },
    { id: generateId(), conversation_id: convId, user_id: targetId },
  ]);

  return created({ conversationId: convId, conversation_id: convId, created: true });
}
