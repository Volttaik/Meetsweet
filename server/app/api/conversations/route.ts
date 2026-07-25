import { NextRequest } from "next/server";
import { eq, desc, and, inArray, sql, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations,
  conversation_members,
  users,
  profiles,
  messages,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, created, notFound } from "@/lib/api/response";
import { z } from "zod";
import { generateId } from "@/lib/auth/codes";

const createConvSchema = z.object({
  userId: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const tab = req.nextUrl.searchParams.get("tab") ?? "all";
  const showArchived = tab === "archived";

  const memberships = await db
    .select({
      conversation_id: conversation_members.conversation_id,
      is_muted: conversation_members.is_muted,
      is_archived: conversation_members.is_archived,
      last_read_at: conversation_members.last_read_at,
    })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.user_id, auth.user.userId),
        eq(conversation_members.is_archived, showArchived)
      )
    );

  if (!memberships.length) return ok({ conversations: [] });

  const convIds = memberships.map((m) => m.conversation_id);

  const convRows = await db
    .select({
      id: conversations.id,
      last_message_at: conversations.last_message_at,
      created_at: conversations.created_at,
    })
    .from(conversations)
    .where(inArray(conversations.id, convIds))
    .orderBy(desc(conversations.last_message_at));

  const result = await Promise.all(
    convRows.map(async (conv) => {
      const membership = memberships.find((m) => m.conversation_id === conv.id)!;

      // Find the other participant
      const allMembers = await db
        .select({ user_id: conversation_members.user_id })
        .from(conversation_members)
        .where(eq(conversation_members.conversation_id, conv.id));

      const otherUserId = allMembers.find(
        (m) => m.user_id !== auth.user.userId
      )?.user_id;

      let otherUser = null;
      if (otherUserId) {
        const [u] = await db
          .select({
            id: users.id,
            name: users.full_name,
            username: users.username,
            avatarUrl: profiles.avatar_url,
            isVerified: profiles.is_verified_creator,
          })
          .from(users)
          .leftJoin(profiles, eq(profiles.user_id, users.id))
          .where(eq(users.id, otherUserId))
          .limit(1);
        otherUser = u ?? null;
      }

      // Last message
      const [lastMsg] = await db
        .select({ body: messages.body, created_at: messages.created_at })
        .from(messages)
        .where(eq(messages.conversation_id, conv.id))
        .orderBy(desc(messages.created_at))
        .limit(1);

      // Unread count
      let unreadCount = 0;
      if (membership.last_read_at) {
        const [unreadResult] = await db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(
            and(
              eq(messages.conversation_id, conv.id),
              sql`${messages.created_at} > ${membership.last_read_at}`
            )
          );
        unreadCount = unreadResult?.count ?? 0;
      }

      return {
        id: conv.id,
        lastMessageBody: lastMsg?.body ?? null,
        lastMessageAt: lastMsg?.created_at ?? null,
        createdAt: conv.created_at,
        isMuted: membership.is_muted,
        isArchived: membership.is_archived,
        unreadCount,
        otherUser,
      };
    })
  );

  return ok({ conversations: result });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, createConvSchema);
  if (!parsed.success) return parsed.response;
  const { userId } = parsed.data;

  const [targetUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!targetUser) return notFound("User not found");

  // Check if a direct conversation already exists between these two users
  const myMemberships = await db
    .select({ conversation_id: conversation_members.conversation_id })
    .from(conversation_members)
    .where(eq(conversation_members.user_id, auth.user.userId));

  if (myMemberships.length) {
    const myConvIds = myMemberships.map((m) => m.conversation_id);
    const theirMemberships = await db
      .select({ conversation_id: conversation_members.conversation_id })
      .from(conversation_members)
      .where(
        and(
          eq(conversation_members.user_id, userId),
          inArray(conversation_members.conversation_id, myConvIds)
        )
      );

    if (theirMemberships.length) {
      return ok({ conversationId: theirMemberships[0].conversation_id, created: false });
    }
  }

  const convId = generateId();
  const now = new Date().toISOString();

  await db.insert(conversations).values({
    id: convId,
    type: "direct",
    created_by: auth.user.userId,
    last_message_at: now,
  });

  await db.insert(conversation_members).values([
    {
      id: generateId(),
      conversation_id: convId,
      user_id: auth.user.userId,
      role: "admin" as const,
    },
    {
      id: generateId(),
      conversation_id: convId,
      user_id: userId,
      role: "member" as const,
    },
  ]);

  return created({ conversationId: convId, created: true });
}
