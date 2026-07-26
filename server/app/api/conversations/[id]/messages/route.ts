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
  media_type: z.enum(["image", "video"]).nullable().optional(),
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

  let query = db
    .select({
      id: messages.id,
      body: messages.body,
      media_url: messages.media_url,
      type: messages.type,
      is_edited: messages.is_edited,
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
    .where(eq(messages.conversation_id, id))
    .orderBy(desc(messages.created_at))
    .limit(limit + 1);

  if (before) {
    query = db
      .select({
        id: messages.id,
        body: messages.body,
        media_url: messages.media_url,
        type: messages.type,
        is_edited: messages.is_edited,
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
      .where(and(eq(messages.conversation_id, id), lt(messages.created_at, before)))
      .orderBy(desc(messages.created_at))
      .limit(limit + 1);
  }

  const rows = await query;
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return ok({
    messages: items.map((m) => ({
      id: m.id,
      body: m.is_recalled ? null : m.body,
      media_url: m.is_recalled ? null : m.media_url,
      type: m.type,
      is_edited: m.is_edited,
      is_recalled: m.is_recalled,
      reply_to_id: m.reply_to_id,
      created_at: m.created_at,
      is_own: m.sender_id === auth.user.userId,
      sender: {
        id: m.sender_id,
        name: m.sender_name,
        username: m.sender_username,
        avatar_url: m.sender_avatar,
      },
    })),
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
    type: parsed.data.media_url ? "media" : "text",
  });

  await db.update(conversations).set({ last_message_at: now, updated_at: now }).where(eq(conversations.id, id));

  const [row] = await db
    .select({
      id: messages.id,
      body: messages.body,
      media_url: messages.media_url,
      type: messages.type,
      is_edited: messages.is_edited,
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
    message: {
      id: row!.id,
      body: row!.body,
      media_url: row!.media_url,
      type: row!.type,
      is_edited: row!.is_edited,
      is_recalled: row!.is_recalled,
      reply_to_id: row!.reply_to_id,
      created_at: row!.created_at,
      is_own: true,
      sender: {
        id: row!.sender_id,
        name: row!.sender_name,
        username: row!.sender_username,
        avatar_url: row!.sender_avatar,
      },
    },
  });
}
