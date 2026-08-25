/**
 * Private Inbox — email-style paid correspondence between users and creators.
 *
 * Product model (deliberately simple):
 *   Creator enables their Private Inbox and sets a price.
 *   A user pays that price ONCE to deliver one message to the creator.
 *   The creator may reply once — text plus optional media, optionally priced.
 *   The original sender can buy a priced reply attachment to unlock it.
 *
 * Rules enforced here:
 *  - The price is ALWAYS read from creator_settings server-side; the client
 *    never states what it pays.
 *  - Payment + message creation happen in ONE db.transaction; the conditional
 *    `UPDATE wallets ... WHERE balance >= price RETURNING` makes an overdraft
 *    impossible, and the unique (sender_id, idempotency_key) index makes a
 *    retried submit return the original message without re-charging.
 *  - Replies only by the recipient-creator, one level deep.
 *  - Attachment purchases only by the ORIGINAL sender, exactly once.
 *  - Every mutation emits a durable realtime event on the affected users'
 *    channels AFTER commit — enough payload for clients to update in place
 *    without follow-up requests.
 */

import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blocked_users,
  creator_settings,
  media,
  private_message_attachments,
  private_messages,
  subscriptions,
  profiles,
  transactions,
  users,
  wallets,
} from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { recordCreatorEarning } from "@/lib/services/creator-finance";
import { emitEvent } from "@/lib/realtime/emit";
import { userChannel } from "@/lib/realtime/types";
import {
  createNotification,
  sendPushToUser,
  getActorUsername,
} from "@/lib/services/push";

export class PrivateInboxError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

// ─── View builders ───────────────────────────────────────────────────────────

export type MessageRow = typeof private_messages.$inferSelect;
export type AttachmentRow = typeof private_message_attachments.$inferSelect;

export interface MessageAttachmentView {
  id: string;
  media_id: string;
  media_type: "image" | "video" | "file";
  media_url: string | null;
  thumbnail_url?: string | null;
  price: number;
  is_locked: boolean;
  purchased_by_me: boolean;
}

export interface PrivateMessageView {
  id: string;
  sender_id: string;
  recipient_id: string;
  parent_message_id: string | null;
  body: string;
  status: "sent" | "read" | "replied";
  price_paid: number;
  created_at: string;
  read_at: string | null;
  replied_at: string | null;
  sender_name: string | null;
  sender_username: string | null;
  sender_avatar: string | null;
  recipient_name: string | null;
  recipient_username: string | null;
  recipient_avatar: string | null;
  attachments: MessageAttachmentView[];
  reply: PrivateMessageView | null; // populated on originals when a reply exists
}

type UserBrief = { id: string; name: string | null; username: string | null; avatar: string | null };

async function loadUserBriefs(userIds: string[]): Promise<Map<string, UserBrief>> {
  const map = new Map<string, UserBrief>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      display_name: profiles.display_name,
      full_name: users.full_name,
      avatar_url: profiles.avatar_url,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(inArray(users.id, userIds));
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      name: r.display_name || r.full_name || null,
      username: r.username,
      avatar: r.avatar_url ?? null,
    });
  }
  return map;
}

function buildAttachmentViews(
  rows: AttachmentRow[],
  viewerId: string,
  mediaById: Map<string, typeof media.$inferSelect>,
): MessageAttachmentView[] {
  return rows.map((a) => {
    const m = mediaById.get(a.media_id);
    const needsPurchase = a.price > 0;
    const purchasedByMe = a.purchased_by === viewerId;
    // Locked paid attachments never leak their URL — the client renders the
    // lock card from metadata alone.
    const isLocked = needsPurchase && !purchasedByMe;
    return {
      id: a.id,
      media_id: a.media_id,
      media_type: a.media_type,
      media_url: isLocked ? null : (m?.url ?? null),
      thumbnail_url: isLocked ? null : (m?.thumbnail_url ?? null),
      price: a.price,
      is_locked: isLocked,
      purchased_by_me: purchasedByMe,
    };
  });
}

