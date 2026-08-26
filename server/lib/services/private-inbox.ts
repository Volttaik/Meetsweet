/**
 * Private Inbox — email-style paid correspondence between users and creators.
 *
 * Product model (deliberately simple):
 *   Creator enables their Private Inbox and sets a price.
 *   A user pays that price ONCE to deliver one message to the creator.
 *   The creator may reply — text plus optional media, optionally priced.
 *   A creator may also initiate a message to one of their OWN subscribers:
 *   delivery is free, and the creator can price image/video attachments that
 *   stay locked until the subscriber pays to unlock them.
 *   The fan (non-creator participant) can buy a priced attachment to unlock it.
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
  dm_restrictions,
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
  notifyPrivateMessage,
  notifyPrivateMessageReply,
  notifyPurchase,
} from "@/lib/services/notifications";

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
  status: "sent" | "read" | "replied" | "waiting";
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
  /** The thread's creator participant — only they may price attachments. */
  thread_creator_id: string | null;
  attachments: MessageAttachmentView[];
  /** Number of replies below this message (0 on leaves). */
  reply_count: number;
  /** Latest descendant view — populated on list rows (original → preview). */
  reply: PrivateMessageView | null;
  /** Full thread oldest → newest — populated only by getMessageThread. */
  thread?: PrivateMessageView[];
}

type UserBrief = {
  id: string;
  name: string | null;
  username: string | null;
  avatar: string | null;
  is_creator: boolean | null;
  role: string | null;
};

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
      is_creator: users.is_creator,
      role: users.role,
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
      is_creator: r.is_creator,
      role: r.role,
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

/**
 * Load a thread's full row set: the originals plus every descendant reply
 * (replies to replies included), bounded to a sane depth. Indexed query per
 * level on parent_message_id — a thread is a small flat chain, so this is
 * a handful of lookups at most, never N+1 per row.
 */
async function loadThreadRows(
  originals: MessageRow[],
): Promise<{ rows: MessageRow[]; byId: Map<string, MessageRow> }> {
  const rows = [...originals];
  const byId = new Map(rows.map((r) => [r.id, r]));
  let frontier = originals.map((m) => m.id);
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const children = await db
      .select()
      .from(private_messages)
      .where(inArray(private_messages.parent_message_id, frontier));
    const fresh = children.filter((c) => !byId.has(c.id));
    for (const c of fresh) {
      byId.set(c.id, c);
      rows.push(c);
    }
    frontier = fresh.map((c) => c.id);
  }
  return { rows, byId };
}

