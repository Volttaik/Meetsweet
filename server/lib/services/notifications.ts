/**
 * NotificationService — the ONE notification entry point for MeetSweet.
 *
 * Architecture (deliberately simple):
 *
 *   DATABASE   →  authoritative notification history (the `notifications` row)
 *   WebSocket  →  instant in-app feed/badge updates while the app is connected
 *   Expo push  →  OS-level device delivery when the app is backgrounded/quit
 *
 * Every application feature calls ONE named method below (notifyLike,
 * notifyComment, notifySubscription, …). Routes and services never hand-roll
 * notification rows or push payloads — the service owns the preference gate,
 * the duplicate prevention, the durable row, the realtime event, and the push.
 *
 *   A notification can exist in the database even if push delivery fails, and
 *   push delivery is never treated as proof the row was stored.
 *
 * Dedupe: each logical event derives a `dedupe_key` (e.g. `like:{post}:{actor}`)
 * and the DB enforces (user_id, dedupe_key) uniqueness, so retried or replayed
 * events can never produce duplicate rows or double-pushes.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, posts, private_messages, profiles, subscriptions, user_settings, users } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { emitEvent } from "@/lib/realtime/emit";
import { userChannel } from "@/lib/realtime/types";
import {
  categoryEnabled,
  getActorUsername,
  notificationDataBlock,
  sendPushToUser,
  type NotifPreferenceKey,
} from "@/lib/services/push";

// ─── Row + realtime emit (internal) ──────────────────────────────────────────

export type NotificationRow = {
  id: string;
  user_id: string;
  created_at: string;
  actor_id?: string | null;
  type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  body?: string | null;
  dedupe_key?: string | null;
};

/**
 * Emit `notification.created` for an already-persisted notification row.
 * The row is the source of truth; this only delivers the realtime event with
 * actor display data loaded best-effort. Fire-and-forget — never throws.
 */
export function emitNotificationCreated(row: NotificationRow): void {
  void (async () => {
    try {
      let actor_name: string | null = null;
      let actor_username: string | null = null;
      let actor_avatar: string | null = null;
      if (row.actor_id) {
        const [actor] = await db
          .select({
            full_name: users.full_name,
            username: users.username,
            avatar_url: profiles.avatar_url,
          })
          .from(users)
          .leftJoin(profiles, eq(profiles.user_id, users.id))
          .where(eq(users.id, row.actor_id))
          .limit(1);
        if (actor) {
          actor_name = actor.full_name ?? null;
          actor_username = actor.username ?? null;
          actor_avatar = actor.avatar_url ?? null;
        }
      }

      // Purpose-built preview block (post thumbnail/caption, message body) so
      // the recipient's client can render the card immediately — no extra
      // fetch, no guessing. Best-effort: null when there is nothing to preview.
      const [preview] = await notificationPreviewsFor([row]);

      emitEvent({
        type: "notification.created",
        channel: userChannel(row.user_id),
        userId: row.user_id,
        resourceId: row.id,
        payload: {
          notification: {
            id: row.id,
            type: row.type,
            entity_type: row.entity_type ?? null,
            entity_id: row.entity_id ?? null,
            body: row.body ?? null,
            actor_id: row.actor_id ?? null,
            created_at: row.created_at,
            is_read: false,
            actor_name,
            actor_username,
            actor_avatar,
            preview,
            data: notificationDataBlock({
              entity_type: row.entity_type,
              entity_id: row.entity_id,
              actor_id: row.actor_id,
              actor_name,
              actor_username,
              actor_avatar,
            }),
          },
        },
      });
    } catch {
      // Delivery is best-effort — the DB row is already authoritative.
    }
  })();
}

// ─── Core notify() ───────────────────────────────────────────────────────────

// ─── Preview block (what the card shows) ─────────────────────────────────────

export type NotificationPreviewBlock = {
  /** Media thumbnail for content notifications (post/video/short/album). */
  thumbnail: string | null;
  title: string | null;
  caption: string | null;
  /** Actual message text for private-message notifications. */
  body: string | null;
};