async function buildViews(
  messages: MessageRow[],
  viewerId: string,
): Promise<PrivateMessageView[]> {
  if (messages.length === 0) return [];

  const userIds = new Set<string>();
  for (const m of messages) {
    userIds.add(m.sender_id);
    userIds.add(m.recipient_id);
  }

  // Attachments + reply attachments in ONE extra query per set (no N+1).
  const ids = messages.map((m) => m.id);
  const allAttachments = await db
    .select()
    .from(private_message_attachments)
    .where(inArray(private_message_attachments.message_id, ids));

  // Replies to any of these originals (threading is one level deep).
  const replies =
    messages.some((m) => m.parent_message_id === null) && messages.length > 0
      ? await db
          .select()
          .from(private_messages)
          .where(inArray(private_messages.parent_message_id, ids))
      : [];

  const replyIds = replies.map((r) => r.id);
  const replyAttachments =
    replyIds.length > 0
      ? await db
          .select()
          .from(private_message_attachments)
          .where(inArray(private_message_attachments.message_id, replyIds))
      : [];

  const mediaIds = [...allAttachments, ...replyAttachments].map((a) => a.media_id);
  const mediaRows =
    mediaIds.length > 0
      ? await db.select().from(media).where(inArray(media.id, mediaIds))
      : [];
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));

  const briefs = await loadUserBriefs([...userIds]);
  const briefOf = (id: string) => briefs.get(id) ?? null;

  const attachmentsByMessage = new Map<string, AttachmentRow[]>();
  for (const a of allAttachments) {
    const list = attachmentsByMessage.get(a.message_id) ?? [];
    list.push(a);
    attachmentsByMessage.set(a.message_id, list);
  }
  const replyAttachmentsByMessage = new Map<string, AttachmentRow[]>();
  for (const a of replyAttachments) {
    const list = replyAttachmentsByMessage.get(a.message_id) ?? [];
    list.push(a);
    replyAttachmentsByMessage.set(a.message_id, list);
  }

  const viewOf = (m: MessageRow): PrivateMessageView => ({
    id: m.id,
    sender_id: m.sender_id,
    recipient_id: m.recipient_id,
    parent_message_id: m.parent_message_id,
    body: m.body,
    status: m.status,
    price_paid: m.price_paid,
    created_at: m.created_at,
    read_at: m.read_at,
    replied_at: m.replied_at,
    sender_name: briefOf(m.sender_id)?.name ?? null,
    sender_username: briefOf(m.sender_id)?.username ?? null,
    sender_avatar: briefOf(m.sender_id)?.avatar ?? null,
    recipient_name: briefOf(m.recipient_id)?.name ?? null,
    recipient_username: briefOf(m.recipient_id)?.username ?? null,
    recipient_avatar: briefOf(m.recipient_id)?.avatar ?? null,
    attachments: buildAttachmentViews(
      attachmentsByMessage.get(m.id) ?? [],
      viewerId,
      mediaById,
    ),
    reply: null,
  });

  const replyViews = new Map<string, PrivateMessageView>();
  for (const r of replies) {
    const v = viewOf(r);
    replyViews.set(r.parent_message_id!, v);
  }

  const views = messages.map((m) => {
    const v = viewOf(m);
    if (m.parent_message_id === null) {
      const reply = replyViews.get(m.id);
      if (reply) {
        v.reply = reply;
        v.status = "replied";
      }
    }
    return v;
  });
  return views;
}

// ─── Creator inbox settings ──────────────────────────────────────────────────

