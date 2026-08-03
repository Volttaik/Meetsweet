import { NextRequest } from "next/server";
import { eq, and, desc, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  users,
  profiles,
  conversations,
  conversation_members,
  messages,
  message_unlocks,
  wallets,
  transactions,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const sendSchema = z
  .object({
    body: z.string().max(4000).optional(),
    caption: z.string().max(1000).optional(),
    media_url: z.string().url().nullable().optional(),
    // media_blob_path: client may send but we store it in the media table, not here
    media_blob_path: z.string().nullable().optional(),
    // mobile sends camelCase too
    mediaUrl: z.string().url().nullable().optional(),
    media_type: z.enum(["image", "video", "audio", "document"]).nullable().optional(),
    mediaType: z.enum(["image", "video", "audio", "document"]).nullable().optional(),
    reply_to_id: z.string().optional(),
    // Attachment metadata
    mime_type: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
    fileName: z.string().nullable().optional(),
    file_size: z.number().int().nullable().optional(),
    fileSize: z.number().int().nullable().optional(),
    audio_duration: z.number().nullable().optional(),
    audioDuration: z.number().nullable().optional(),
    // Paid content
    is_paid: z.boolean().optional(),
    isPaid: z.boolean().optional(),
    paid_price: z.number().int().min(0).nullable().optional(),
    paidPrice: z.number().int().min(0).nullable().optional(),
  })
  .refine(
    (d) =>
      d.body ||
      d.caption ||
      d.media_url ||
      d.mediaUrl,
    { message: "body, caption, or media_url is required" },
  );

async function assertMember(convId: string, userId: string) {
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, convId))
    .limit(1);
  if (!conv) return "not_found";
  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, convId),
        eq(conversation_members.user_id, userId),
      ),
    )
    .limit(1);
  return member ? "ok" : "forbidden";
}

function parseReactions(raw: unknown): { emoji: string; user_ids: string[]; userIds: string[] }[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r: { emoji: string; user_ids?: string[]; userIds?: string[] }) => ({
      emoji: r.emoji,
      user_ids: r.user_ids ?? r.userIds ?? [],
      userIds: r.user_ids ?? r.userIds ?? [],
    }));
  } catch {
    return [];
  }
}

function formatMessage(
  m: Record<string, unknown>,
  myUserId: string,
  unlockedSet?: Set<string>,
) {
  const isOwn = m.sender_id === myUserId;
  const isPaid = Boolean(m.is_paid);
  const isUnlocked = isOwn || Boolean(unlockedSet?.has(m.id as string));
  const isRecalled = Boolean(m.is_recalled);

  return {
    id: m.id,
    body: isRecalled ? null : m.body,
    caption: isRecalled ? null : m.caption,
    mediaUrl: isRecalled || (isPaid && !isUnlocked) ? null : (m.media_url ?? null),
    media_url: isRecalled || (isPaid && !isUnlocked) ? null : (m.media_url ?? null),
    // mobile normalizer checks raw.mediaType ?? raw.media_type
    mediaType: m.media_type ?? null,
    media_type: m.media_type ?? null,
    // Attachment metadata
    mimeType: m.mime_type ?? null,
    mime_type: m.mime_type ?? null,
    fileName: m.file_name ?? null,
    file_name: m.file_name ?? null,
    fileSize: m.file_size ?? null,
    file_size: m.file_size ?? null,
    audioDuration: m.audio_duration ?? null,
    audio_duration: m.audio_duration ?? null,
    // Paid content fields
    isPaid,
    is_paid: isPaid,
    isUnlocked,
    is_unlocked: isUnlocked,
    paidPrice: m.paid_price ?? null,
    paid_price: m.paid_price ?? null,
    // mobile normalizer checks raw.isDeleted ?? raw.is_deleted
    isDeleted: isRecalled,
    is_deleted: isRecalled,
    is_recalled: isRecalled,
    // mobile normalizer checks raw.isEdited
    isEdited: Boolean(m.is_edited),
    is_edited: Boolean(m.is_edited),
    // mobile normalizer checks raw.isOwn (camelCase only)
    isOwn,
    is_own: isOwn,
    reply_to_id: m.reply_to_id ?? null,
    createdAt: m.created_at,
    created_at: m.created_at,
    // Reactions — stored as JSON in messages.reactions
    reactions: parseReactions(m.reactions),
    sender: {
      id: m.sender_id,
      name: m.sender_name,
      username: m.sender_username,
      avatar_url: m.sender_avatar,
      avatarUrl: m.sender_avatar,
    },
  };
}

