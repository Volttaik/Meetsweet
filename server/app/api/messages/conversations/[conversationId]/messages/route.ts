import { NextRequest } from "next/server";
import { eq, and, lt, desc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, conversation_members, conversations, users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody, parseQuery } from "@/lib/api/validate";
import { ok, created, forbidden, notFound } from "@/lib/api/response";
import { sendMessageSchema, messageQuerySchema } from "@/schemas/message";
import { generateId } from "@/lib/auth/codes";
import { signMessageRow } from "@/lib/api/media";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  const [member] = await db
    .select()
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, conversationId),
        eq(conversation_members.user_id, auth.user.userId)
      )
    )
    .limit(1);
  if (!member) return forbidden();

  const parsed = parseQuery(req.nextUrl.searchParams, messageQuerySchema);
  if (!parsed.success) return parsed.response;
  const cursor = parsed.data.cursor;
  const limit = parsed.data.limit ?? 50;

  const where = cursor
    ? and(
        eq(messages.conversation_id, conversationId),
        isNull(messages.deleted_at),
        lt(messages.created_at, cursor)
      )
    : and(eq(messages.conversation_id, conversationId), isNull(messages.deleted_at));

  const rows = await db
    .select({
      id: messages.id,
      body: messages.body,
      type: messages.type,
      media_url: messages.media_url,
      reactions: messages.reactions,
      is_edited: messages.is_edited,
      is_recalled: messages.is_recalled,
      is_pinned: messages.is_pinned,
      reply_to_id: messages.reply_to_id,
      created_at: messages.created_at,
      updated_at: messages.updated_at,
      sender_id: messages.sender_id,
      sender_username: users.username,
      sender_avatar: profiles.avatar_url,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(where)
    .orderBy(desc(messages.created_at))
    .limit(limit);

  const signed = await Promise.all(rows.map(signMessageRow));
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;

  return ok({ messages: signed, next_cursor: nextCursor });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  const [member] = await db
    .select()
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, conversationId),
        eq(conversation_members.user_id, auth.user.userId)
      )
    )
    .limit(1);
  if (!member) return forbidden();

  const parsed = await parseBody(req, sendMessageSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const msgId = generateId();
  const now = new Date().toISOString();

  await db.insert(messages).values({
    id: msgId,
    conversation_id: conversationId,
    sender_id: auth.user.userId,
    type: body.type,
    body: body.body,
    media_url: body.media_url,
    media_blob_path: body.media_blob_path,
    reply_to_id: body.reply_to_id,
  });

  await db
    .update(conversations)
    .set({ last_message_at: now })
    .where(eq(conversations.id, conversationId));

  return created({ id: msgId }, "Message sent");
}
