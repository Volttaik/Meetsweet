/**
 * Data-repair migration (idempotent, safe to re-run).
 *
 * Run with TURSO_DATABASE_URL / TURSO_AUTH_TOKEN set:
 *   cd server && TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/repair-data.ts
 *
 * Preview without writing:
 *   DRY_RUN=1 npx tsx scripts/repair-data.ts
 *
 * Performs three repairs, in order:
 *   1. Re-price active subscriptions that were recorded at ₦0 (the old pricing
 *      fallback bug) to the creator's real price.
 *   2. Backfill comment_rooms.comment_count from the canonical posts.comment_count.
 *   3. Migrate legacy conversations/messages → chat_rooms/chat_room_members/
 *      chat_room_messages so pre-migration DMs are visible again.
 *
 * IMPORTANT: run this BEFORE the legacy-table DROP in migrate.ts, otherwise the
 * legacy messages are deleted before they can be migrated.
 */

import { createClient } from "@libsql/client";
import { randomUUID } from "crypto";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const DRY_RUN = process.env.DRY_RUN === "1";
if (!url) {
  console.error("TURSO_DATABASE_URL not set");
  process.exit(1);
}
const db = createClient({ url, authToken });

function log(action: string, detail: string) {
  console.log(`  ${DRY_RUN ? "[DRY-RUN] " : ""}${action}: ${detail}`);
}