export async function getInboxSettings(creatorId: string): Promise<{
  enabled: boolean;
  price: number;
  whoCanMessage: "everyone" | "subscribers" | "none";
}> {
  const [creator] = await db
    .select({ is_creator: users.is_creator, role: users.role })
    .from(users)
    .where(eq(users.id, creatorId))
    .limit(1);
  const [settings] = await db
    .select({
      private_inbox_enabled: creator_settings.private_inbox_enabled,
      private_message_price: creator_settings.private_message_price,
      who_can_message: creator_settings.who_can_message,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, creatorId))
    .limit(1);

  return {
    // Non-creators have no monetizable inbox at all.
    enabled: Boolean(creator?.is_creator) && creator?.role === "creator" && (settings?.private_inbox_enabled ?? true),
    price: settings?.private_message_price ?? 100,
    whoCanMessage: settings?.who_can_message ?? "everyone",
  };
}

async function assertCanSendTo(senderId: string, creatorId: string, price: number): Promise<void> {
  const settings = await getInboxSettings(creatorId);
  if (!settings.enabled) {
    throw new PrivateInboxError("This creator's private inbox is closed", "INBOX_CLOSED");
  }
  const [blocked] = await db
    .select({ id: blocked_users.id })
    .from(blocked_users)
    .where(and(eq(blocked_users.blocker_id, creatorId), eq(blocked_users.blocked_id, senderId)))
    .limit(1);
  if (blocked) {
    throw new PrivateInboxError("You cannot message this creator", "BLOCKED");
  }
  if (settings.whoCanMessage === "none") {
    throw new PrivateInboxError("This creator is not accepting private messages", "INBOX_CLOSED");
  }
  // CRITICAL PRODUCT RULE — subscriber-only access. Sending a private message
  // ALWAYS requires an active subscription to the recipient creator. This is
  // enforced for every inbox (the legacy "everyone" mode is treated as
  // subscriber-only too), so a non-subscriber is rejected server-side no
  // matter what the client displays. Expired/cancelled subscriptions fail
  // here because they no longer match status = "active".
  const [subscription] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(
      eq(subscriptions.subscriber_id, senderId),
      eq(subscriptions.creator_id, creatorId),
      eq(subscriptions.status, "active"),
    ))
    .limit(1);
  if (!subscription) {
    throw new PrivateInboxError("You must be subscribed to message this creator", "SUBSCRIPTION_REQUIRED");
  }
  void price;
}

// ─── Send ────────────────────────────────────────────────────────────────────

export interface SendMessageInput {
  senderId: string;
  recipientId: string;
  body: string;
  idempotencyKey: string;
  /** Media ids produced by the standard upload pipeline (optional). */
  attachmentMediaIds?: Array<{ mediaId: string; mediaType: "image" | "video" | "file" }>;
}

/**
 * Pay once → persist one message. Idempotent on (senderId, idempotencyKey):
 * a retry returns the already-created message WITHOUT debiting again.
 */