const CONTENT_ENTITY_TYPES = ["post", "video", "short", "album"] as const;

/**
 * Build the compact `preview` block for a batch of notification rows.
 *
 * One batched query per entity family (content → posts, private_message →
 * private_messages) so a page of notifications never turns into N queries.
 * Returns one entry per input item, aligned by index (null = no preview).
 */
export async function notificationPreviewsFor(
  items: Array<{ entity_type?: string | null; entity_id?: string | null }>,
): Promise<(NotificationPreviewBlock | null)[]> {
  const contentIds = items
    .filter(
      (i) =>
        i.entity_type &&
        (CONTENT_ENTITY_TYPES as readonly string[]).includes(i.entity_type) &&
        i.entity_id,
    )
    .map((i) => i.entity_id as string);
  const messageIds = items
    .filter((i) => i.entity_type === "private_message" && i.entity_id)
    .map((i) => i.entity_id as string);

  const [postRows, messageRows] = await Promise.all([
    contentIds.length > 0
      ? db
          .select({
            id: posts.id,
            thumbnail_url: posts.thumbnail_url,
            title: posts.title,
            caption: posts.caption,
          })
          .from(posts)
          .where(inArray(posts.id, contentIds))
      : Promise.resolve([] as { id: string; thumbnail_url: string | null; title: string | null; caption: string | null }[]),
    messageIds.length > 0
      ? db
          .select({ id: private_messages.id, body: private_messages.body })
          .from(private_messages)
          .where(inArray(private_messages.id, messageIds))
      : Promise.resolve([] as { id: string; body: string }[]),
  ]);

  const postMap = new Map(postRows.map((p) => [p.id, p]));
  const messageMap = new Map(messageRows.map((m) => [m.id, m]));

  return items.map((item) => {
    if (!item.entity_type || !item.entity_id) return null;
    if ((CONTENT_ENTITY_TYPES as readonly string[]).includes(item.entity_type)) {
      const post = postMap.get(item.entity_id);
      if (!post) return null;
      return {
        thumbnail: post.thumbnail_url ?? null,
        title: post.title ?? null,
        caption: post.caption ?? null,
        body: null,
      };
    }
    if (item.entity_type === "private_message") {
      const message = messageMap.get(item.entity_id);
      if (!message) return null;
      return { thumbnail: null, title: null, caption: null, body: message.body };
    }
    return null;
  });
}

export interface NotifyInput {
  /** The notification recipient. */
  recipientId: string;
  /** Preference category gate — null means always notify (account-critical). */
  category: NotifPreferenceKey | null;
  /** Notification type (like / comment / subscribe / payment / …). */
  type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  body?: string | null;
  actorId?: string | null;
  /**
   * Deterministic id of the logical event (e.g. `like:{postId}:{actorId}`).
   * At most ONE notification row per (user, dedupe_key) — retries are safe.
   */
  dedupeKey?: string | null;
  /** OS-level push payload. Omit/null to skip push entirely. */
  push?: {
    title: string;
    body: string;
    sound?: "default" | null;
    badge?: number;
    data?: Record<string, unknown>;
  } | null;
}

/**
 * The single path that creates a notification: preference gate → dedupe →
 * durable DB row → realtime event → (optional) push. Never throws — every
 * failure is contained so an API response can never break because of
 * notification delivery.
 */