/** Walk a parent chain up to the thread root (bounded). */
async function rootOf(message: MessageRow): Promise<MessageRow> {
  let cur = message;
  for (let depth = 0; depth < 12 && cur.parent_message_id; depth++) {
    const [parent] = await db
      .select()
      .from(private_messages)
      .where(eq(private_messages.id, cur.parent_message_id))
      .limit(1);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/**
 * Build views for a set of messages that are all part of the same threads.
 * `originals` must be the thread roots; the full descendant set is loaded and
 * attached, so list rows carry reply_count + latest reply preview while the
 * detail path can read the ordered thread off the root view.
 */
async function buildViews(
  originals: MessageRow[],
  viewerId: string,
  opts?: { withThread?: boolean },
): Promise<PrivateMessageView[]> {
  if (originals.length === 0) return [];

  const { rows, byId } = await loadThreadRows(originals);
  const rootIds = new Set(originals.map((m) => m.id));
  const userIds = new Set<string>();
  for (const m of rows) {
    userIds.add(m.sender_id);
    userIds.add(m.recipient_id);
  }

  // Attachments for every message in the threads — one query per set.
  const ids = rows.map((m) => m.id);
  const allAttachments = await db
    .select()
    .from(private_message_attachments)
    .where(inArray(private_message_attachments.message_id, ids));

  const mediaIds = allAttachments.map((a) => a.media_id);
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
    // Populated below per thread root — the participant holding creator role.
    thread_creator_id: null,
    attachments: buildAttachmentViews(
      attachmentsByMessage.get(m.id) ?? [],
      viewerId,
      mediaById,
    ),
    reply_count: 0,
    reply: null,
  });

  // Children map + root resolution for grouping descendants.
  const childrenOf = new Map<string, MessageRow[]>();
  const rootOfRow = (m: MessageRow): MessageRow => {
    let cur = m;
    while (cur.parent_message_id) {
      const parent = byId.get(cur.parent_message_id);
      if (!parent) break;
      cur = parent;
    }
    return cur;
  };
  for (const r of rows) {
    if (!r.parent_message_id) continue;
    const list = childrenOf.get(r.parent_message_id) ?? [];
    list.push(r);
    childrenOf.set(r.parent_message_id, list);
  }

  const collectDescendants = (rootId: string): MessageRow[] => {
    const out: MessageRow[] = [];
    const stack = [...(childrenOf.get(rootId) ?? [])];
    while (stack.length) {
      const m = stack.pop()!;
      out.push(m);
      stack.push(...(childrenOf.get(m.id) ?? []));
    }
    return out;
  };

  const viewById = new Map<string, PrivateMessageView>();
  for (const r of rows) viewById.set(r.id, viewOf(r));

  // The thread's creator participant — whichever side holds creator role (in a
  // fan-initiated thread the recipient, in a creator-initiated thread the
  // sender). Every message in the thread shares the same anchor; only this
  // participant may price attachments.
  const isCreatorUser = (u?: UserBrief | null) => Boolean(u?.is_creator) && u?.role === "creator";
  for (const r of rows) {
    const rootRow = rootOfRow(r);
    const brief = (id: string) => briefOf(id);
    let creatorId: string | null = null;
    if (isCreatorUser(brief(rootRow.sender_id))) creatorId = rootRow.sender_id;
    else if (isCreatorUser(brief(rootRow.recipient_id))) creatorId = rootRow.recipient_id;
    const v = viewById.get(r.id);
    if (v) v.thread_creator_id = creatorId;
  }

  // A row is visible to the viewer unless THEY deleted their own copy of it
  // (sender-delete hides it for both; receiver-delete hides it for the
  // receiver only, so the sender still sees their own sent copy).
  const isVisible = (m: MessageRow): boolean =>
    (m.sender_id === viewerId && !m.deleted_for_sender_at) ||
    (m.recipient_id === viewerId && !m.deleted_for_recipient_at);

  const views: PrivateMessageView[] = [];
  for (const root of originals) {
    const rootView = viewById.get(root.id)!;
    const descendants = collectDescendants(root.id).filter(isVisible);
    if (descendants.length > 0) {
      // Newest descendant is the thread's latest reply preview.
      const latest = [...descendants].sort((a, b) =>
        a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1,
      )[descendants.length - 1];
      rootView.reply_count = descendants.length;
      rootView.reply = viewById.get(latest.id) ?? null;
      rootView.status = "replied";
    }
    if (opts?.withThread) {
      const ordered = [root, ...descendants].sort((a, b) =>
        a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1,
      );
      // Build the thread as INDEPENDENT flat DTO snapshots — never the shared
      // view objects. `viewById.get(root.id)` IS the root view returned as the
      // top-level `message`, so embedding it directly would put the message
      // inside its own `thread` array (index 0 closes the circle) and crash
      // JSON serialization with "Converting circular structure to JSON".
      // Each element references its parent only by id (`parent_message_id`).
      rootView.thread = ordered.map((m) => toFlatMessageView(viewById.get(m.id)!));
    }
    // Sanity: a descendant whose root is not in `originals` must not leak.
    if (rootOfRow(root).id === root.id) views.push(rootView);
  }
  return views;
}

/**
 * Produce an acyclic, JSON-safe snapshot of a message view.
 *
 * Returns a BRAND-NEW plain object containing only primitive fields + flat
 * attachment copies. It never embeds a `thread` array, and it references a
 * parent message only by `parent_message_id` — never by containing the parent
 * object. This is the ONLY shape we hand to JSON serialization for the thread
 * endpoint, so no shared/mutable reference can ever close a cycle.
 */
export function toFlatMessageView(v: PrivateMessageView): PrivateMessageView {
  return {
    id: v.id,
    sender_id: v.sender_id,
    recipient_id: v.recipient_id,
    parent_message_id: v.parent_message_id,
    body: v.body,
    status: v.status,
    price_paid: v.price_paid,
    created_at: v.created_at,
    read_at: v.read_at,
    replied_at: v.replied_at,
    sender_name: v.sender_name,
    sender_username: v.sender_username,
    sender_avatar: v.sender_avatar,
    recipient_name: v.recipient_name,
    recipient_username: v.recipient_username,
    recipient_avatar: v.recipient_avatar,
    thread_creator_id: v.thread_creator_id,
    attachments: v.attachments.map((a) => ({ ...a })),
    reply_count: v.reply_count,
    reply: null,
  };
}