export async function sendPrivateMessage(input: SendMessageInput): Promise<{
  message: PrivateMessageView;
  balance: number;
  alreadyExisted: boolean;
}> {
  const { senderId, recipientId, body, idempotencyKey } = input;

  if (!idempotencyKey) {
    throw new PrivateInboxError("idempotency_key is required", "IDEMPOTENCY_KEY_REQUIRED");
  }

  // Idempotent replay first — before touching money.
  const [existing] = await db
    .select()
    .from(private_messages)
    .where(
      and(
        eq(private_messages.sender_id, senderId),
        eq(private_messages.idempotency_key, idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    const [view] = await buildViews([existing], senderId);
    const balance = await getBalance(senderId);
    return { message: view, balance, alreadyExisted: true };
  }

  if (senderId === recipientId) {
    throw new PrivateInboxError("You cannot message yourself", "SELF_MESSAGE");
  }

  const [recipient] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, recipientId))
    .limit(1);
  if (!recipient) throw new PrivateInboxError("Creator not found", "NOT_FOUND");

  await assertCanSendTo(senderId, recipientId, 0);

  const attachments = input.attachmentMediaIds ?? [];
  if (attachments.length > 10) {
    throw new PrivateInboxError("Too many attachments", "INVALID_ATTACHMENT");
  }
  if (attachments.length > 0) {
    const rows = await db.select({ id: media.id, uploader_id: media.uploader_id, type: media.type })
      .from(media)
      .where(inArray(media.id, attachments.map((a) => a.mediaId)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const attachment of attachments) {
      const row = byId.get(attachment.mediaId);
      const expectedType = attachment.mediaType === "file" ? "document" : attachment.mediaType;
      if (!row || row.uploader_id !== senderId || row.type !== expectedType) {
        throw new PrivateInboxError("Attachment is invalid or not owned by you", "INVALID_ATTACHMENT");
      }
    }
  }

  // Server-authoritative pricing — never trust the client's number.
  const { price } = await getInboxSettings(recipientId);

  const now = new Date().toISOString();
  let messageId = "";

  try {
    await db.transaction(async (tx) => {
      messageId = generateId();

      if (price > 0) {
        // Atomic debit: fails when the balance has dropped below the price.
        const [debited] = await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} - ${price}`, updated_at: now })
          .where(
            and(eq(wallets.user_id, senderId), gt(wallets.balance, price - 1e-9)),
          )
          .returning({ id: wallets.id });
        if (!debited) throw new Error("INSUFFICIENT_BALANCE");

        await tx.insert(transactions).values({
          id: generateId(),
          user_id: senderId,
          type: "private_message",
          amount: -price,
          status: "success",
          reference: `pm_${messageId}`,
          description: "Private message to a creator",
          metadata: JSON.stringify({ private_message_id: messageId, recipient_id: recipientId }),
        });

        await recordCreatorEarning(tx, {
          creatorId: recipientId,
          buyerId: senderId,
          sourceType: "private_message",
          sourceId: messageId,
          grossAmount: price,
          description: "Paid private message received",
          metadata: { private_message_id: messageId, sender_id: senderId },
        });
      }

      await tx.insert(private_messages).values({
        id: messageId,
        sender_id: senderId,
        recipient_id: recipientId,
        parent_message_id: null,
        body,
        price_paid: price,
        status: "sent",
        idempotency_key: idempotencyKey,
      });

      if (attachments.length) {
        await tx.insert(private_message_attachments).values(
          attachments.map((a) => ({
            id: generateId(),
            message_id: messageId,
            media_id: a.mediaId,
            media_type: a.mediaType,
            price: 0,
          })),
        );
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      throw new PrivateInboxError("Insufficient wallet balance", "INSUFFICIENT_BALANCE");
    }
    // Unique-index race: another request with the same key won — treat as replay.
    if (
      error instanceof Error &&
      /UNIQUE|idempotency/i.test(`${(error as { code?: string }).code ?? ""} ${error.message}`)
    ) {
      const [row] = await db
        .select()
        .from(private_messages)
        .where(
          and(
            eq(private_messages.sender_id, senderId),
            eq(private_messages.idempotency_key, idempotencyKey),
          ),
        )
        .limit(1);
      if (row) {
        const [view] = await buildViews([row], senderId);
        const balance = await getBalance(senderId);
        return { message: view, balance, alreadyExisted: true };
      }
    }
    throw error;
  }

  const [created] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  const [view] = await buildViews([created!], senderId);

  // ── Post-commit side effects ──────────────────────────────────────────────
  // Realtime: creator's inbox updates immediately.
  emitEvent({
    type: "private_message.created",
    channel: userChannel(recipientId),
    userId: recipientId,
    resourceId: messageId,
    payload: { box: "inbox", message: view },
  });
  // Sender's own outbox reflects the confirmed state on other devices too.
  emitEvent({
    type: "wallet.updated",
    channel: userChannel(senderId),
    userId: senderId,
    resourceId: messageId,
    payload: { reason: "private_message_sent", amount: -price },
  });

  // In-app notification + push (backgrounded recipients), preference-gated.
  await createNotification(recipientId, "notif_messages", {
    actor_id: senderId,
    type: "private_message",
    entity_type: "private_message",
    entity_id: messageId,
    body: "sent you a private message",
  });
  getActorUsername(senderId).then((username) => {
    sendPushToUser(
      recipientId,
      {
        title: "New Private Message",
        body: `${username} sent you a private message`,
        data: { type: "private_message", private_message_id: messageId },
      },
      "notif_messages",
    );
  });

  const balance = await getBalance(senderId);
  return { message: view, balance, alreadyExisted: false };
}

// ─── Reply ───────────────────────────────────────────────────────────────────

export interface ReplyInput {
  creatorId: string;
  messageId: string;
  body: string;
  attachments?: Array<{ mediaId: string; mediaType: "image" | "video" | "file"; price?: number }>;
}

/** The creator replies ONCE to a message they received. Free to send. */
export async function replyToMessage(input: ReplyInput): Promise<{ message: PrivateMessageView }> {
  const { creatorId, messageId, body } = input;

  const [original] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  if (!original) throw new PrivateInboxError("Message not found", "NOT_FOUND");

  // Only the intended recipient-creator may reply, and only to the original.
  if (original.recipient_id !== creatorId) {
    throw new PrivateInboxError("You can only reply to your own inbox", "FORBIDDEN");
  }
  const [creator] = await db.select({ is_creator: users.is_creator, role: users.role }).from(users).where(eq(users.id, creatorId)).limit(1);
  if (!creator?.is_creator || creator.role !== "creator") {
    throw new PrivateInboxError("Only creators can reply", "FORBIDDEN");
  }
  const replyAttachments = input.attachments ?? [];
  if (replyAttachments.length > 10) {
    throw new PrivateInboxError("Too many attachments", "INVALID_ATTACHMENT");
  }
  if (replyAttachments.length > 0) {
    const rows = await db.select({ id: media.id, uploader_id: media.uploader_id, type: media.type })
      .from(media)
      .where(inArray(media.id, replyAttachments.map((a) => a.mediaId)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const attachment of replyAttachments) {
      const row = byId.get(attachment.mediaId);
      const expectedType = attachment.mediaType === "file" ? "document" : attachment.mediaType;
      if (!row || row.uploader_id !== creatorId || row.type !== expectedType) {
        throw new PrivateInboxError("Attachment is invalid or not owned by you", "INVALID_ATTACHMENT");
      }
      if (attachment.price != null && (!Number.isFinite(attachment.price) || attachment.price < 0 || attachment.price > 1_000_000)) {
        throw new PrivateInboxError("Attachment price is invalid", "INVALID_PRICE");
      }
    }
  }
  if (original.parent_message_id) {
    throw new PrivateInboxError("A reply already exists for this message", "REPLY_EXISTS");
  }

  const [existingReply] = await db
    .select({ id: private_messages.id })
    .from(private_messages)
    .where(eq(private_messages.parent_message_id, messageId))
    .limit(1);
  if (existingReply) {
    throw new PrivateInboxError("You already replied to this message", "REPLY_EXISTS");
  }

  const now = new Date().toISOString();
  const replyId = generateId();

  await db.transaction(async (tx) => {
    await tx.insert(private_messages).values({
      id: replyId,
      sender_id: creatorId,
      recipient_id: original.sender_id,
      parent_message_id: messageId,
      body,
      price_paid: 0,
      status: "sent",
      idempotency_key: `reply_${messageId}`,
    });

    for (const a of replyAttachments) {
      await tx.insert(private_message_attachments).values({
        id: generateId(),
        message_id: replyId,
        media_id: a.mediaId,
        media_type: a.mediaType,
        price: Math.max(0, Number(a.price) || 0),
      });
    }

    await tx
      .update(private_messages)
      .set({ status: "replied", replied_at: now, updated_at: now })
      .where(eq(private_messages.id, messageId));
  });

  const [replyRow] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, replyId))
    .limit(1);
  const [updatedOriginal] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);

  const senderId = original.sender_id;

  // Realtime — both sides update without polling.
  emitEvent({
    type: "private_message.reply_created",
    channel: userChannel(senderId),
    userId: senderId,
    resourceId: replyId,
    payload: { original_id: messageId, reply: replyRow ? (await buildViews([replyRow], senderId))[0] : null },
  });
  emitEvent({
    type: "private_message.updated",
    channel: userChannel(senderId),
    userId: senderId,
    resourceId: messageId,
    payload: { box: "outbox", status: "replied", replied_at: now, message: updatedOriginal ? (await buildViews([updatedOriginal], senderId))[0] : null },
  });

  await createNotification(senderId, "notif_messages", {
    actor_id: creatorId,
    type: "private_message_reply",
    entity_type: "private_message",
    entity_id: messageId,
    body: "replied to your private message",
  });
  getActorUsername(creatorId).then((username) => {
    sendPushToUser(
      senderId,
      {
        title: "Private Message Reply",
        body: `${username} replied to your message`,
        data: { type: "private_message", private_message_id: messageId },
      },
      "notif_messages",
    );
  });

  return { message: (await buildViews([replyRow!], creatorId))[0] };
}

// ─── Read state ──────────────────────────────────────────────────────────────

/** Recipient opened the message. Simple unread/read — no delivery ticks. */
export async function markRead(userId: string, messageId: string): Promise<void> {
  const [msg] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  if (!msg) throw new PrivateInboxError("Message not found", "NOT_FOUND");
  if (msg.recipient_id !== userId) return; // not theirs — silently ignore read
  if (msg.read_at) return; // already read

  const now = new Date().toISOString();
  await db
    .update(private_messages)
    .set({ status: msg.status === "replied" ? "replied" : "read", read_at: now, updated_at: now })
    .where(eq(private_messages.id, messageId));

  // Let the SENDER know the correspondence was opened.
  emitEvent({
    type: "private_message.read",
    channel: userChannel(msg.sender_id),
    userId: msg.sender_id,
    resourceId: messageId,
    payload: { message_id: messageId, read_at: now },
  });
}

// ─── Attachment purchase ─────────────────────────────────────────────────────

/**
 * Buy a priced reply attachment. Only the original sender may purchase, and
 * the purchase state lives on the attachment row so a retry can never charge
 * twice.
 */
export async function purchaseAttachment(
  userId: string,
  attachmentId: string,
): Promise<{ attachment: MessageAttachmentView; balance: number }> {
  const [attachment] = await db
    .select()
    .from(private_message_attachments)
    .where(eq(private_message_attachments.id, attachmentId))
    .limit(1);
  if (!attachment) throw new PrivateInboxError("Attachment not found", "NOT_FOUND");

  const [message] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, attachment.message_id))
    .limit(1);
  if (!message) throw new PrivateInboxError("Message not found", "NOT_FOUND");

  const creatorId = message.sender_id; // replies come FROM the creator
  if (message.recipient_id !== userId) {
    throw new PrivateInboxError("Only the original sender can purchase this", "FORBIDDEN");
  }
  if (attachment.price <= 0) {
    // Free attachment — nothing to buy.
    const viewList = await buildAttachmentViewsFor([attachment], userId);
    return { attachment: viewList[0], balance: await getBalance(userId) };
  }
  if (attachment.purchased_by === userId) {
    // Idempotent replay — already unlocked, never charge again.
    const viewList = await buildAttachmentViewsFor([attachment], userId);
    return { attachment: viewList[0], balance: await getBalance(userId) };
  }

  const price = attachment.price;
  const now = new Date().toISOString();

  try {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(private_message_attachments)
        .set({ purchased_by: userId, purchased_at: now })
        .where(and(eq(private_message_attachments.id, attachmentId), sql`${private_message_attachments.purchased_by} IS NULL`))
        .returning({ id: private_message_attachments.id });
      if (!claimed) throw new Error("ALREADY_PURCHASED");

      const [debited] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${price}`, updated_at: now })
        .where(and(eq(wallets.user_id, userId), gt(wallets.balance, price - 1e-9)))
        .returning({ id: wallets.id });
      if (!debited) throw new Error("INSUFFICIENT_BALANCE");

      const transactionId = generateId();
      await tx.insert(transactions).values({
        id: transactionId,
        user_id: userId,
        type: "private_message_attachment",
        amount: -price,
        status: "success",
        reference: `pma_${attachmentId}`,
        description: "Unlocked a creator's reply attachment",
        metadata: JSON.stringify({ attachment_id: attachmentId, message_id: message.id }),
      });

      await recordCreatorEarning(tx, {
        creatorId,
        buyerId: userId,
        sourceType: "private_message_attachment",
        sourceId: attachmentId,
        grossAmount: price,
        description: "Reply attachment purchased",
        metadata: { attachment_id: attachmentId, message_id: message.id },
      });      await tx.update(private_message_attachments)
        .set({ purchase_transaction_id: transactionId })
        .where(eq(private_message_attachments.id, attachmentId));
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      throw new PrivateInboxError("Insufficient wallet balance", "INSUFFICIENT_BALANCE");
    }
    if (error instanceof Error && error.message === "ALREADY_PURCHASED") {
      // Re-read; caller gets the unlocked state without a second debit.
      const [fresh] = await db
        .select()
        .from(private_message_attachments)
        .where(eq(private_message_attachments.id, attachmentId))
        .limit(1);
      const viewList = await buildAttachmentViewsFor([fresh!], userId);
      return { attachment: viewList[0], balance: await getBalance(userId) };
    }
    throw error;
  }

  const [fresh] = await db
    .select()
    .from(private_message_attachments)
    .where(eq(private_message_attachments.id, attachmentId))
    .limit(1);      const viewList = await buildAttachmentViewsFor([fresh!], userId);

  emitEvent({
    type: "private_message.attachment_purchased",
    channel: userChannel(creatorId),
    userId: creatorId,
    resourceId: attachmentId,
    payload: { attachment_id: attachmentId, message_id: message.id, buyer_id: userId },
  });

  await createNotification(creatorId, "notif_creator_updates", {
    actor_id: userId,
    type: "payment",
    entity_type: "private_message",
    entity_id: message.id,
    body: "purchased your reply attachment",
  });

  return { attachment: viewList[0], balance: await getBalance(userId) };
}