export async function notify(input: NotifyInput): Promise<{ created: boolean }> {
  try {
    // 1. Preference gate — when the recipient turned this category OFF, no row
    //    is written and no event/push is emitted (server-authoritative).
    if (input.category && !(await categoryEnabled(input.recipientId, input.category))) {
      return { created: false };
    }

    // 2. Dedupe — the same logical event must produce at most one row. The
    //    unique (user_id, dedupe_key) index makes this race-safe; the pre-check
    //    just avoids the insert for the common replay case. When the row
    //    already exists (e.g. it was created atomically inside a payment
    //    transaction), we still attempt the OS push — the row is the
    //    notification, the push is only its delivery.
    if (input.dedupeKey) {
      const [existing] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.user_id, input.recipientId),
            eq(notifications.dedupe_key, input.dedupeKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (input.push) {
          await sendPushToUser(input.recipientId, input.push, input.category ?? undefined);
        }
        return { created: false };
      }
    }

    const row: NotificationRow = {
      id: generateId(),
      user_id: input.recipientId,
      created_at: new Date().toISOString(),
      actor_id: input.actorId ?? null,
      type: input.type,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      body: input.body ?? null,
      dedupe_key: input.dedupeKey ?? null,
    };

    try {
      await db.insert(notifications).values(row);
    } catch (error) {
      // Unique race: another request won the insert for the same event.
      if (
        error instanceof Error &&
        /UNIQUE|constraint/i.test(`${(error as { code?: string }).code ?? ""} ${error.message}`)
      ) {
        return { created: false };
      }
      throw error;
    }

    // 3. Realtime — the recipient's connected clients update the feed/badge.
    emitNotificationCreated(row);

    // 4. OS push — preference-gated again inside sendPushToUser (master switch
    //    + category). Delivery failure never affects the stored row.
    if (input.push) {
      await sendPushToUser(input.recipientId, input.push, input.category ?? undefined);
    }

    return { created: true };
  } catch (error) {
    // Notification writes are best-effort — never break the API response, but
    // log unexpected failures so they are not silently swallowed.
    console.error("[notifications] notify failed:", error);
    return { created: false };
  }
}

// ─── Display titles (shared with GET /api/notifications) ─────────────────────

export function notificationTitle(type: string): string {
  const map: Record<string, string> = {
    like: "New Like",
    comment: "New Comment",
    reply: "New Reply",
    follow: "New Follower",
    subscribe: "New Subscriber",
    new_post: "New Post",
    mention: "You were mentioned",
    tip: "New Tip",
    payment: "Payment Received",
    message: "New Message",
    private_message: "New Private Message",
    private_message_reply: "Private Message Reply",
    withdrawal: "Withdrawal Update",
    referral_reward: "Referral Reward",
    subscription_renewed: "Subscription Renewed",
    subscription_renewal_failed: "Subscription Expired",
    report: "Report Received",
    system: "MeetSweet",
  };
  return map[type] ?? "Notification";
}

/**
 * Someone reported the recipient (or their content). The reporter's identity
 * is NEVER exposed — no actor_id, no username, no push payload reference — so
 * the notification cannot be used to retaliate or reveal who reported.
 *
 * Delivered without a preference gate (category: null, like account-critical
 * notices) so a report always reaches the affected account.
 *
 * @param reporterId  used ONLY to build the dedupe key (one notification per
 *                    reporter per target) — never stored on the row.
 */
export async function notifyReported(input: {
  recipientId: string;
  reporterId: string;
  entityType: string;
  entityId: string;
  entityTitle?: string | null;
}): Promise<{ created: boolean }> {
  const isUser = input.entityType === "user";
  const contentLabel = isUser
    ? "Your account"
    : (input.entityTitle ?? "").trim()
      ? `Your ${input.entityType} “${(input.entityTitle ?? "").trim().slice(0, 60)}”`
      : `Your ${input.entityType}`;
  const body = `${contentLabel} was reported for a policy concern. Our team will review it and take appropriate action if needed.`;

  return notify({
    recipientId: input.recipientId,
    category: null,
    type: "report",
    entity_type: input.entityType,
    entity_id: input.entityId,
    body,
    // No actorId — the reporter's identity is never attached to the row, the
    // realtime event, or the push.
    actorId: null,
    dedupeKey: `report:${input.entityType}:${input.entityId}:${input.reporterId}`,
    push: {
      title: isUser ? "Account reported" : "Content reported",
      body,
      data: {
        type: "report",
        entity_type: input.entityType,
        entity_id: input.entityId,
        // Deliberately no actor_id / actor_username / reporter fields.
      },
    },
  });
}