/**
 * The thread ROOT view, ready for the wire: the root's own fields are flat and
 * its `thread` is an array of INDEPENDENT acyclic snapshots (original + every
 * reply, oldest first). The returned object shares no references with the
 * elements of `thread`, so serializing it cannot produce a circular structure.
 */
export function toThreadMessageView(root: PrivateMessageView): PrivateMessageView {
  const snapshot = toFlatMessageView(root);
  snapshot.thread = (root.thread ?? [root]).map(toFlatMessageView);
  return snapshot;
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
    // 0 = FREE by default. The creator opts into PAID messaging by setting a
    // positive price in the Creator Dashboard. Sending only ever debits the
    // wallet when price > 0 (see sendPrivateMessage).
    price: settings?.private_message_price ?? 0,
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
  /**
   * Media ids produced by the standard upload pipeline (optional). A positive
   * `price` is honoured ONLY for a creator sending to one of their own
   * subscribers; every other sender's attachments are forced free server-side.
   */
  attachmentMediaIds?: Array<{
    mediaId: string;
    mediaType: "image" | "video" | "file";
    price?: number;
  }>;
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

  const [sender] = await db
    .select({ is_creator: users.is_creator, role: users.role })
    .from(users)
    .where(eq(users.id, senderId))
    .limit(1);
  const [recipient] = await db
    .select({ id: users.id, is_creator: users.is_creator, role: users.role })
    .from(users)
    .where(eq(users.id, recipientId))
    .limit(1);
  if (!recipient) throw new PrivateInboxError("Recipient not found", "NOT_FOUND");

  const isCreatorUser = (r?: { is_creator: boolean | null; role: string | null }) =>
    Boolean(r?.is_creator) && r?.role === "creator";
  const recipientIsCreator = isCreatorUser(recipient);
  const senderIsCreator = isCreatorUser(sender);

  // Mode selection — the product only supports correspondence between a
  // creator and their subscriber, in either direction:
  //  • fan → creator: the existing paid inbox (delivery price + subscription).
  //  • creator → subscriber: free delivery; the creator may price attachments.
  // Anything else (two fans, two creators with neither subscribed, etc.) is
  // rejected rather than silently allowed.
  let deliveryPrice = 0;
  let allowPricedAttachments = false;
  if (recipientIsCreator) {
    await assertCanSendTo(senderId, recipientId, 0);
    ({ price: deliveryPrice } = await getInboxSettings(recipientId));
    allowPricedAttachments = false; // fans never price media
  } else if (senderIsCreator) {
    // Creator → subscriber: the recipient must be an ACTIVE subscriber of
    // the sender. Expired/cancelled subscriptions fail here because they no
    // longer match status = "active".
    const [sub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(
        eq(subscriptions.subscriber_id, recipientId),
        eq(subscriptions.creator_id, senderId),
        eq(subscriptions.status, "active"),
      ))
      .limit(1);
    if (!sub) {
      throw new PrivateInboxError("You can only message your own subscribers", "SUBSCRIPTION_REQUIRED");
    }
    // The subscriber blocked this creator — respect it symmetrically.
    const [blocked] = await db
      .select({ id: blocked_users.id })
      .from(blocked_users)
      .where(and(eq(blocked_users.blocker_id, recipientId), eq(blocked_users.blocked_id, senderId)))
      .limit(1);
    if (blocked) {
      throw new PrivateInboxError("You cannot message this user", "BLOCKED");
    }
    deliveryPrice = 0; // free delivery — the creator monetizes via attachments
    allowPricedAttachments = true;
  } else {
    throw new PrivateInboxError(
      "Private messaging is available between creators and their subscribers only",
      "INBOX_CLOSED",
    );
  }

  // Recipient restricted this sender ("mute → waiting"): the message must
  // NOT reach the normal inbox — it queues for approval instead.
  const [restriction] = await db
    .select({ id: dm_restrictions.id })
    .from(dm_restrictions)
    .where(and(eq(dm_restrictions.user_id, recipientId), eq(dm_restrictions.restricted_id, senderId)))
    .limit(1);
  const waiting = Boolean(restriction);

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
      // Server-authoritative prices: only a creator sender may price media,
      // and only within the 0 – 1,000,000 bound. Never trust the client.
      const p = attachment.price ?? 0;
      if (!allowPricedAttachments) {
        if (p !== 0) {
          throw new PrivateInboxError("Only creators can price attachments", "INVALID_PRICE");
        }
      } else if (!Number.isFinite(p) || p < 0 || p > 1_000_000) {
        throw new PrivateInboxError("Attachment price is invalid", "INVALID_PRICE");
      }
    }
  }

  // Server-authoritative pricing — never trust the client's number.
  const price = deliveryPrice;

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
        status: waiting ? "waiting" : "sent",
        idempotency_key: idempotencyKey,
      });

      if (attachments.length) {
        await tx.insert(private_message_attachments).values(
          attachments.map((a) => ({
            id: generateId(),
            message_id: messageId,
            media_id: a.mediaId,
            media_type: a.mediaType,
            // Only creator→subscriber sends may carry a price (validated
            // above); everything else is forced free.
            price: allowPricedAttachments ? Math.max(0, Number(a.price) || 0) : 0,
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
  // Realtime: the recipient's box updates immediately (waiting queue when the
  // sender is restricted, normal inbox otherwise).
  emitEvent({
    type: "private_message.created",
    channel: userChannel(recipientId),
    userId: recipientId,
    resourceId: messageId,
    payload: { box: waiting ? "waiting" : "inbox", message: view },
  });
  // Sender's own outbox reflects the confirmed state on other devices too.
  emitEvent({
    type: "wallet.updated",
    channel: userChannel(senderId),
    userId: senderId,
    resourceId: messageId,
    payload: { reason: "private_message_sent", amount: -price },
  });

  // In-app notification + push (backgrounded recipients), preference-gated and
  // deduped by the service. Restricted senders land in the Waiting queue, so
  // the copy says so — the recipient must approve before the message is
  // visible in their inbox.
  void notifyPrivateMessage({
    actorId: senderId,
    recipientId,
    messageId,
    waiting,
  });

  const balance = await getBalance(senderId);
  return { message: view, balance, alreadyExisted: false };
}

// ─── Reply ───────────────────────────────────────────────────────────────────

export interface ReplyInput {
  /** The participant writing the reply. */
  userId: string;
  /** The message being replied to (its parent in the thread). */
  messageId: string;
  body: string;
  /** Optional — retries with the same key never duplicate the reply. */
  idempotencyKey?: string;
  attachments?: Array<{ mediaId: string; mediaType: "image" | "video" | "file"; price?: number }>;
}

/**
 * Either participant may reply to any message inside a thread (email-style
 * follow-ups). Replies are free; only the creator may price reply media.
 * The thread stays anchored to its paid original — replies never become
 * separate conversations.
 */
export async function replyToMessage(input: ReplyInput): Promise<{ message: PrivateMessageView }> {
  const { userId, messageId, body } = input;

  const [parent] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  if (!parent) throw new PrivateInboxError("Message not found", "NOT_FOUND");

  // Only the two participants of the thread may reply to it.
  if (parent.sender_id !== userId && parent.recipient_id !== userId) {
    throw new PrivateInboxError("You are not part of this correspondence", "FORBIDDEN");
  }

  // The thread's paid original anchors everything; the other participant is
  // the original's counterpart (participants never change within a thread).
  const root = await rootOf(parent);
  const otherId = root.sender_id === userId ? root.recipient_id : root.sender_id;

  // The thread's CREATOR participant — whichever side holds creator role. In a
  // fan-initiated thread that is the recipient; in a creator-initiated thread
  // (creator messaging their subscriber) it is the sender. Only the creator
  // may price reply media, in any thread they started or joined.
  const [senderRow] = await db
    .select({ is_creator: users.is_creator, role: users.role })
    .from(users)
    .where(eq(users.id, root.sender_id))
    .limit(1);
  const [recipientRow] = await db
    .select({ is_creator: users.is_creator, role: users.role })
    .from(users)
    .where(eq(users.id, root.recipient_id))
    .limit(1);
  const isCreatorUser = (r?: { is_creator: boolean | null; role: string | null }) =>
    Boolean(r?.is_creator) && r?.role === "creator";
  const threadCreatorId = isCreatorUser(senderRow)
    ? root.sender_id
    : isCreatorUser(recipientRow)
      ? root.recipient_id
      : null;
  const isCreator = threadCreatorId === userId;

  // Idempotent replay — retried submit returns the already-created reply.
  const key = input.idempotencyKey || `reply_${messageId}_${userId}`;
  const [existing] = await db
    .select()
    .from(private_messages)
    .where(
      and(eq(private_messages.sender_id, userId), eq(private_messages.idempotency_key, key)),
    )
    .limit(1);
  if (existing) {
    const [view] = await buildViews([existing], userId);
    return { message: view };
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
      if (!row || row.uploader_id !== userId || row.type !== expectedType) {
        throw new PrivateInboxError("Attachment is invalid or not owned by you", "INVALID_ATTACHMENT");
      }
      if (attachment.price != null && (!Number.isFinite(attachment.price) || attachment.price < 0 || attachment.price > 1_000_000)) {
        throw new PrivateInboxError("Attachment price is invalid", "INVALID_PRICE");
      }
    }
  }

  const now = new Date().toISOString();
  const replyId = generateId();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(private_messages).values({
        id: replyId,
        sender_id: userId,
        recipient_id: otherId,
        parent_message_id: messageId,
        body,
        price_paid: 0,
        status: "sent",
        idempotency_key: key,
      });

      for (const a of replyAttachments) {
        await tx.insert(private_message_attachments).values({
          id: generateId(),
          message_id: replyId,
          media_id: a.mediaId,
          media_type: a.mediaType,
          // Only the creator may price reply media; a fan's attachment is free.
          price: isCreator ? Math.max(0, Number(a.price) || 0) : 0,
        });
      }

      await tx
        .update(private_messages)
        .set({ status: "replied", replied_at: now, updated_at: now })
        .where(eq(private_messages.id, root.id));
    });
  } catch (error) {
    // Unique-index race: the same key won elsewhere — treat as replay.
    if (
      error instanceof Error &&
      /UNIQUE|idempotency/i.test(`${(error as { code?: string }).code ?? ""} ${error.message}`)
    ) {
      const [row] = await db
        .select()
        .from(private_messages)
        .where(
          and(eq(private_messages.sender_id, userId), eq(private_messages.idempotency_key, key)),
        )
        .limit(1);
      if (row) {
        const [view] = await buildViews([row], userId);
        return { message: view };
      }
    }
    throw error;
  }

  const [replyRow] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, replyId))
    .limit(1);
  const [rootRow] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, root.id))
    .limit(1);

  const replyView = (await buildViews([replyRow!], userId))[0];
  const rootView = (await buildViews([rootRow!], otherId))[0];

  // Realtime — the other participant's side updates without polling.
  emitEvent({
    type: "private_message.reply_created",
    channel: userChannel(otherId),
    userId: otherId,
    resourceId: replyId,
    payload: { original_id: root.id, parent_id: messageId, reply: replyView },
  });
  emitEvent({
    type: "private_message.updated",
    channel: userChannel(otherId),
    userId: otherId,
    resourceId: root.id,
    payload: { box: otherId === root.recipient_id ? "inbox" : "outbox", status: "replied", replied_at: now, message: rootView },
  });

  void notifyPrivateMessageReply({
    actorId: userId,
    recipientId: otherId,
    threadId: root.id,
    messageId: replyId,
  });

  return { message: replyView };
}

