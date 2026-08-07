import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations,
  conversation_members,
  profiles,
  users,
} from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

export type ConversationTarget = {
  id: string;
  username: string;
  full_name: string;
  is_creator: boolean;
  is_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * Resolve any recipient identifier accepted by the app to the canonical
 * users.id. Profile IDs and creator/profile usernames are intentionally
 * supported because older app entry points did not all pass the same ID.
 */
export async function resolveConversationTarget(
  identifier?: string | null,
  username?: string | null,
): Promise<ConversationTarget | null> {
  const value = (username ?? identifier ?? "").trim().replace(/^@/, "");
  if (!value) return null;

  const identityMatch = username
    ? sql`lower(${users.username}) = ${value.toLowerCase()}`
    : or(
        eq(users.id, value),
        sql`lower(${users.username}) = ${value.toLowerCase()}`,
        eq(profiles.id, value),
      );

  const [target] = await db
    .select({
      id: users.id,
      username: users.username,
      full_name: users.full_name,
      is_creator: users.is_creator,
      is_verified: users.is_verified,
      display_name: profiles.display_name,
      avatar_url: profiles.avatar_url,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(and(identityMatch, eq(users.is_active, true)))
    .limit(1);

  return target ?? null;
}

/**
 * Find the existing direct room for two users, or create one when absent.
 * The returned ID is always a conversations.id, never a user/profile ID.
 */
export async function findOrCreateDirectConversation(
  callerId: string,
  targetId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const memberships = await db
    .select({ conversation_id: conversation_members.conversation_id })
    .from(conversation_members)
    .where(eq(conversation_members.user_id, callerId));

  for (const { conversation_id: conversationId } of memberships) {
    const [match] = await db
      .select({ id: conversation_members.id })
      .from(conversation_members)
      .where(
        and(
          eq(conversation_members.conversation_id, conversationId),
          eq(conversation_members.user_id, targetId),
        ),
      )
      .limit(1);

    if (match) return { conversationId, created: false };
  }

  const conversationId = generateId();
  await db.insert(conversations).values({
    id: conversationId,
    type: "direct",
    created_by: callerId,
  });
  await db.insert(conversation_members).values([
    { id: generateId(), conversation_id: conversationId, user_id: callerId },
    { id: generateId(), conversation_id: conversationId, user_id: targetId },
  ]);

  return { conversationId, created: true };
}