// ─── Named event methods ─────────────────────────────────────────────────────
// One method per real MeetSweet event. Callers pass ids only — bodies and
// push payloads are built here so copy stays consistent app-wide.

/** Someone liked your content. */
export async function notifyLike(input: {
  actorId: string;
  recipientId: string;
  postId: string;
  contentType: string;
  title?: string | null;
}): Promise<{ created: boolean }> {
  const title = (input.title ?? "").trim();
  const body = title ? `liked your post "${title.slice(0, 60)}"` : "liked your post";
  const actor = await getActorUsername(input.actorId);
  return notify({
    recipientId: input.recipientId,
    category: "notif_likes",
    type: "like",
    entity_type: input.contentType,
    entity_id: input.postId,
    body,
    actorId: input.actorId,
    dedupeKey: `like:${input.postId}:${input.actorId}`,
    push: {
      title: "New Like",
      body: `${actor} ${body}`,
      data: {
        type: "like",
        post_id: input.postId,
        actor_id: input.actorId,
        content_type: input.contentType,
        actor_username: actor.replace(/^@/, ""),
      },
    },
  });
}

/** Someone commented on your content. */
export async function notifyComment(input: {
  actorId: string;
  postOwnerId: string;
  postId: string;
  contentType: string;
  title?: string | null;
  commentBody?: string | null;
  /** The created comment id — the dedupe anchor for this specific event. */
  commentId: string;
}): Promise<{ created: boolean }> {
  const title = (input.title ?? "").trim();
  const body = title ? `commented on "${title.slice(0, 60)}"` : "commented on your post";
  const preview =
    (input.commentBody ?? "").trim().length > 60
      ? `${(input.commentBody ?? "").trim().slice(0, 57)}…`
      : (input.commentBody ?? "").trim();
  const actor = await getActorUsername(input.actorId);
  return notify({
    recipientId: input.postOwnerId,
    category: "notif_comments",
    type: "comment",
    entity_type: "post",
    entity_id: input.postId,
    body,
    actorId: input.actorId,
    dedupeKey: `comment:${input.commentId}:${input.actorId}`,
    push: {
      title: "New Comment",
      body: `${actor} ${body}${preview ? `: “${preview}”` : ""}`,
      data: {
        type: "comment",
        post_id: input.postId,
        actor_id: input.actorId,
        content_type: input.contentType,
        actor_username: actor.replace(/^@/, ""),
      },
    },
  });
}

/** Someone replied to your comment. */
export async function notifyCommentReply(input: {
  actorId: string;
  parentAuthorId: string;
  postId: string;
  contentType: string;
  commentId: string;
  commentBody?: string | null;
}): Promise<{ created: boolean }> {
  const preview =
    (input.commentBody ?? "").trim().length > 60
      ? `${(input.commentBody ?? "").trim().slice(0, 57)}…`
      : (input.commentBody ?? "").trim();
  const body = `replied to your comment${preview ? `: “${preview}”` : ""}`;
  const actor = await getActorUsername(input.actorId);
  return notify({
    recipientId: input.parentAuthorId,
    category: "notif_comments",
    type: "reply",
    // Anchored on the post so the notification feed and push both route to
    // the same screen as comment notifications; the comment id is carried in
    // the push payload for reference.
    entity_type: "post",
    entity_id: input.postId,
    body,
    actorId: input.actorId,
    dedupeKey: `reply:${input.commentId}:${input.actorId}`,
    push: {
      title: "New Reply",
      body: `${actor} ${body}`,
      data: {
        type: "reply",
        post_id: input.postId,
        content_id: input.postId,
        content_type: input.contentType,
        comment_id: input.commentId,
        actor_id: input.actorId,
        actor_username: actor.replace(/^@/, ""),
      },
    },
  });
}