// ─── Read state ──────────────────────────────────────────────────────────────

/** Recipient opened the message. Simple unread/read — no delivery ticks. */
/** Recipient opened the thread — every unread message addressed to them in
 * the thread is marked read at once (email-style, no delivery ticks). */
export async function markRead(userId: string, messageId: string): Promise<void> {
  const [msg] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  if (!msg) throw new PrivateInboxError("Message not found", "NOT_FOUND");
  if (msg.recipient_id !== userId) return; // not theirs — silently ignore read

  const root = await rootOf(msg);
  const { rows } = await loadThreadRows([root]);
  const mine = rows.filter(
    (r) => r.recipient_id === userId && !r.read_at && r.status !== "waiting",
  );
  if (mine.length === 0) return; // already read

  const now = new Date().toISOString();
  for (const row of mine) {
    await db
      .update(private_messages)
      .set({ status: row.status === "replied" ? "replied" : "read", read_at: now, updated_at: now })
      .where(eq(private_messages.id, row.id));
    // Let the other participant know their correspondence was opened.
    emitEvent({
      type: "private_message.read",
      channel: userChannel(row.sender_id),
      userId: row.sender_id,
      resourceId: row.id,
      payload: { message_id: row.id, read_at: now },
    });
  }
}

// ─── Attachment purchase ─────────────────────────────────────────────────────

