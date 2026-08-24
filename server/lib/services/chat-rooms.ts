import { createHash } from "crypto";
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blocked_users,
  chat_room_members,
  chat_room_messages,
  chat_rooms,
  creator_settings,
  devices,
  profiles,
  subscriptions,
  users,
  user_settings,
} from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

/**
 * Stable room id for a private DM — a pure function of the two user ids, so the
 * mobile client derives it locally and opening a chat needs zero network. New
 * rooms cannot split when both users open the conversation at the same time
 * from opposite devices.
 *
 * MUST stay byte-identical with the mobile mirror (deriveRoomId in
 * services/room-service.ts): sha256 of the lexicographically sorted pair.
 */
export function deterministicDmRoomId(a: string, b: string): string {
  const pair = [a, b].sort().join(":");
  return `dm_${createHash("sha256").update(pair).digest("hex").slice(0, 32)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Whether a user should be presented as online to others. A device seen within
 * the last 10 minutes counts as online (devices.last_seen_at is updated on
 * push-token registration / app foreground). The user's OWN privacy settings
 * gate the indicator: turning off Online Status or Activity Status hides it
 * from everyone, so "hide my online status" is enforced server-side.
 */
async function participantOnline(userId: string): Promise<boolean> {
  const [settings] = await db
    .select({
      online_status: user_settings.online_status,
      activity_status: user_settings.activity_status,
    })
    .from(user_settings)
    .where(eq(user_settings.user_id, userId))
    .limit(1);
  if (settings && (settings.online_status === false || settings.activity_status === false)) {
    return false;
  }
  const TEN_MINUTES = 10 * 60 * 1000;
  const cutoff = new Date(Date.now() - TEN_MINUTES).toISOString();
  const [recentDevice] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.user_id, userId), sql`${devices.last_seen_at} >= ${cutoff}`))
    .limit(1);
  return Boolean(recentDevice);
}

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

/**
 * The recipient's privacy policy for "who can message me": user_settings
 * allow_dms (hard off-switch) and message_perm (everyone | subscribers |
 * nobody). Missing settings rows default to fully open — same defaults as the
 * schema.
 */
async function userMessagingPolicyError(callerId: string, participantId: string): Promise<string | null> {
  const [policy] = await db
    .select({ allow_dms: user_settings.allow_dms, message_perm: user_settings.message_perm })
    .from(user_settings)
    .where(eq(user_settings.user_id, participantId))
    .limit(1);

  if (!policy) return null;
  if (policy.allow_dms === false) return "This user has disabled direct messages";
  if (policy.message_perm === "nobody") return "This user has disabled direct messages";
  if (policy.message_perm === "subscribers") {
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
    if (!sub) return "Subscribing is required to message this user";
  }
  return null;
}

/**
 * Enforce the messaging rules server-side — the recipient's creator rule AND
 * their privacy policy (allow_dms / message_perm). Returns null when allowed.
 * The stricter of the two rules wins; every chat-room open and message send
 * goes through here so the setting cannot be bypassed by calling the API.
 */
export async function messagingAllowedError(callerId: string, participantId: string): Promise<string | null> {
  const [creator] = await db
    .select({ who_can_message: creator_settings.who_can_message })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, participantId))
    .limit(1);

  if (!creator || creator.who_can_message === "everyone" || creator.who_can_message == null) {
    return userMessagingPolicyError(callerId, participantId);
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
  // The creator rule passed — still respect the recipient's own privacy policy.
  return userMessagingPolicyError(callerId, participantId);
}

export interface ResolvedDmRoom {
  chatRoomId: string;
  created: boolean;
  /** Set when a pre-deterministic legacy room was adopted to the derived id. */
  migratedFrom?: string;
}

/**
 * Resolve (and lazily materialize) the single canonical DM room for a pair.
 *
 * The room id is a pure function of the two user ids (deterministicDmRoomId),
 * so the mobile client derives it locally and never needs a network call to
 * open a chat. This resolver makes the derived id authoritative in every case:
 *   - fast path: the derived room already exists (re-activates a left room),
 *   - legacy path: a pre-deterministic room exists for the pair — it is
 *     adopted (rows copied to the derived id, legacy rows cascade-deleted) so
 *     every client converges on the same canonical id,
 *   - fresh path: the derived room is created on first use.
 */
export async function findOrCreateChatRoom(callerId: string, participantId: string): Promise<ResolvedDmRoom> {
  if (callerId === participantId) {
    throw new Error("Cannot open a chat room with yourself");
  }
  const roomId = deterministicDmRoomId(callerId, participantId);

  // Fast path — the canonical room already exists and the caller is a member.
  const [existing] = await db
    .select({ id: chat_room_members.id, left_at: chat_room_members.left_at })
    .from(chat_room_members)
    .where(and(eq(chat_room_members.chat_room_id, roomId), eq(chat_room_members.user_id, callerId)))
    .limit(1);
  if (existing) {
    if (existing.left_at) {
      await db.update(chat_room_members).set({ left_at: null }).where(eq(chat_room_members.id, existing.id));
    }
    return { chatRoomId: roomId, created: false };
  }

  // Legacy path — a pre-deterministic room exists for this pair (created
  // before room ids were derived from the participant ids). Adopt it so the
  // derived id the client computed becomes the canonical one.
  const legacyId = await legacyDmRoomId(callerId, participantId);
  if (legacyId) {
    const migratedFrom = await adoptLegacyDmRoom(legacyId, roomId, callerId);
    // Whether we adopted or a concurrent device won, the caller is now a
    // member of the canonical room.
    return { chatRoomId: roomId, created: false, migratedFrom: migratedFrom ?? undefined };
  }

  // Fresh path — create the deterministic room (+ both memberships). The
  // unique (room,user) index makes this idempotent if both participants open
  // the same new DM at once; the deterministic id prevents a second
  // pair-specific room from being created by the losing request.
  let created = true;
  try {
    await db.insert(chat_rooms).values({ id: roomId, created_by: callerId });
  } catch {
    created = false;
  }
  await db
    .insert(chat_room_members)
    .values([
      { id: generateId(), chat_room_id: roomId, user_id: callerId, context_id: generateId() },
      { id: generateId(), chat_room_id: roomId, user_id: participantId, context_id: generateId() },
    ])
    .onConflictDoNothing();

  return { chatRoomId: roomId, created };
}

/** Scan the caller's memberships for a pre-deterministic room shared with the participant. */
async function legacyDmRoomId(callerId: string, participantId: string): Promise<string | null> {
  const memberships = await db
    .select({ chat_room_id: chat_room_members.chat_room_id })
    .from(chat_room_members)
    .where(eq(chat_room_members.user_id, callerId));
  for (const membership of memberships) {
    if (membership.chat_room_id.startsWith("dm_")) continue;
    const [match] = await db
      .select({ id: chat_room_members.id })
      .from(chat_room_members)
      .where(
        and(
          eq(chat_room_members.chat_room_id, membership.chat_room_id),
          eq(chat_room_members.user_id, participantId),
        ),
      )
      .limit(1);
    if (match) return membership.chat_room_id;
  }
  return null;
}

/**
 * Copy a legacy room (room + members + messages) to the canonical derived id,
 * then delete the legacy rows (FK cascade cleans children). Row ids are
 * preserved, so message/member identity stays stable across the migration.
 * Returns the legacy id when THIS call performed the adoption, or null when a
 * concurrent device already did (idempotent via onConflictDoNothing).
 */
async function adoptLegacyDmRoom(legacyId: string, derivedId: string, callerId: string): Promise<string | null> {
  let adopted: string | null = null;
  await db.transaction(async (tx) => {
    const [room] = await tx.select().from(chat_rooms).where(eq(chat_rooms.id, legacyId)).limit(1);
    if (!room) return;
    const members = await tx.select().from(chat_room_members).where(eq(chat_room_members.chat_room_id, legacyId));
    const messages = await tx.select().from(chat_room_messages).where(eq(chat_room_messages.chat_room_id, legacyId));

    await tx
      .insert(chat_rooms)
      .values({
        id: derivedId,
        created_by: room.created_by,
        last_message_at: room.last_message_at,
        created_at: room.created_at,
        updated_at: room.updated_at,
      })
      .onConflictDoNothing();
    if (members.length) {
      await tx
        .insert(chat_room_members)
        .values(members.map((m) => ({ ...m, chat_room_id: derivedId })))
        .onConflictDoNothing();
    }
    if (messages.length) {
      await tx
        .insert(chat_room_messages)
        .values(messages.map((m) => ({ ...m, chat_room_id: derivedId })))
        .onConflictDoNothing();
    }

    // Only delete the legacy rows once the derived room genuinely holds this
    // pair's memberships (never delete into an unrelated pre-existing room).
    const [aMember] = await tx
      .select({ id: chat_room_members.id })
      .from(chat_room_members)
      .where(and(eq(chat_room_members.chat_room_id, derivedId), eq(chat_room_members.user_id, callerId)))
      .limit(1);
    const otherId = members.find((m) => m.user_id !== callerId)?.user_id;
    const [bMember] = otherId
      ? await tx
          .select({ id: chat_room_members.id })
          .from(chat_room_members)
          .where(and(eq(chat_room_members.chat_room_id, derivedId), eq(chat_room_members.user_id, otherId)))
          .limit(1)
      : [null];
    if (!aMember || !bMember) return;

    await tx.delete(chat_room_messages).where(eq(chat_room_messages.chat_room_id, legacyId));
    await tx.delete(chat_room_members).where(eq(chat_room_members.chat_room_id, legacyId));
    await tx.delete(chat_rooms).where(eq(chat_rooms.id, legacyId));
    adopted = legacyId;
  });
  return adopted;
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

/** Authoritative member ids of a room (both participants in a 1:1 chat). */
export async function getRoomParticipantIds(chatRoomId: string): Promise<string[]> {
  const rows = await roomParticipants(chatRoomId);
  return rows.map((r) => r.id);
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

  // Latest messages (newest first). A deleted/recalled message remains a
  // durable timeline item; its body is rendered by clients as the deleted
  // placeholder instead of silently disappearing. Only messages before this
  // user's clear marker are omitted from the local presentation.
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
  const otherOnline = other ? await participantOnline(other.id) : false;

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
    other_user: other
      ? { ...participantShape(other, other.is_creator), is_online: otherOnline, isOnline: otherOnline }
      : null,
    otherUser: other
      ? { ...participantShape(other, other.is_creator), is_online: otherOnline, isOnline: otherOnline }
      : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildMessage(
  raw: any,
  viewerId: string,
  replyLookup?: Map<string, any>,
  readThrough?: string | null,
  readReceiptsEnabled = true,
): Promise<any> {
  const reactions = parseReactions(raw.reactions);
  const deletedFor = parseJsonArray(raw.deleted_for);
  // Rich link preview (JSON) — parsed once so both camel and snake keys carry
  // the same object; the client renders the card straight from this.
  let linkPreview: unknown = null;
  if (typeof raw.link_preview === "string" && raw.link_preview) {
    try {
      linkPreview = JSON.parse(raw.link_preview);
    } catch {
      linkPreview = null;
    }
  } else if (raw.linkPreview && typeof raw.linkPreview === "object") {
    linkPreview = raw.linkPreview;
  }
  const isOwn = raw.sender_id === viewerId;
  // Honest status: "delivered" = persisted server-side (true for every stored
  // message); "read" = the OTHER participant's last_read_at has passed this
  // message's timestamp. Only meaningful for the viewer's own messages, and
  // only reported when the other participant has Read Receipts enabled — when
  // they turned it off, no read signal is ever sent, enforced server-side.
  const read = isOwn
    ? Boolean(readReceiptsEnabled && readThrough && raw.created_at && raw.created_at <= readThrough)
    : false;

  let replyTo: any = null;
  if (raw.reply_to_id) {
    const quoted = replyLookup?.get(raw.reply_to_id);
    if (quoted) {
      // A reply to a recalled/deleted message must not leak the original
      // content — the quote renders "Original message deleted" instead.
      const quotedDeleted = Boolean(quoted.is_recalled);
      replyTo = {
        id: quoted.id,
        body: quotedDeleted ? null : (quoted.body ?? null),
        media_type: quotedDeleted ? null : (quoted.media_type ?? null),
        mediaUrl: quotedDeleted ? null : (quoted.media_url ?? null),
        media_url: quotedDeleted ? null : (quoted.media_url ?? null),
        sender_name: quoted.sender_name ?? null,
        deleted: quotedDeleted ? true : undefined,
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
    link_preview: linkPreview,
    linkPreview,
  };
}

function parseMessageCursor(value?: string): { createdAt: string; id: string } | null {
  if (!value) return null;
  const separator = value.lastIndexOf("::");
  if (separator <= 0 || separator === value.length - 2) return null;
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 2);
  return createdAt && id ? { createdAt, id } : null;
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
  const before = parseMessageCursor(opts.before);
  const after = parseMessageCursor(opts.after);
  if (before) {
    conds.push(or(
      lt(chat_room_messages.created_at, before.createdAt),
      and(eq(chat_room_messages.created_at, before.createdAt), lt(chat_room_messages.id, before.id)),
    )!);
  }
  if (after) {
    conds.push(or(
      gt(chat_room_messages.created_at, after.createdAt),
      and(eq(chat_room_messages.created_at, after.createdAt), gt(chat_room_messages.id, after.id)),
    )!);
  }

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
      link_preview: chat_room_messages.link_preview,
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
    // Deterministic ordering: created_at is not unique (two messages can be
    // written in the same millisecond), so tie-break on the id (also
    // monotonically increasing per insert). Without this, pagination and the
    // changes feed could return the same message twice or skip one on
    // same-timestamp boundaries, and the client's list could wobble.
    .orderBy(
      opts.after
        ? sql`${chat_room_messages.created_at} ASC, ${chat_room_messages.id} ASC`
        : sql`${chat_room_messages.created_at} DESC, ${chat_room_messages.id} DESC`,
    )
    .limit(limit);

  // Keep deleted/recalled rows in chronological history. The message payload
  // carries `isDeleted`; the client renders the persistent placeholder while
  // preserving the original message id and timestamp. Only this user's clear
  // marker removes rows from their local presentation.
  const visible = rows.filter((r) => !member?.cleared_at || r.created_at > member.cleared_at);

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
        is_recalled: chat_room_messages.is_recalled,
      })
      .from(chat_room_messages)
      .innerJoin(users, eq(users.id, chat_room_messages.sender_id))
      .leftJoin(profiles, eq(profiles.user_id, chat_room_messages.sender_id))
      .where(sql`${chat_room_messages.id} IN (${sql.join(replyIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const r of replies) replyLookup.set(r.id, r);
  }

  // Read marker for the viewer's outgoing messages: the OTHER participant's
  // last_read_at. When it has passed a message's timestamp, that message was
  // read by the recipient — but only when that participant has Read Receipts
  // enabled (their privacy setting, read from user_settings and enforced here).
  let readThrough: string | null = null;
  let readReceiptsEnabled = true;
  if (member) {
    const [otherMember] = await db
      .select({
        last_read_at: chat_room_members.last_read_at,
        read_receipts: user_settings.read_receipts,
      })
      .from(chat_room_members)
      .leftJoin(user_settings, eq(user_settings.user_id, chat_room_members.user_id))
      .where(
        and(
          eq(chat_room_members.chat_room_id, chatRoomId),
          sql`${chat_room_members.user_id} != ${viewerId}`,
        ),
      )
      .limit(1);
    readThrough = otherMember?.last_read_at ?? null;
    readReceiptsEnabled = otherMember?.read_receipts !== false;
  }

  const messages = [];
  for (const r of visible) {
    messages.push(await buildMessage(r, viewerId, replyLookup, readThrough, readReceiptsEnabled));
  }
  return messages;
}