const MSG_SELECT = {
  id: messages.id,
  body: messages.body,
  caption: messages.caption,
  media_url: messages.media_url,
  media_type: messages.type,
  mime_type: messages.mime_type,
  file_name: messages.file_name,
  file_size: messages.file_size,
  audio_duration: messages.audio_duration,
  is_paid: messages.is_paid,
  paid_price: messages.paid_price,
  is_recalled: messages.is_recalled,
  is_edited: messages.is_edited,
  reply_to_id: messages.reply_to_id,
  reactions: messages.reactions,
  created_at: messages.created_at,
  sender_id: users.id,
  sender_name: users.full_name,
  sender_username: users.username,
  sender_avatar: profiles.avatar_url,
};

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
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 20),
    50,
  );

  const whereClause = before
    ? and(
        eq(messages.conversation_id, id),
        lt(messages.created_at, before),
      )
    : eq(messages.conversation_id, id);

  const rows = await db
    .select(MSG_SELECT)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(whereClause)
    .orderBy(desc(messages.created_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  // Fetch unlocked paid messages for this user in one query
  const paidIds = items.filter((m) => m.is_paid).map((m) => m.id);
  let unlockedSet = new Set<string>();
  if (paidIds.length > 0) {
    const unlocks = await db
      .select({ message_id: message_unlocks.message_id })
      .from(message_unlocks)
      .where(eq(message_unlocks.user_id, auth.user.userId));
    unlockedSet = new Set(unlocks.map((u) => u.message_id));
  }

  return ok({
    messages: items.map((m) =>
      formatMessage(m as Record<string, unknown>, auth.user.userId, unlockedSet),
    ),
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

  const d = parsed.data;

  // Normalize camelCase → snake_case
  const mediaUrl = d.media_url ?? d.mediaUrl ?? null;
  const mediaType = d.media_type ?? d.mediaType ?? null;
  const mimeType = d.mime_type ?? d.mimeType ?? null;
  const fileName = d.file_name ?? d.fileName ?? null;
  const fileSize = d.file_size ?? d.fileSize ?? null;
  const audioDuration = d.audio_duration ?? d.audioDuration ?? null;
  const isPaid = d.is_paid ?? d.isPaid ?? false;
  const paidPrice = d.paid_price ?? d.paidPrice ?? null;

  const msgId = generateId();
  const now = new Date().toISOString();

  let msgType = "text";
  if (mediaUrl) {
    msgType = mediaType ?? "media";
  }

  await db.insert(messages).values({
    id: msgId,
    conversation_id: id,
    sender_id: auth.user.userId,
    body: d.body ?? null,
    caption: d.caption ?? null,
    media_url: mediaUrl,
    reply_to_id: d.reply_to_id ?? null,
    type: msgType,
    mime_type: mimeType,
    file_name: fileName,
    file_size: fileSize,
    audio_duration: audioDuration,
    is_paid: isPaid,
    paid_price: isPaid ? (paidPrice ?? null) : null,
  });

  await db
    .update(conversations)
    .set({ last_message_at: now, updated_at: now })
    .where(eq(conversations.id, id));

  const [row] = await db
    .select(MSG_SELECT)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(eq(messages.id, msgId))
    .limit(1);

  return ok({
    message: formatMessage(
      row as Record<string, unknown>,
      auth.user.userId,
      new Set<string>(),
    ),
  });
}
