import { NextRequest } from "next/server";
import { eq, and, lt, desc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  messages,
  conversation_members,
  conversations,
  users,
  profiles,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, created, forbidden, notFound, err } from "@/lib/api/response";
import { z } from "zod";
import { generateId } from "@/lib/auth/codes";

const sendSchema = z.object({
  body: z.string().max(4000).optional(),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(["image", "video"]).optional().nullable(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id: conversationId } = await params;

  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, conversationId),
        eq(conversation_members.user_id, auth.user.userId)
      )
    )
    .limit(1);

  if (!member) return forbidden("Not a participant in this conversation");

  const before = req.nextUrl.searchParams.get("before");
  const limit = 30;

  const whereClause = before
    ? and(
        eq(messages.conversation_id, conversationId),
        isNull(messages.deleted_at),
        lt(messages.created_at, before)
      )
    : and(eq(messages.conversation_id, conversationId), isNull(messages.deleted_at));

  const rows = await db
    .select({
      id: messages.id,
      body: messages.body,
      mediaUrl: messages.media_url,
      mediaType: messages.type,
      isDeleted: messages.deleted_at,
      createdAt: messages.created_at,
      senderId: messages.sender_id,
      senderName: users.full_name,
      senderUsername: users.username,
      senderAvatar: profiles.avatar_url,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(whereClause)
    .orderBy(desc(messages.created_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    body: r.body ?? null,
    mediaUrl: r.mediaUrl ?? null,
    mediaType: (r.mediaType === "image" || r.mediaType === "video") ? r.mediaType : null,
    isDeleted: r.isDeleted !== null,
    createdAt: r.createdAt,
    sender: {
      id: r.senderId,
      name: r.senderName,
      username: r.senderUsername,
      avatarUrl: r.senderAvatar ?? null,
    },
    isOwn: r.senderId === auth.user.userId,
  }));

  return ok({ messages: items, hasMore });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id: conversationId } = await params;

  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, conversationId),
        eq(conversation_members.user_id, auth.user.userId)
      )
    )
    .limit(1);

  if (!member) return forbidden("Not a participant in this conversation");

  const parsed = await parseBody(req, sendSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  if (!body.body && !body.mediaUrl) {
    return err("At least one of body or mediaUrl is required", 400);
  }

  const msgId = generateId();
  const now = new Date().toISOString();
  const msgType = body.mediaUrl
    ? (body.mediaType === "video" ? "video" : "image")
    : "text";

  await db.insert(messages).values({
    id: msgId,
    conversation_id: conversationId,
    sender_id: auth.user.userId,
    type: msgType as "text" | "image" | "video",
    body: body.body ?? null,
    media_url: body.mediaUrl ?? null,
  });

  await db
    .update(conversations)
    .set({ last_message_at: now })
    .where(eq(conversations.id, conversationId));

  // Fetch the created message to return full shape
  const [newMsg] = await db
    .select({
      id: messages.id,
      body: messages.body,
      mediaUrl: messages.media_url,
      mediaType: messages.type,
      createdAt: messages.created_at,
      senderName: users.full_name,
      senderUsername: users.username,
      senderAvatar: profiles.avatar_url,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(eq(messages.id, msgId))
    .limit(1);

  return created({
    message: {
      id: msgId,
      body: newMsg?.body ?? null,
      mediaUrl: newMsg?.mediaUrl ?? null,
      mediaType: (newMsg?.mediaType === "image" || newMsg?.mediaType === "video") ? newMsg.mediaType : null,
      isDeleted: false,
      createdAt: newMsg?.createdAt ?? now,
      sender: {
        id: auth.user.userId,
        name: newMsg?.senderName ?? "",
        username: newMsg?.senderUsername ?? "",
        avatarUrl: newMsg?.senderAvatar ?? null,
      },
      isOwn: true,
    },
  });
}