/** Someone subscribed to you. */
export async function notifySubscription(input: {
  actorId: string;
  creatorId: string;
}): Promise<{ created: boolean }> {
  const actor = await getActorUsername(input.actorId);
  return notify({
    recipientId: input.creatorId,
    category: "notif_new_subscribers",
    type: "subscribe",
    entity_type: "user",
    entity_id: input.actorId,
    body: "just subscribed to you",
    actorId: input.actorId,
    dedupeKey: `subscribe:${input.actorId}`,
    push: {
      title: "New Subscriber",
      body: `${actor} just subscribed to you`,
      data: {
        type: "subscribe",
        wallet: true,
        actor_id: input.actorId,
        actor_username: actor.replace(/^@/, ""),
      },
    },
  });
}

/** Private Inbox: a fan sent you a message (or it is waiting for approval). */
export async function notifyPrivateMessage(input: {
  actorId: string;
  recipientId: string;
  messageId: string;
  waiting?: boolean;
}): Promise<{ created: boolean }> {
  const body = input.waiting
    ? "sent you a private message awaiting approval"
    : "sent you a private message";
  const actor = await getActorUsername(input.actorId);
  return notify({
    recipientId: input.recipientId,
    category: "notif_messages",
    type: "private_message",
    entity_type: "private_message",
    entity_id: input.messageId,
    body,
    actorId: input.actorId,
    dedupeKey: `private_message:${input.messageId}:${input.actorId}`,
    push: {
      title: input.waiting ? "Private Message Awaiting Approval" : "New Private Message",
      body: `${actor} ${body}`,
      data: { type: "private_message", private_message_id: input.messageId },
    },
  });
}

/** Private Inbox: someone replied to your message thread. */
export async function notifyPrivateMessageReply(input: {
  actorId: string;
  recipientId: string;
  threadId: string;
  /** The created reply message id — the dedupe anchor for this specific reply. */
  messageId: string;
}): Promise<{ created: boolean }> {
  const actor = await getActorUsername(input.actorId);
  return notify({
    recipientId: input.recipientId,
    category: "notif_messages",
    type: "private_message_reply",
    entity_type: "private_message",
    entity_id: input.threadId,
    body: "replied to your private message",
    actorId: input.actorId,
    dedupeKey: `private_message_reply:${input.messageId}:${input.actorId}`,
    push: {
      title: "Private Message Reply",
      body: `${actor} replied to your message`,
      data: { type: "private_message", private_message_id: input.threadId },
    },
  });
}

/**
 * Paid content purchased (album unlock, priced private-message media, …).
 * The creator is notified; earnings are recorded by the payment transaction,
 * never here.
 */
export async function notifyPurchase(input: {
  buyerId: string;
  creatorId: string;
  sourceType: string;
  sourceId: string;
  description: string;
  pushTitle: string;
  pushVerb: string;
}): Promise<{ created: boolean }> {
  const actor = await getActorUsername(input.buyerId);
  return notify({
    recipientId: input.creatorId,
    category: "notif_creator_updates",
    type: "payment",
    entity_type: input.sourceType,
    entity_id: input.sourceId,
    body: input.description,
    actorId: input.buyerId,
    dedupeKey: `payment:${input.sourceType}:${input.sourceId}:${input.buyerId}`,
    push: {
      title: input.pushTitle,
      body: `${actor} ${input.pushVerb}`,
      data: {
        type: "payment",
        wallet: true,
        content_type: input.sourceType,
        content_id: input.sourceId,
        [input.sourceType === "private_message" ? "private_message_id" : `${input.sourceType}_id`]:
          input.sourceId,
      },
    },
  });
}

/** A withdrawal was requested or its status changed (account-critical). */
export async function notifyWithdrawal(input: {
  userId: string;
  amount: number;
  status: string;
  reference?: string;
}): Promise<{ created: boolean }> {
  const naira = input.amount.toLocaleString("en-NG");
  const body =
    input.status === "processing" || input.status === "pending"
      ? `Your withdrawal of ₦${naira} is being processed — it may take up to 24 hours.`
      : `Your withdrawal of ₦${naira} is ${input.status}.`;
  return notify({
    recipientId: input.userId,
    category: null, // account-critical — never preference-gated
    type: "withdrawal",
    entity_type: "withdrawal",
    entity_id: input.reference ?? null,
    body,
    actorId: null,
    dedupeKey: `withdrawal:${input.reference ?? input.userId}:${input.status}`,
    push: {
      title: "Withdrawal Update",
      body,
      data: { type: "withdrawal", wallet: true },
    },
  });
}

