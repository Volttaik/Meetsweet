/**
 * DeletionService — authoritative (HARD) deletion for MeetSweet.
 *
 * The platform contract: «If the server says something is deleted, that thing
 * must be gone from the platform.» Soft-delete flags were historically used for
 * posts/albums/accounts, which left rows, media metadata and storage objects
 * behind — deleted content could keep surfacing through endpoints that forgot
 * the `deleted_at` filter, and media URLs stayed live in R2.
 *
 * Everything here removes rows AND their storage objects:
 *
 *   - hardDeletePost()   — deletes the post row, every related record (likes,
 *     saves, hides, views, impressions, comments, comment room, categories,
 *     shares, notifications) and the post's media rows + R2/Stream objects.
 *   - hardDeleteAlbum()  — deletes the album row, items, unlocks, related
 *     shares/notifications, and the album-only media + R2/Stream objects.
 *   - hardDeleteUser()   — deletes the account and every account-owned record:
 *     posts (+ children), albums (+ children), media + storage, comments,
 *     social graph, subscriptions, messages, sessions, settings, wallets, …
 *     Financial rows (transactions, creator_earnings) are intentionally KEPT
 *     as an audit trail ("respect legitimate relational constraints") — the
 *     deleted user's content is gone from the platform either way.
 *
 * Storage deletion (R2 objects + Cloudflare Stream videos) is best-effort and
 * fire-and-forget: a storage outage must never roll back the database delete
 * or break the API response. When R2/Stream credentials are not configured the
 * storage cleanup is skipped entirely (DB deletion still happens).
 *
 * SQLite foreign-key cascades are NOT relied on (PRAGMA foreign_keys is off in
 * the production libsql setup), so every dependent table is deleted explicitly.
 */

import {
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  album_items,
  album_unlocks,
  albums,
  blocked_users,
  comment_likes,
  comment_replies,
  comment_rooms,
  comments,
  credential_grants,
  creator_reviews,
  creator_settings,
  devices,
  dm_restrictions,
  feed_impressions,
  follows,
  hidden_posts,
  login_history,
  media,
  muted_users,
  notifications,
  post_categories,
  post_likes,
  post_views,
  posts,
  private_message_attachments,
  private_messages,
  profiles,
  realtime_events,
  recent_searches,
  referral_rewards,
  refresh_tokens,
  reports,
  saved_posts,
  sessions,
  shares,
  subscriptions,
  upload_sessions,
  user_settings,
  users,
  verification_codes,
  wallets,
} from "@/lib/db/schema";
import { config } from "@/lib/config";

// ─── Storage cleanup (best-effort, fire-and-forget) ─────────────────────────

function r2Client(): S3Client | null {
  const accessKeyId = config.r2.accessKeyId();
  const secretAccessKey = config.r2.secretAccessKey();
  const bucket = config.r2.bucket();
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint =
    config.r2.endpoint() ??
    (config.r2.accountId()
      ? `https://${config.r2.accountId()}.r2.cloudflarestorage.com`
      : undefined);
  if (!endpoint) return null;
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * Delete R2 objects by their blob key. Best-effort — never throws. Skips when
 * R2 is not configured (local/dev deployments without credentials).
 */
export async function deleteR2Objects(keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter((k) => typeof k === "string" && k.length > 0))];
  if (unique.length === 0) return;
  const client = r2Client();
  const bucket = config.r2.bucket();
  if (!client || !bucket) return;
  await Promise.all(
    unique.map(async (key) => {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (e) {
        console.warn(`[deletion] R2 delete failed for ${key}:`, e);
      }
    }),
  );
}

/**
 * Delete Cloudflare Stream videos by uid (deletes the transcoded HLS renditions
 * as well). Best-effort — never throws. Skips when Stream is not configured.
 */
