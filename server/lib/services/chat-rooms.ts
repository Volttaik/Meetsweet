import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blocked_users,
  chat_room_members,
  chat_room_messages,
  chat_rooms,
  creator_settings,
  profiles,
  subscriptions,
  users,
} from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseReactions(value: string | null): any[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r) => ({
      emoji: String(r?.emoji ?? ""),
      user_ids: Array.isArray(r?.user_ids) ? r.user_ids.map(String) : [],
      userIds: Array.isArray(r?.user_ids) ? r.user_ids.map(String) : [],
    }));
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function participantShape(u: any, isCreator: boolean) {
  return {
    id: u.id,
    name: u.display_name ?? u.full_name ?? "",
    full_name: u.full_name ?? u.display_name ?? "",
    username: u.username ?? "",
    avatar_url: u.avatar_url ?? null,
    avatarUrl: u.avatar_url ?? null,
    is_verified: Boolean(u.is_verified),
    isVerified: Boolean(u.is_verified),
    is_creator: isCreator,
    isCreator,
  };
}

export async function getParticipantUser(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      is_verified: users.is_verified,
      is_creator: users.is_creator,
      display_name: profiles.display_name,
      avatar_url: profiles.avatar_url,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/** Enforce the creator messaging rule server-side. Returns null when allowed. */
export async function messagingAllowedError(callerId: string, participantId: string): Promise<string | null> {
  const [creator] = await db
    .select({ who_can_message: creator_settings.who_can_message })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, participantId))
    .limit(1);

  if (!creator || creator.who_can_message === "everyone" || creator.who_can_message == null) {
    return null;
  }
  if (creator.who_can_message === "none") {
    return "This creator has disabled direct messages";
  }

  // "subscribers" → caller must hold an active subscription to this creator
  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.subscriber_id, callerId),
        eq(subscriptions.creator_id, participantId),
        eq(subscriptions.status, "active"),
      ),
    )
    .limit(1);

  if (!sub) {
    return "Subscribing is required to message this creator";
  }
  return null;
}

export async function findOrCreateChatRoom(callerId: string, participantId: string) {
  if (callerId === participantId) {
    throw new Error("Cannot open a chat room with yourself");
  }

  // One permanent room per pair (A+B == B+A). Includes rooms the caller
  // previously removed from their list (left_at set) so re-opening reuses the
  // same room rather than creating a duplicate.
  const memberships = await db
    .select({ chat_room_id: chat_room_members.chat_room_id, left_at: chat_room_members.left_at, member_id: chat_room_members.id })
    .from(chat_room_members)
    .where(eq(chat_room_members.user_id, callerId));

  for (const membership of memberships) {
    const [match] = await db
      .select({ id: chat_room_members.id })
      .from(chat_room_members)
      .where(and(eq(chat_room_members.chat_room_id, membership.chat_room_id), eq(chat_room_members.user_id, participantId)))
      .limit(1);
    if (match) {
      // Re-activate the caller's membership if they had left the room.
      if (membership.left_at) {
        await db
          .update(chat_room_members)
          .set({ left_at: null })
          .where(eq(chat_room_members.id, membership.member_id));
      }
      return { chatRoomId: membership.chat_room_id, created: false };
    }
  }

  const roomId = generateId();
  await db.insert(chat_rooms).values({ id: roomId, created_by: callerId });
  await db.insert(chat_room_members).values([
    { id: generateId(), chat_room_id: roomId, user_id: callerId, context_id: generateId() },
    { id: generateId(), chat_room_id: roomId, user_id: participantId, context_id: generateId() },
  ]);

  return { chatRoomId: roomId, created: true };
}

/** All room ids where the viewer still has a visible membership (not left). */
export async function listVisibleRoomIds(viewerId: string, tab: "all" | "archived"): Promise<string[]> {
  const conds = [eq(chat_room_members.user_id, viewerId)];
  // "all" excludes explicitly archived rooms; "archived" shows only them.
  conds.push(tab === "archived" ? eq(chat_room_members.is_archived, true) : eq(chat_room_members.is_archived, false));

  const rows = await db
    .select({ chat_room_id: chat_room_members.chat_room_id })
    .from(chat_room_members)
    .where(and(...conds, sql`${chat_room_members.left_at} IS NULL`));

  return rows.map((r) => r.chat_room_id);
}