/**
 * Buy a priced attachment. The buyer is always the non-creator participant
 * (the message's recipient — the fan) in either thread direction: fan-initiated
 * threads price creator reply media, creator-initiated threads price media on
 * the creator's opening message or replies. The purchase state lives on the
 * attachment row so a retry can never charge twice, and the creator's earnings
 * are recorded in the same atomic transaction.
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

  const creatorId = message.sender_id; // priced media always comes FROM the creator
  if (message.recipient_id !== userId) {
    throw new PrivateInboxError("Only the recipient of this message can unlock it", "FORBIDDEN");
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

  // In-app row + push, gated by the creator's Creator Updates preference and
  // deduped so a retried purchase can never double-notify.
  void notifyPurchase({
    buyerId: userId,
    creatorId,
    sourceType: "private_message",
    sourceId: message.id,
    description: "purchased your reply attachment",
    pushTitle: "Attachment Purchase",
    pushVerb: "purchased your reply attachment",
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
 * Inbox (received), Outbox (sent) or Waiting (received, awaiting approval)
 * ORIGINALS with their reply previews attached. Deletion flags are honored
 * per participant: sender-deleted rows never appear for anyone, receiver-
 * deleted rows stay out of the receiver's inbox while the sender keeps them.
 * A fixed number of indexed queries total — never N+1 per row.
 */