/** Small helper: attachment views with media URLs resolved in one query. */
async function buildAttachmentViewsFor(rows: AttachmentRow[], viewerId: string): Promise<MessageAttachmentView[]> {
  if (rows.length === 0) return [];
  const mediaRows = await db
    .select()
    .from(media)
    .where(inArray(media.id, rows.map((r) => r.media_id)));
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));
  return buildAttachmentViews(rows, viewerId, mediaById);
}

// ─── Lists ───────────────────────────────────────────────────────────────────

const LIST_LIMIT = 50;

/**
 * Inbox (received) or Outbox (sent) ORIGINALS with their replies attached.
 * A fixed number of indexed queries total — never N+1 per row.
 */
export async function listMessages(
  userId: string,
  box: "inbox" | "outbox",
  before?: string,
): Promise<PrivateMessageView[]> {
  const column = box === "inbox" ? private_messages.recipient_id : private_messages.sender_id;

  const rows = await db
    .select()
    .from(private_messages)
    .where(
      and(
        eq(column, userId),
        sql`${private_messages.parent_message_id} IS NULL`,
        before ? lt(private_messages.created_at, before) : undefined,
      ),
    )
    .orderBy(desc(private_messages.created_at))
    .limit(LIST_LIMIT);

  return buildViews(rows, userId);
}

/** Full thread for one participant. */
export async function getMessageThread(
  userId: string,
  messageId: string,
): Promise<PrivateMessageView | null> {
  const [msg] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  if (!msg) return null;
  if (msg.sender_id !== userId && msg.recipient_id !== userId) return null; // IDOR guard
  const [view] = await buildViews([msg], userId);
  return view;
}

async function getBalance(userId: string): Promise<number> {
  const [w] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, userId))
    .limit(1);
  return w?.balance ?? 0;
}
