import { NextRequest } from "next/server";
import { eq, and, desc, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, conversations, conversation_members, messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const sendSchema = z.object({
  body: z.string().max(2000).optional(),
  media_url: z.string().url().nullable().optional(),
  media_type: z.enum(["image", "video", "audio"]).nullable().optional(),
  reply_to_id: z.string().optional(),
}).refine((d) => d.body || d.media_url, { message: "body or media_url required" });

async function assertMember(convId: string, userId: string) {
  const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, convId)).limit(1);
  if (!conv) return "not_found";
  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(and(eq(conversation_members.conversation_id, convId), eq(conversation_members.user_id, userId)))
    .limit(1);
  return member ? "ok" : "forbidden";
}

function formatMessage(m: Record<string, unknown>, myUserId: string) {
  const isOwn = m.sender_id === myUserId;
  return {
    id: m.id,
    body: m.is_recalled ? null : m.body,
    mediaUrl: m.is_recalled ? null : m.media_url,
    media_url: m.is_recalled ? null : m.media_url,
    // mobile normalizer checks raw.mediaType ?? raw.media_type
    mediaType: m.media_type ?? null,
    media_type: m.media_type ?? null,
    // mobile normalizer checks raw.isDeleted ?? raw.is_deleted
    isDeleted: Boolean(m.is_recalled),
    is_deleted: Boolean(m.is_recalled),
    is_recalled: Boolean(m.is_recalled),
    // mobile normalizer checks raw.isOwn (camelCase only)
    isOwn,
    is_own: isOwn,
    createdAt: m.created_at,
    created_at: m.created_at,
    sender: {
      id: m.sender_id,
      name: m.sender_name,
      username: m.sender_username,
      avatar_url: m.sender_avatar,
      avatarUrl: m.sender_avatar,
    },
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const check = await assertMember(id, auth.user.userId);
  if (check === "not_found") return err("Conversation not found", 404);
  if (check === "forbidden") return err("Forbidden", 403);

  const before = req.nextUrl.searchParams.get("before");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  const baseSelect = {
    id: messages.id,
    body: messages.body,
    media_url: messages.media_url,
    media_type: messages.type,
    is_recalled: messages.is_recalled,
    reply_to_id: messages.reply_to_id,
    created_at: messages.created_at,
    sender_id: users.id,
    sender_name: users.full_name,
    sender_username: users.username,
    sender_avatar: profiles.avatar_url,
  };

  const whereClause = before
    ? and(eq(messages.conversation_id, id), lt(messages.created_at, before))
    : eq(messages.conversation_id, id);

  const rows = await db
    .select(baseSelect)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(whereClause)
    .orderBy(desc(messages.created_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return ok({
    messages: items.map((m) => formatMessage(m as Record<string, unknown>, auth.user.userId)),
    hasMore,
    has_more: hasMore,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const check = await assertMember(id, auth.user.userId);
  if (check === "not_found") return err("Conversation not found", 404);
  if (check === "forbidden") return err("Forbidden", 403);

  const parsed = await parseBody(req, sendSchema);
  if (!parsed.success) return parsed.response;

  const msgId = generateId();
  const now = new Date().toISOString();

  await db.insert(messages).values({
    id: msgId,
    conversation_id: id,
    sender_id: auth.user.userId,
    body: parsed.data.body ?? null,
    media_url: parsed.data.media_url ?? null,
    reply_to_id: parsed.data.reply_to_id ?? null,
    type: parsed.data.media_url ? (parsed.data.media_type ?? "media") : "text",
  });

  await db.update(conversations).set({ last_message_at: now, updated_at: now }).where(eq(conversations.id, id));

  const [row] = await db
    .select({
      id: messages.id,
      body: messages.body,
      media_url: messages.media_url,
      media_type: messages.type,
      is_recalled: messages.is_recalled,
      reply_to_id: messages.reply_to_id,
      created_at: messages.created_at,
      sender_id: users.id,
      sender_name: users.full_name,
      sender_username: users.username,
      sender_avatar: profiles.avatar_url,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(eq(messages.id, msgId))
    .limit(1);

  return ok({
    message: formatMessage(row as Record<string, unknown>, auth.user.userId),
  });
}