export async function listMessages(
  userId: string,
  box: "inbox" | "outbox" | "waiting",
  before?: string,
): Promise<PrivateMessageView[]> {
  const isWaiting = box === "waiting";
  const column = box === "outbox" ? private_messages.sender_id : private_messages.recipient_id;

  const rows = await db
    .select()
    .from(private_messages)
    .where(
      and(
        eq(column, userId),
        sql`${private_messages.parent_message_id} IS NULL`,
        // Waiting messages show only in the Waiting box (recipient side) and
        // in the sender's Outbox as "awaiting approval" — never in inbox.
        box === "waiting"
          ? eq(private_messages.status, "waiting")
          : box === "outbox"
            ? undefined
            : sql`${private_messages.status} != 'waiting'`,
        box === "outbox"
          ? sql`${private_messages.deleted_for_sender_at} IS NULL`
          : sql`${private_messages.deleted_for_recipient_at} IS NULL`,
        before ? lt(private_messages.created_at, before) : undefined,
      ),
    )
    .orderBy(desc(private_messages.created_at))
    .limit(LIST_LIMIT);

  return buildViews(rows, userId);
}

/** Full thread for one participant (root + every reply, oldest first). */
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
  // Deleted-for-me — treat as gone even on a direct URL open.
  if (msg.sender_id === userId && msg.deleted_for_sender_at) return null;
  if (msg.recipient_id === userId && msg.deleted_for_recipient_at) return null;

  const root = await rootOf(msg);
  if (root.sender_id === userId && root.deleted_for_sender_at) return null;
  if (root.recipient_id === userId && root.deleted_for_recipient_at) return null;

  const [view] = await buildViews([root], userId, { withThread: true });
  if (!view) return null;
  // Return an intentionally acyclic DTO: the root's own fields plus a flat,
  // independent `thread` array (original + every reply). Never the raw shared
  // view objects, which can reference each other and crash JSON serialization
  // with a circular-structure error.
  return toThreadMessageView(view);
}

// ─── Waiting / restrictions ─────────────────────────────────────────────────

/**
 * Restrict a sender: their future private messages queue in the recipient's
 * Waiting section instead of the normal inbox. Idempotent. This is distinct
 * from blocking — a block REJECTS sends outright.
 */
export async function restrictSender(userId: string, restrictedId: string): Promise<void> {
  if (userId === restrictedId) {
    throw new PrivateInboxError("You cannot restrict yourself", "FORBIDDEN");
  }
  const [existing] = await db
    .select({ id: dm_restrictions.id })
    .from(dm_restrictions)
    .where(and(eq(dm_restrictions.user_id, userId), eq(dm_restrictions.restricted_id, restrictedId)))
    .limit(1);
  if (existing) return; // already restricted
  await db.insert(dm_restrictions).values({
    id: generateId(),
    user_id: userId,
    restricted_id: restrictedId,
  });
}