export async function getMember(chatRoomId: string, userId: string) {
  const [member] = await db
    .select()
    .from(chat_room_members)
    .where(and(eq(chat_room_members.chat_room_id, chatRoomId), eq(chat_room_members.user_id, userId)))
    .limit(1);
  return member ?? null;
}

async function roomParticipants(chatRoomId: string) {
  return db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      is_verified: users.is_verified,
      is_creator: users.is_creator,
      display_name: profiles.display_name,
      avatar_url: profiles.avatar_url,
    })
    .from(chat_room_members)
    .innerJoin(users, eq(users.id, chat_room_members.user_id))
    .leftJoin(profiles, eq(profiles.user_id, chat_room_members.user_id))
    .where(eq(chat_room_members.chat_room_id, chatRoomId));
}

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ id: blocked_users.id })
    .from(blocked_users)
    .where(
      sql`(${blocked_users.blocker_id} = ${a} AND ${blocked_users.blocked_id} = ${b}) OR (${blocked_users.blocker_id} = ${b} AND ${blocked_users.blocked_id} = ${a})`,
    )
    .limit(1);
  return !!row;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildRoom(chatRoomId: string, viewerId: string): Promise<any | null> {
  const [room] = await db.select().from(chat_rooms).where(eq(chat_rooms.id, chatRoomId)).limit(1);
  if (!room) return null;

  const member = await getMember(chatRoomId, viewerId);
  if (!member) return null;

  const participants = await roomParticipants(chatRoomId);
  const others = participants.filter((p) => p.id !== viewerId);
  const other = others[0] ?? null;

  // Latest messages (newest first) — filter out anything the viewer cleared,
  // deleted-for-me, or that was recalled so the preview never shows stale
  // content after Clear Chat / Delete / recall.
  const recent = await db
    .select({
      id: chat_room_messages.id,
      body: chat_room_messages.body,
      media_type: chat_room_messages.media_type,
      sender_id: chat_room_messages.sender_id,
      created_at: chat_room_messages.created_at,
      is_recalled: chat_room_messages.is_recalled,
      deleted_for: chat_room_messages.deleted_for,
    })
    .from(chat_room_messages)
    .where(eq(chat_room_messages.chat_room_id, chatRoomId))
    .orderBy(desc(chat_room_messages.created_at))
    .limit(50);

  const viewerDeletedFor = (deletedFor: string | null): string[] => parseJsonArray(deletedFor);
  const clearedAt = member.cleared_at;
  const isVisibleToViewer = (r: {
    is_recalled: boolean | null;
    deleted_for: string | null;
    created_at: string;
  }): boolean => {
    if (r.is_recalled) return false;
    if (viewerDeletedFor(r.deleted_for).includes(viewerId)) return false;
    if (clearedAt && r.created_at <= clearedAt) return false;
    return true;
  };

  const lastMessage = recent.find(isVisibleToViewer) ?? null;

  // Unread count: messages from the other participant that are newer than the
  // viewer's last-read marker AND still visible (not cleared/deleted/recalled).
  const unreadCandidates = await db
    .select({
      id: chat_room_messages.id,
      created_at: chat_room_messages.created_at,
      is_recalled: chat_room_messages.is_recalled,
      deleted_for: chat_room_messages.deleted_for,
    })
    .from(chat_room_messages)
    .where(
      and(
        eq(chat_room_messages.chat_room_id, chatRoomId),
        eq(chat_room_messages.sender_id, other?.id ?? ""),
        sql`(${chat_room_messages.created_at} > ${member.last_read_at ?? ""})`,
      ),
    );
  const unreadCount = unreadCandidates.filter(isVisibleToViewer).length;

  const isBlocked = other ? await isBlockedBetween(viewerId, other.id) : false;

  return {
    chat_room_id: chatRoomId,
    chatRoomId,
    context_id: member.context_id,
    contextId: member.context_id,
    is_muted: member.is_muted,
    isMuted: member.is_muted,
    is_archived: member.is_archived,
    isArchived: member.is_archived,
    is_blocked: isBlocked,
    isBlocked,
    unread_count: unreadCount,
    unreadCount,
    created_at: room.created_at,
    createdAt: room.created_at,
    updated_at: room.updated_at,
    updatedAt: room.updated_at,
    last_message_at: room.last_message_at ?? lastMessage?.created_at ?? null,
    lastMessageAt: room.last_message_at ?? lastMessage?.created_at ?? null,
    last_message_id: lastMessage?.id ?? null,
    lastMessageId: lastMessage?.id ?? null,
    last_message_body: lastMessage?.body ?? null,
    lastMessageBody: lastMessage?.body ?? null,
    last_message_media_type: lastMessage?.media_type ?? null,
    lastMessageMediaType: lastMessage?.media_type ?? null,
    last_message_sender_id: lastMessage?.sender_id ?? null,
    lastMessageSenderId: lastMessage?.sender_id ?? null,
    participants: participants.map((p) => participantShape(p, p.is_creator)),
    other_user: other ? participantShape(other, other.is_creator) : null,
    otherUser: other ? participantShape(other, other.is_creator) : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildMessage(
  raw: any,
  viewerId: string,
  replyLookup?: Map<string, any>,
  readThrough?: string | null,
): Promise<any> {
  const reactions = parseReactions(raw.reactions);
  const deletedFor = parseJsonArray(raw.deleted_for);
  const isOwn = raw.sender_id === viewerId;
  // Honest status: "delivered" = persisted server-side (true for every stored
  // message); "read" = the OTHER participant's last_read_at has passed this
  // message's timestamp. Only meaningful for the viewer's own messages.
  const read = isOwn ? Boolean(readThrough && raw.created_at && raw.created_at <= readThrough) : false;

  let replyTo: any = null;
  if (raw.reply_to_id) {
    const quoted = replyLookup?.get(raw.reply_to_id);
    if (quoted) {
      replyTo = {
        id: quoted.id,
        body: quoted.body ?? null,
        media_type: quoted.media_type ?? null,
        mediaUrl: quoted.media_url ?? null,
        media_url: quoted.media_url ?? null,
        sender_name: quoted.sender_name ?? null,
      };
    }
  }

  return {
    id: raw.id,
    chat_room_id: raw.chat_room_id,
    chatRoomId: raw.chat_room_id,
    context_id: null,
    body: raw.body ?? null,
    media_url: raw.media_url ?? null,
    mediaUrl: raw.media_url ?? null,
    media_type: raw.media_type ?? null,
    mediaType: raw.media_type ?? null,
    file_type: raw.file_type ?? null,
    fileType: raw.file_type ?? null,
    is_voice_note: Boolean(raw.is_voice_note),
    isVoiceNote: Boolean(raw.is_voice_note),
    audio_duration: raw.audio_duration ?? null,
    audioDuration: raw.audio_duration ?? null,
    file_name: raw.file_name ?? null,
    fileName: raw.file_name ?? null,
    file_size: raw.file_size ?? null,
    fileSize: raw.file_size ?? null,
    mime_type: raw.mime_type ?? null,
    mimeType: raw.mime_type ?? null,
    caption: raw.caption ?? null,
    is_deleted: Boolean(raw.is_recalled) || deletedFor.includes(viewerId),
    isDeleted: Boolean(raw.is_recalled) || deletedFor.includes(viewerId),
    is_edited: Boolean(raw.is_edited),
    isEdited: Boolean(raw.is_edited),
    created_at: raw.created_at,
    createdAt: raw.created_at,
    sender: {
      id: raw.sender_id,
      name: raw.sender_display_name ?? raw.sender_name ?? "User",
      username: raw.sender_username ?? "",
      avatarUrl: raw.sender_avatar ?? null,
      avatar_url: raw.sender_avatar ?? null,
      is_verified: Boolean(raw.sender_is_verified),
      is_creator: Boolean(raw.sender_is_creator),
    },
    is_own: isOwn,
    isOwn: isOwn,
    delivered: true,
    read,
    reactions,
    reply_to: replyTo,
    replyTo,
  };
}

/** Messages visible to the viewer, with sender + reply metadata joined in. */
export async function listRoomMessages(
  chatRoomId: string,
  viewerId: string,
  opts: { before?: string; after?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(1, opts.limit ?? 30), 100);
  const member = await getMember(chatRoomId, viewerId);

  const conds = [eq(chat_room_messages.chat_room_id, chatRoomId)];
  if (opts.before) conds.push(lt(chat_room_messages.created_at, opts.before));
  if (opts.after) conds.push(gt(chat_room_messages.created_at, opts.after));

  const rows = await db
    .select({
      id: chat_room_messages.id,
      chat_room_id: chat_room_messages.chat_room_id,
      sender_id: chat_room_messages.sender_id,
      reply_to_id: chat_room_messages.reply_to_id,
      body: chat_room_messages.body,
      media_url: chat_room_messages.media_url,
      media_type: chat_room_messages.media_type,
      caption: chat_room_messages.caption,
      file_name: chat_room_messages.file_name,
      file_size: chat_room_messages.file_size,
      mime_type: chat_room_messages.mime_type,
      audio_duration: chat_room_messages.audio_duration,
      file_type: chat_room_messages.file_type,
      is_voice_note: chat_room_messages.is_voice_note,
      reactions: chat_room_messages.reactions,
      deleted_for: chat_room_messages.deleted_for,
      is_edited: chat_room_messages.is_edited,
      is_recalled: chat_room_messages.is_recalled,
      created_at: chat_room_messages.created_at,
      sender_name: users.full_name,
      sender_display_name: profiles.display_name,
      sender_username: users.username,
      sender_avatar: profiles.avatar_url,
      sender_is_verified: users.is_verified,
      sender_is_creator: users.is_creator,
    })
    .from(chat_room_messages)
    .innerJoin(users, eq(users.id, chat_room_messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, chat_room_messages.sender_id))
    .where(and(...conds))
    .orderBy(opts.after ? chat_room_messages.created_at : desc(chat_room_messages.created_at))
    .limit(limit);

  // Hide messages the viewer deleted-for-me / recalled / cleared.
  const visible = rows.filter((r) => {
    if (r.is_recalled) return false;
    const deletedFor = parseJsonArray(r.deleted_for);
    if (deletedFor.includes(viewerId)) return false;
    if (member?.cleared_at && r.created_at <= member.cleared_at) return false;
    return true;
  });

  // Resolve reply-to previews in one pass.
  const replyIds = [...new Set(visible.map((r) => r.reply_to_id).filter(Boolean))] as string[];
  const replyLookup = new Map<string, any>();
  if (replyIds.length > 0) {
    const replies = await db
      .select({
        id: chat_room_messages.id,
        body: chat_room_messages.body,
        media_type: chat_room_messages.media_type,
        media_url: chat_room_messages.media_url,
        sender_name: users.full_name,
        sender_display_name: profiles.display_name,
        sender_username: users.username,
      })
      .from(chat_room_messages)
      .innerJoin(users, eq(users.id, chat_room_messages.sender_id))
      .leftJoin(profiles, eq(profiles.user_id, chat_room_messages.sender_id))
      .where(sql`${chat_room_messages.id} IN (${sql.join(replyIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const r of replies) replyLookup.set(r.id, r);
  }

  // Read marker for the viewer's outgoing messages: the OTHER participant's
  // last_read_at. When it has passed a message's timestamp, that message was
  // read by the recipient.
  let readThrough: string | null = null;
  if (member) {
    const [otherMember] = await db
      .select({ last_read_at: chat_room_members.last_read_at })
      .from(chat_room_members)
      .where(
        and(
          eq(chat_room_members.chat_room_id, chatRoomId),
          sql`${chat_room_members.user_id} != ${viewerId}`,
        ),
      )
      .limit(1);
    readThrough = otherMember?.last_read_at ?? null;
  }

  const messages = [];
  for (const r of visible) {
    messages.push(await buildMessage(r, viewerId, replyLookup, readThrough));
  }
  return messages;
}