// ── 1. Re-price ₦0 subscriptions ──────────────────────────────────────────────
async function repriceSubscriptions() {
  const rows = await db.execute(
    `SELECT id, creator_id, tier FROM subscriptions WHERE status = 'active' AND amount = 0`,
  );
  for (const s of rows.rows) {
    const id = String(s.id);
    const creatorId = String(s.creator_id);
    const tier = String(s.tier ?? "subscriber");

    const priced = await db.execute({
      sql: `SELECT
              COALESCE(
                NULLIF((SELECT subscription_price FROM creator_settings WHERE user_id = ?), 0),
                NULLIF((SELECT subscription_price FROM profiles WHERE user_id = ?), 0),
                0
              ) AS base_price,
              (SELECT subscription_plus_price FROM creator_settings WHERE user_id = ?) AS plus_price`,
      args: [creatorId, creatorId, creatorId],
    });
    const p = priced.rows[0];
    const base = Number(p?.base_price ?? 0);
    const plus = p?.plus_price == null ? base * 2 : Number(p.plus_price);
    const amount = tier === "subscriber_plus" ? plus : base;

    if (amount > 0) {
      if (!DRY_RUN) {
        await db.execute({
          sql: `UPDATE subscriptions SET amount = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
          args: [amount, id],
        });
      }
      log("reprice subscription", `${id} (${tier}) → ₦${amount}`);
    } else {
      log("reprice subscription (skip, creator unpriced)", `${id} (${tier})`);
    }
  }
}

// ── 2. Backfill comment_rooms.comment_count ───────────────────────────────────
async function backfillCommentCounts() {
  const mismatches = await db.execute(
    `SELECT cr.post_id, cr.comment_count AS room_count, p.comment_count AS posts_count
     FROM comment_rooms cr
     JOIN posts p ON p.id = cr.post_id
     WHERE cr.comment_count != p.comment_count`,
  );
  for (const m of mismatches.rows) {
    if (!DRY_RUN) {
      await db.execute({
        sql: `UPDATE comment_rooms
              SET comment_count = (SELECT comment_count FROM posts WHERE posts.id = comment_rooms.post_id),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE post_id = ?`,
        args: [String(m.post_id)],
      });
    }
    log("backfill comment count", `${m.post_id}: ${m.room_count} → ${m.posts_count}`);
  }
}

// ── 3. Migrate legacy conversations/messages → chat_rooms ─────────────────────
async function migrateLegacyMessages() {
  const convs = await db.execute(`SELECT * FROM conversations`);

  for (const conv of convs.rows) {
    const convId = String(conv.id);

    const membersRes = await db.execute({
      sql: `SELECT * FROM conversation_members WHERE conversation_id = ?`,
      args: [convId],
    });
    const msgsRes = await db.execute({
      sql: `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      args: [convId],
    });
    const members = membersRes.rows;
    const msgs = msgsRes.rows;

    // Only migrate real conversations (≥2 members or ≥1 message). Empty shells
    // from the old "new message" flow are skipped.
    if (members.length < 2 && msgs.length === 0) {
      log("skip empty legacy conversation", convId);
      continue;
    }

    const userIds = members.map((m) => String(m.user_id));
    let roomId: string | null = null;

    // Reuse an existing room for this exact pair if one already exists.
    if (userIds.length >= 2) {
      const existing = await db.execute({
        sql: `SELECT rm1.chat_room_id
              FROM chat_room_members rm1
              JOIN chat_room_members rm2 ON rm2.chat_room_id = rm1.chat_room_id
              WHERE rm1.user_id = ? AND rm2.user_id = ?
              LIMIT 1`,
        args: [userIds[0], userIds[1]],
      });
      roomId = existing.rows[0] ? String(existing.rows[0].chat_room_id) : null;
    }

    if (!roomId) {
      roomId = randomUUID();
      if (!DRY_RUN) {
        await db.execute({
          sql: `INSERT INTO chat_rooms (id, created_by, last_message_at, created_at, updated_at)
                VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          args: [
            roomId,
            conv.created_by ? String(conv.created_by) : userIds[0] ?? null,
            conv.last_message_at ? String(conv.last_message_at) : null,
          ],
        });
        for (const m of members) {
          const memberId = randomUUID();
          const contextId = randomUUID();
          await db.execute({
            sql: `INSERT INTO chat_room_members
                    (id, chat_room_id, user_id, context_id, is_muted, is_archived, cleared_at, last_read_at, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
            args: [
              memberId,
              roomId,
              String(m.user_id),
              contextId,
              Number(m.is_muted ?? 0),
              Number(m.is_archived ?? 0),
              m.cleared_at ? String(m.cleared_at) : null,
              m.last_read_at ? String(m.last_read_at) : null,
            ],
          });
        }
      }
      log("create chat room", `${convId} → ${roomId} (${userIds.length} members)`);
    } else {
      log("reuse existing chat room", `${convId} → ${roomId}`);
    }

    // Migrate messages (idempotent: skip ids already present).
    for (const msg of msgs) {
      const msgId = String(msg.id);
      const already = await db.execute({
        sql: `SELECT 1 FROM chat_room_messages WHERE id = ?`,
        args: [msgId],
      });
      if (already.rows.length > 0) {
        log("skip existing message", msgId);
        continue;
      }
      if (!DRY_RUN) {
        await db.execute({
          sql: `INSERT INTO chat_room_messages
                  (id, chat_room_id, sender_id, reply_to_id, body, media_url, media_type, caption,
                   file_name, file_size, mime_type, audio_duration, reactions, is_edited, is_recalled,
                   created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            msgId,
            roomId,
            String(msg.sender_id),
            msg.reply_to_id ? String(msg.reply_to_id) : null,
            msg.body ? String(msg.body) : null,
            msg.media_url ? String(msg.media_url) : null,
            msg.media_type ? String(msg.media_type) : null,
            msg.caption ? String(msg.caption) : null,
            msg.file_name ? String(msg.file_name) : null,
            msg.file_size != null ? Number(msg.file_size) : null,
            msg.mime_type ? String(msg.mime_type) : null,
            msg.audio_duration != null ? Number(msg.audio_duration) : null,
            msg.reactions ? String(msg.reactions) : null,
            Number(msg.is_edited ?? 0),
            Number(msg.is_recalled ?? 0),
            String(msg.created_at),
            String(msg.updated_at ?? msg.created_at),
            msg.deleted_at ? String(msg.deleted_at) : null,
          ],
        });
      }
      log("migrate message", `${msgId} → room ${roomId}`);
    }
  }
}

async function main() {
  console.log(`=== MeetSweet data repair ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);
  await repriceSubscriptions();
  await backfillCommentCounts();
  await migrateLegacyMessages();
  console.log(`\n=== repair complete ${DRY_RUN ? "(dry run — nothing written)" : ""} ===`);
  await db.close();
}

main().catch((e) => {
  console.error("Repair failed:", e);
  process.exit(1);
});