/**
 * Allow a sender again: the restriction is lifted AND every message still
 * waiting from them is approved into the normal inbox. Returns how many
 * messages were approved.
 */
export async function allowSender(
  userId: string,
  restrictedId: string,
): Promise<{ approved: number }> {
  await db
    .delete(dm_restrictions)
    .where(and(eq(dm_restrictions.user_id, userId), eq(dm_restrictions.restricted_id, restrictedId)));

  const waiting = await db
    .select()
    .from(private_messages)
    .where(
      and(
        eq(private_messages.recipient_id, userId),
        eq(private_messages.sender_id, restrictedId),
        eq(private_messages.status, "waiting"),
      ),
    );
  if (waiting.length > 0) {
    const now = new Date().toISOString();
    await db
      .update(private_messages)
      .set({ status: "sent", updated_at: now })
      .where(inArray(private_messages.id, waiting.map((w) => w.id)));
    for (const w of waiting) {
      emitEvent({
        type: "private_message.approved",
        channel: userChannel(w.sender_id),
        userId: w.sender_id,
        resourceId: w.id,
        payload: { message_id: w.id, status: "sent" },
      });
    }
  }
  return { approved: waiting.length };
}

/**
 * Approve ONE waiting message into the recipient's normal inbox. The
 * sender restriction (if any) stays — the recipient can still keep future
 * messages queued. Only the recipient may approve.
 */
export async function approveMessage(
  userId: string,
  messageId: string,
): Promise<PrivateMessageView> {
  const [msg] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  if (!msg) throw new PrivateInboxError("Message not found", "NOT_FOUND");
  if (msg.recipient_id !== userId) {
    throw new PrivateInboxError("Only the recipient can approve this message", "FORBIDDEN");
  }
  if (msg.status !== "waiting") {
    const [view] = await buildViews([msg], userId);
    return view; // already approved — idempotent
  }

  const now = new Date().toISOString();
  await db
    .update(private_messages)
    .set({ status: "sent", updated_at: now })
    .where(eq(private_messages.id, messageId));
  const [fresh] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  const [view] = await buildViews([fresh!], userId);

  emitEvent({
    type: "private_message.approved",
    channel: userChannel(msg.sender_id),
    userId: msg.sender_id,
    resourceId: messageId,
    payload: { message_id: messageId, status: "sent" },
  });
  return view;
}

// ─── Deletion ───────────────────────────────────────────────────────────────

/**
 * Delete a thread by ownership:
 *  • The SENDER of the message deleting → the WHOLE thread is deleted for
 *    BOTH participants (both flags set everywhere).
 *  • The RECEIVER deleting → hidden only from the receiver's inbox; the
 *    sender keeps their Outbox copy untouched.
 */
export async function deleteMessage(
  userId: string,
  messageId: string,
): Promise<{ thread_id: string; deleted_for_both: boolean }> {
  const [msg] = await db
    .select()
    .from(private_messages)
    .where(eq(private_messages.id, messageId))
    .limit(1);
  if (!msg) throw new PrivateInboxError("Message not found", "NOT_FOUND");
  if (msg.sender_id !== userId && msg.recipient_id !== userId) {
    throw new PrivateInboxError("You are not part of this correspondence", "FORBIDDEN");
  }

  const root = await rootOf(msg);
  const { rows } = await loadThreadRows([root]);
  const senderInitiated = msg.sender_id === userId;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .update(private_messages)
        .set(
          senderInitiated
            ? { deleted_for_sender_at: now, deleted_for_recipient_at: now, updated_at: now }
            : { deleted_for_recipient_at: now, updated_at: now },
        )
        .where(eq(private_messages.id, row.id));
    }
  });

  // Realtime — the other participant's boxes/threads refresh without polling.
  const otherId = root.sender_id === userId ? root.recipient_id : root.sender_id;
  const payload = { thread_id: root.id, deleted_for_both: senderInitiated };
  emitEvent({
    type: "private_message.deleted",
    channel: userChannel(otherId),
    userId: otherId,
    resourceId: root.id,
    payload,
  });
  emitEvent({
    type: "private_message.deleted",
    channel: userChannel(userId),
    userId,
    resourceId: root.id,
    payload,
  });

  return { thread_id: root.id, deleted_for_both: senderInitiated };
}

async function getBalance(userId: string): Promise<number> {
  const [w] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, userId))
    .limit(1);
  return w?.balance ?? 0;
}