export async function deleteStreamVideos(uids: string[]): Promise<void> {
  const unique = [...new Set(uids.filter((u) => typeof u === "string" && u.length > 0))];
  if (unique.length === 0) return;
  const token = config.cloudflare.apiToken();
  const accountId = config.cloudflare.accountId();
  if (!token || !accountId) return;
  const API = "https://api.cloudflare.com/client/v4";
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const res = await fetch(`${API}/accounts/${accountId}/stream/${uid}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          console.warn(`[deletion] Stream delete failed for ${uid}: HTTP ${res.status}`);
        }
      } catch (e) {
        console.warn(`[deletion] Stream delete failed for ${uid}:`, e);
      }
    }),
  );
}

interface MediaCleanup {
  blobKeys: string[];
  streamUids: string[];
}

/**
 * Scrub durable realtime-outbox events whose payload references any of the
 * given ids (content ids / user ids are UUIDs — exact LIKE matches). Without
 * this, a reconnecting client could replay a stale event (e.g. a like or new-
 * post notification) for content that no longer exists.
 */
function scrubRealtimeEvents(
  tx: { delete: typeof db.delete },
  ids: string[],
): Promise<unknown> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return Promise.resolve();
  const conds = unique.map((id) => sql`${realtime_events.payload} LIKE ${`%${id}%`}`);
  return tx.delete(realtime_events).where(conds.length === 1 ? conds[0] : or(...conds));
}

function cleanupFromMedia(rows: Array<{ blob_path: string | null; stream_uid: string | null }>): MediaCleanup {
  return {
    blobKeys: rows.map((r) => r.blob_path).filter((k): k is string => Boolean(k)),
    streamUids: rows.map((r) => r.stream_uid).filter((u): u is string => Boolean(u)),
  };
}

async function fireStorageCleanup(cleanup: MediaCleanup): Promise<void> {
  await Promise.all([
    deleteR2Objects(cleanup.blobKeys),
    deleteStreamVideos(cleanup.streamUids),
  ]);
}

// ─── Hard delete: post (post / video / short / legacy album post) ───────────

/**
 * Permanently delete a post (any content_type) and everything attached to it.
 *
 * Media rows are removed ONLY when they are not still referenced by an album
 * item (a media record can legitimately be shared between a post and an
 * album). Storage objects for removed media are deleted after the transaction
 * commits.
 */
export async function hardDeletePost(postId: string): Promise<void> {
  const [post] = await db
    .select({ id: posts.id, content_type: posts.content_type })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return; // nothing to delete — idempotent

  // Media rows owned by this post, excluding rows still used by an album.
  const mediaRows = await db
    .select({ id: media.id, blob_path: media.blob_path, stream_uid: media.stream_uid })
    .from(media)
    .where(
      and(
        eq(media.post_id, postId),
        sql`NOT EXISTS (
          SELECT 1 FROM album_items ai WHERE ai.media_id = media.id
        )`,
      ),
    );
  const mediaIds = mediaRows.map((m) => m.id);
  const mediaCleanup = cleanupFromMedia(mediaRows);

  const commentIds = await db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.post_id, postId))
    .then((rows) => rows.map((r) => r.id));

  const entityTypes = ["post", "video", "short", "album"];

  await db.transaction(async (tx) => {
    // Comments + their likes (and legacy replies).
    if (commentIds.length > 0) {
      await tx.delete(comment_likes).where(
        or(
          inArray(comment_likes.comment_id, commentIds),
          inArray(comment_likes.reply_id, commentIds),
        ),
      );
      await tx.delete(comment_replies).where(inArray(comment_replies.comment_id, commentIds));
    }
    await tx.delete(comments).where(eq(comments.post_id, postId));
    await tx.delete(comment_rooms).where(eq(comment_rooms.post_id, postId));
    await tx.delete(post_likes).where(eq(post_likes.post_id, postId));
    await tx.delete(post_views).where(eq(post_views.post_id, postId));
    await tx.delete(saved_posts).where(eq(saved_posts.post_id, postId));
    await tx.delete(hidden_posts).where(eq(hidden_posts.post_id, postId));
    await tx.delete(feed_impressions).where(eq(feed_impressions.post_id, postId));
    await tx.delete(post_categories).where(eq(post_categories.post_id, postId));
    if (mediaIds.length > 0) {
      await tx.delete(media).where(inArray(media.id, mediaIds));
    }
    await tx.delete(notifications).where(
      and(
        inArray(notifications.entity_type, entityTypes),
        eq(notifications.entity_id, postId),
      ),
    );
    await tx.delete(shares).where(
      and(
        inArray(shares.content_type, entityTypes),
        eq(shares.content_id, postId),
      ),
    );
    await tx.delete(posts).where(eq(posts.id, postId));
    // Realtime-outbox events referencing the deleted post can never replay.
    await scrubRealtimeEvents(tx, [postId]);
  });

  await fireStorageCleanup(mediaCleanup);
}

// ─── Hard delete: album ─────────────────────────────────────────────────────

/**
 * Permanently delete an album, its items, unlocks and related records.
 * Media rows referenced ONLY by this album are deleted (with their storage);
 * media still referenced by another album survives.
 */
export async function hardDeleteAlbum(albumId: string): Promise<void> {
  const [album] = await db
    .select({ id: albums.id })
    .from(albums)
    .where(eq(albums.id, albumId))
    .limit(1);
  if (!album) return; // idempotent

  // Media ids referenced by THIS album's items.
  const itemRows = await db
    .select({ media_id: album_items.media_id })
    .from(album_items)
    .where(eq(album_items.album_id, albumId));
  const albumMediaIds = itemRows.map((r) => r.media_id);

  // Of those, only the ones not referenced by any OTHER album can be deleted.
  let removableMediaIds: string[] = [];
  if (albumMediaIds.length > 0) {
    const sharedRows = await db
      .select({ media_id: album_items.media_id })
      .from(album_items)
      .where(and(
        ne(album_items.album_id, albumId),
        inArray(album_items.media_id, albumMediaIds),
      ));
    const shared = new Set(sharedRows.map((r) => r.media_id));
    removableMediaIds = albumMediaIds.filter((id) => !shared.has(id));
  }

  const mediaRows = removableMediaIds.length > 0
    ? await db
        .select({ id: media.id, blob_path: media.blob_path, stream_uid: media.stream_uid })
        .from(media)
        .where(inArray(media.id, removableMediaIds))
    : [];
  const mediaCleanup = cleanupFromMedia(mediaRows);

  await db.transaction(async (tx) => {
    await tx.delete(album_items).where(eq(album_items.album_id, albumId));
    await tx.delete(album_unlocks).where(eq(album_unlocks.album_id, albumId));
    if (removableMediaIds.length > 0) {
      await tx.delete(media).where(inArray(media.id, removableMediaIds));
    }
    await tx.delete(notifications).where(
      and(eq(notifications.entity_type, "album"), eq(notifications.entity_id, albumId)),
    );
    await tx.delete(shares).where(
      and(eq(shares.content_type, "album"), eq(shares.content_id, albumId)),
    );
    await tx.delete(albums).where(eq(albums.id, albumId));
    // Realtime-outbox events referencing the deleted album can never replay.
    await scrubRealtimeEvents(tx, [albumId]);
  });

  await fireStorageCleanup(mediaCleanup);
}

// ─── Hard delete: user account ──────────────────────────────────────────────

/**
 * Permanently delete a user account and everything it owns.
 *
 * Removed: the user row, all posts/videos/shorts (+ their children), albums
 * (+ items/unlocks), media rows + R2/Stream storage, comments + likes,
 * social graph (follows/blocks/mutes), likes/saves/hides/views/impressions,
 * subscriptions (both directions), private messages + attachments,
 * restrictions, sessions/tokens/devices, settings/profiles/wallets, upload
 * sessions, reviews, referral rewards, reports, shares, notifications.
 *
 * KEPT (financial audit trail, per the product's relational constraints):
 * `transactions` and `creator_earnings`. Deleted users' content is never
 * returned by any endpoint regardless.
 */
export async function hardDeleteUser(userId: string): Promise<void> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return; // idempotent

  // ── Collect owned content ids + storage cleanup targets ────────────────
  const postRows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.creator_id, userId));
  const postIds = postRows.map((r) => r.id);

  const albumRows = await db
    .select({ id: albums.id })
    .from(albums)
    .where(eq(albums.creator_id, userId));
  const albumIds = albumRows.map((r) => r.id);

  // ALL media this user uploaded (posts, albums, private-message attachments).
  const mediaRows = await db
    .select({ id: media.id, blob_path: media.blob_path, stream_uid: media.stream_uid })
    .from(media)
    .where(eq(media.uploader_id, userId));
  const mediaIds = mediaRows.map((m) => m.id);
  const mediaCleanup = cleanupFromMedia(mediaRows);

  // Comments authored by the user + comments on the user's posts.
  const userCommentRows = await db
    .select({ id: comments.id })
    .from(comments)
    .where(or(eq(comments.author_id, userId), ...(postIds.length > 0 ? [inArray(comments.post_id, postIds)] : [])));
  const userCommentIds = userCommentRows.map((r) => r.id);

  // Private messages involving the user (both directions).
  const messageRows = await db
    .select({ id: private_messages.id })
    .from(private_messages)
    .where(or(eq(private_messages.sender_id, userId), eq(private_messages.recipient_id, userId)));
  const messageIds = messageRows.map((r) => r.id);

  // Album ids the user unlocked (as a buyer).
  const unlockRows = await db
    .select({ album_id: album_unlocks.album_id })
    .from(album_unlocks)
    .where(eq(album_unlocks.user_id, userId));
  const unlockAlbumIds = unlockRows.map((r) => r.album_id);

  await db.transaction(async (tx) => {
    // ── Content children ────────────────────────────────────────────────
    if (postIds.length > 0) {
      const postCommentIds = await tx
        .select({ id: comments.id })
        .from(comments)
        .where(inArray(comments.post_id, postIds))
        .then((rows) => rows.map((r) => r.id));
      const allCommentIds = [...new Set([...userCommentIds, ...postCommentIds])];
      if (allCommentIds.length > 0) {
        await tx.delete(comment_likes).where(
          or(
            inArray(comment_likes.comment_id, allCommentIds),
            inArray(comment_likes.reply_id, allCommentIds),
          ),
        );
        await tx.delete(comment_replies).where(inArray(comment_replies.comment_id, allCommentIds));
      }
      await tx.delete(comments).where(inArray(comments.post_id, postIds));
      await tx.delete(comment_rooms).where(inArray(comment_rooms.post_id, postIds));
      await tx.delete(post_likes).where(inArray(post_likes.post_id, postIds));
      await tx.delete(post_views).where(inArray(post_views.post_id, postIds));
      await tx.delete(saved_posts).where(inArray(saved_posts.post_id, postIds));
      await tx.delete(hidden_posts).where(inArray(hidden_posts.post_id, postIds));
      await tx.delete(feed_impressions).where(inArray(feed_impressions.post_id, postIds));
      await tx.delete(post_categories).where(inArray(post_categories.post_id, postIds));
      await tx.delete(notifications).where(
        and(
          inArray(notifications.entity_type, ["post", "video", "short", "album"]),
          inArray(notifications.entity_id, postIds),
        ),
      );
      await tx.delete(shares).where(
        and(
          inArray(shares.content_type, ["post", "video", "short", "album"]),
          inArray(shares.content_id, postIds),
        ),
      );
      await tx.delete(posts).where(inArray(posts.id, postIds));
    }

    // ── Albums + children ───────────────────────────────────────────────
    if (albumIds.length > 0) {
      await tx.delete(album_items).where(inArray(album_items.album_id, albumIds));
      await tx.delete(album_unlocks).where(inArray(album_unlocks.album_id, albumIds));
      await tx.delete(notifications).where(
        and(eq(notifications.entity_type, "album"), inArray(notifications.entity_id, albumIds)),
      );
      await tx.delete(shares).where(
        and(eq(shares.content_type, "album"), inArray(shares.content_id, albumIds)),
      );
      await tx.delete(albums).where(inArray(albums.id, albumIds));
    }
    if (unlockAlbumIds.length > 0) {
      await tx.delete(album_unlocks).where(
        and(
          inArray(album_unlocks.album_id, unlockAlbumIds),
          eq(album_unlocks.user_id, userId),
        ),
      );
    }

    // ── Media ───────────────────────────────────────────────────────────
    if (mediaIds.length > 0) {
      await tx.delete(media).where(inArray(media.id, mediaIds));
    }

    // ── The user's own comments + likes they cast ───────────────────────
    if (userCommentIds.length > 0) {
      await tx.delete(comments).where(inArray(comments.id, userCommentIds));
    }
    await tx.delete(comment_likes).where(eq(comment_likes.user_id, userId));

    // ── Social graph ────────────────────────────────────────────────────
    await tx.delete(follows).where(or(eq(follows.follower_id, userId), eq(follows.following_id, userId)));
    await tx.delete(blocked_users).where(or(eq(blocked_users.blocker_id, userId), eq(blocked_users.blocked_id, userId)));
    await tx.delete(muted_users).where(or(eq(muted_users.muter_id, userId), eq(muted_users.muted_id, userId)));
    await tx.delete(post_likes).where(eq(post_likes.user_id, userId));
    await tx.delete(saved_posts).where(eq(saved_posts.user_id, userId));
    await tx.delete(hidden_posts).where(eq(hidden_posts.user_id, userId));
    await tx.delete(feed_impressions).where(eq(feed_impressions.user_id, userId));
    await tx.delete(post_views).where(eq(post_views.user_id, userId));
    await tx.delete(recent_searches).where(eq(recent_searches.user_id, userId));
    await tx.delete(shares).where(eq(shares.creator_id, userId));
    await tx.delete(reports).where(eq(reports.reporter_id, userId));
    await tx.delete(referral_rewards).where(or(
      eq(referral_rewards.referrer_id, userId),
      eq(referral_rewards.referred_user_id, userId),
    ));
    await tx.delete(creator_reviews).where(or(
      eq(creator_reviews.creator_id, userId),
      eq(creator_reviews.reviewer_id, userId),
    ));

    // ── Subscriptions — both directions ─────────────────────────────────
    await tx.delete(subscriptions).where(or(
      eq(subscriptions.subscriber_id, userId),
      eq(subscriptions.creator_id, userId),
    ));

    // ── Private messages + attachments + restrictions ───────────────────
    if (messageIds.length > 0) {
      await tx.delete(private_message_attachments).where(inArray(private_message_attachments.message_id, messageIds));
    }
    await tx.delete(private_messages).where(or(
      eq(private_messages.sender_id, userId),
      eq(private_messages.recipient_id, userId),
    ));
    await tx.delete(dm_restrictions).where(or(
      eq(dm_restrictions.user_id, userId),
      eq(dm_restrictions.restricted_id, userId),
    ));

    // ── Notifications (owned rows removed; rows mentioning the user as the
    //    actor keep the notification but lose the actor link so a deleted
    //    account's identity never surfaces in another user's feed). ─────
    await tx.delete(notifications).where(eq(notifications.user_id, userId));
    await tx.update(notifications).set({ actor_id: null }).where(eq(notifications.actor_id, userId));

    // ── Sessions / tokens / devices ─────────────────────────────────────
    await tx.delete(refresh_tokens).where(eq(refresh_tokens.user_id, userId));
    await tx.delete(sessions).where(eq(sessions.user_id, userId));
    await tx.delete(login_history).where(eq(login_history.user_id, userId));
    await tx.delete(devices).where(eq(devices.user_id, userId));
    await tx.delete(credential_grants).where(eq(credential_grants.user_id, userId));
    await tx.delete(verification_codes).where(eq(verification_codes.user_id, userId));
    await tx.delete(upload_sessions).where(eq(upload_sessions.user_id, userId));

    // ── Settings / profiles / wallet ────────────────────────────────────
    await tx.delete(profiles).where(eq(profiles.user_id, userId));
    await tx.delete(user_settings).where(eq(user_settings.user_id, userId));
    await tx.delete(creator_settings).where(eq(creator_settings.user_id, userId));
    await tx.delete(wallets).where(eq(wallets.user_id, userId));

    // ── The account itself ──────────────────────────────────────────────
    await tx.delete(users).where(eq(users.id, userId));

    // ── Realtime outbox ─────────────────────────────────────────────────
    // Remove the deleted account's own channel events + any event whose
    // payload references the account, so nothing about them can replay.
    await tx.delete(realtime_events).where(eq(realtime_events.user_id, userId));
    await scrubRealtimeEvents(tx, [userId]);
  });

  await fireStorageCleanup(mediaCleanup);
}