/** Subscription auto-renewed for another period (account-critical). */
export async function notifySubscriptionRenewal(input: {
  userId: string;
  creatorId: string;
  subscriptionId: string;
  amount: number;
}): Promise<{ created: boolean }> {
  const creator = await getActorUsername(input.creatorId);
  const body = `Your subscription to ${creator} renewed for ₦${Math.round(input.amount).toLocaleString()} for another 30 days.`;
  return notify({
    recipientId: input.userId,
    category: null,
    type: "subscription_renewed",
    entity_type: "user",
    entity_id: input.creatorId,
    body,
    dedupeKey: `subscription_renewed:${input.subscriptionId}`,
    push: {
      title: "Subscription Renewed",
      body,
      data: {
        type: "subscription_renewed",
        creator_id: input.creatorId,
        subscription_id: input.subscriptionId,
        wallet: true,
      },
    },
  });
}

/** Subscription renewal failed (insufficient balance) — account-critical. */
export async function notifySubscriptionRenewalFailed(input: {
  userId: string;
  creatorId: string;
  subscriptionId: string;
}): Promise<{ created: boolean }> {
  const creator = await getActorUsername(input.creatorId);
  const body =
    "Your subscription renewal failed because your wallet balance is insufficient. You are no longer subscribed to this creator. Top up your wallet and subscribe again to keep accessing their content.";
  return notify({
    recipientId: input.userId,
    category: null,
    type: "subscription_renewal_failed",
    entity_type: "user",
    entity_id: input.creatorId,
    body,
    dedupeKey: `subscription_renewal_failed:${input.subscriptionId}`,
    push: {
      title: "Subscription expired",
      body: `Your renewal to ${creator} failed — wallet balance insufficient. You are no longer subscribed.`,
      data: {
        type: "subscription_renewal_failed",
        creator_id: input.creatorId,
        subscription_id: input.subscriptionId,
        wallet: true,
      },
    },
  });
}

/** New content published — every active subscriber is notified once. */
export async function notifyNewPostToSubscribers(input: {
  creatorId: string;
  postId: string;
  contentType: "post" | "video" | "short" | "album";
  title?: string | null;
}): Promise<void> {
  try {
    const [creator] = await db
      .select({ username: users.username, full_name: users.full_name })
      .from(users)
      .where(eq(users.id, input.creatorId))
      .limit(1);

    const subscriberRows = await db
      .select({ user_id: subscriptions.subscriber_id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.creator_id, input.creatorId),
          eq(subscriptions.status, "active"),
        ),
      );

    const recipientIds = subscriberRows
      .map((row) => row.user_id)
      .filter((id): id is string => Boolean(id) && id !== input.creatorId);
    if (recipientIds.length === 0) return;

    const creatorName = creator?.username
      ? `@${creator.username}`
      : creator?.full_name || "A creator";
    const contentTitle = input.title?.trim() || `a new ${input.contentType}`;
    const body = `${creatorName} just posted: ${contentTitle}`;

    await Promise.all(
      recipientIds.map((userId) =>
        notify({
          recipientId: userId,
          category: "notif_creator_updates",
          type: "new_post",
          entity_type: input.contentType,
          entity_id: input.postId,
          body,
          actorId: input.creatorId,
          dedupeKey: `new_post:${input.postId}:${userId}`,
          push: {
            title: "New Post",
            body,
            data: {
              type: "new_post",
              post_id: input.postId,
              content_id: input.postId,
              ...(input.contentType === "album" ? { album_id: input.postId } : {}),
              actor_id: input.creatorId,
              actor_username: creator?.username ?? null,
              content_type: input.contentType,
            },
          },
        }),
      ),
    );
  } catch {
    // Publishing must never fail because a notification provider is unavailable.
  }
}

