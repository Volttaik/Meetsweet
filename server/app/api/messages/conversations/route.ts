import { NextRequest } from "next/server";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, conversation_members, users, profiles, messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, created } from "@/lib/api/response";
import { createConversationSchema } from "@/schemas/message";
import { generateId } from "@/lib/auth/codes";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Get all conversation IDs where the user is a member
  const memberships = await db
    .select({
      conversation_id: conversation_members.conversation_id,
      is_muted: conversation_members.is_muted,
      is_pinned: conversation_members.is_pinned,
      is_archived: conversation_members.is_archived,
      last_read_at: conversation_members.last_read_at,
    })
    .from(conversation_members)
    .where(eq(conversation_members.user_id, auth.user.userId));

  if (!memberships.length) return ok([]);

  const convIds = memberships.map((m) => m.conversation_id);

  const convs = await db
    .select()
    .from(conversations)
    .where(inArray(conversations.id, convIds))
    .orderBy(desc(conversations.last_message_at));

  return ok(convs.map((c) => ({
    ...c,
    ...memberships.find((m) => m.conversation_id === c.id),
  })));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, createConversationSchema);
  if (!parsed.success) return parsed.response;
  const { participant_ids, type, name } = parsed.data;

  const allMembers = Array.from(new Set([auth.user.userId, ...participant_ids]));

  const convId = generateId();
  const now = new Date().toISOString();

  await db.insert(conversations).values({
    id: convId,
    type,
    name: name ?? null,
    created_by: auth.user.userId,
    last_message_at: now,
  });

  await db.insert(conversation_members).values(
    allMembers.map((uid) => ({
      id: generateId(),
      conversation_id: convId,
      user_id: uid,
      role: uid === auth.user.userId ? "admin" as const : "member" as const,
    }))
  );

  return created({ id: convId }, "Conversation created");
}