/** Referral reward credited to a user's wallet. */
export async function notifyReferralReward(input: {
  userId: string;
  referredUserId: string;
  amount: number;
}): Promise<{ created: boolean }> {
  const body = `You received ₦${Math.round(input.amount).toLocaleString()} in your MeetSweet wallet.`;
  return notify({
    recipientId: input.userId,
    category: "notif_creator_updates",
    type: "referral_reward",
    entity_type: "user",
    entity_id: input.referredUserId,
    body,
    dedupeKey: `referral_reward:${input.referredUserId}`,
    push: {
      title: "Referral Reward",
      body,
      data: { type: "referral_reward", wallet: true, referred_user_id: input.referredUserId },
    },
  });
}

/** System/account notification (always delivered — no preference gate). */
export async function notifySystem(input: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<{ created: boolean }> {
  return notify({
    recipientId: input.userId,
    category: null,
    type: "system",
    body: input.body,
    dedupeKey: input.data?.dedupe_key ? String(input.data.dedupe_key) : null,
    push: { title: input.title, body: input.body, data: input.data ?? {} },
  });
}

// ─── Mentions (moved from the old mentions.ts into the service) ──────────────

/** Safety cap on how many distinct users a single piece of text can tag. */
const MAX_MENTIONS = 10;

/**
 * Extract unique @username mentions from text (3–30 chars, letters/digits/
 * underscore — the same shape as usernames). Returns lowercased usernames,
 * deduped, capped at MAX_MENTIONS.
 */
export function extractUsernames(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /(?:^|[\s("'])[@]([a-zA-Z0-9_]{3,30})(?=$|[\s.,!?;:)"'])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const username = match[1].toLowerCase();
    if (!seen.has(username)) {
      seen.add(username);
      out.push(username);
    }
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/**
 * Notify every user tagged via @username in `text` — gated by the TAGGED
 * user's Allow Mentions/Tags privacy toggles and notif_mentions preference.
 * The actor is never notified for tagging themselves, and each post/comment
 * produces at most ONE notification per tagged user.
 */
export async function notifyMentionedUsers(input: {
  actorId: string;
  text: string | null | undefined;
  entityType: string;
  entityId: string;
  entityTitle?: string | null;
}): Promise<void> {
  const usernames = extractUsernames(input.text);
  if (usernames.length === 0) return;

  try {
    const rows = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.username, usernames))
      .limit(MAX_MENTIONS);
    if (rows.length === 0) return;

    const targetIds = rows.map((r) => r.id);
    const actorName = (await getActorUsername(input.actorId)).replace(/^@/, "");

    const settingsRows = await db
      .select({
        user_id: user_settings.user_id,
        allow_mentions: user_settings.allow_mentions,
        allow_tags: user_settings.allow_tags,
      })
      .from(user_settings)
      .where(inArray(user_settings.user_id, targetIds));
    const allowTag = new Map(
      settingsRows.map((s) => [s.user_id, s.allow_mentions !== false && s.allow_tags !== false]),
    );

    const title = (input.entityTitle ?? "").trim();
    const action = title
      ? `tagged you in "${title.slice(0, 60)}"`
      : input.entityType === "comment"
        ? "tagged you in a comment"
        : "tagged you in a post";

    await Promise.all(
      rows
        .filter((r) => r.id !== input.actorId)
        .filter((r) => allowTag.get(r.id) ?? true)
        .map(async (r) =>
          notify({
            recipientId: r.id,
            category: "notif_mentions",
            type: "mention",
            entity_type: input.entityType,
            entity_id: input.entityId,
            body: action,
            actorId: input.actorId,
            dedupeKey: `mention:${input.entityType}:${input.entityId}:${r.id}`,
            push: {
              title: "New Mention",
              body: `${actorName} ${action}`,
              data: {
                type: "mention",
                post_id: input.entityId,
                content_id: input.entityId,
                content_type: input.entityType,
                actor_id: input.actorId,
                actor_username: actorName,
              },
            },
          }),
        ),
    );
  } catch {
    // Mention delivery is best-effort — never break post/comment creation.
  }
}
