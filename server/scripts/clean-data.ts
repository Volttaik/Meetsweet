/**
 * Data cleanup — removes the bad rows identified in the audit.
 *
 * Run with TURSO_DATABASE_URL / TURSO_AUTH_TOKEN set:
 *   cd server && TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/clean-data.ts
 *
 * Preview without writing:
 *   DRY_RUN=1 npx tsx scripts/clean-data.ts
 *
 * Actions (each logged with before/after counts):
 *   1. Backfill comment_rooms.comment_count from posts.comment_count.
 *   2. Delete ₦0 active subscriptions (free access from the pricing bug).
 *   3. Delete stuck pending wallet top-up transactions.
 *   4. Delete legacy messages / conversation_members / conversations.
 *   5. Delete post_views rows (write-only dead table).
 */

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const DRY_RUN = process.env.DRY_RUN === "1";
if (!url) {
  console.error("TURSO_DATABASE_URL not set");
  process.exit(1);
}
const db = createClient({ url, authToken });

async function count(sql: string): Promise<number> {
  const r = await db.execute(sql);
  return Number(r.rows[0]?.n ?? 0);
}

async function del(label: string, countSql: string, deleteSql: string): Promise<void> {
  const before = await count(countSql);
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] ${label}: ${before} row(s)`);
    return;
  }
  await db.execute(deleteSql);
  const after = await count(countSql);
  console.log(`  ${label}: deleted ${before - after} row(s)`);
}

async function main() {
  console.log(`=== MeetSweet data cleanup ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);

  // 1. Backfill comment counts (fix drift).
  const driftBefore = await count(
    `SELECT COUNT(*) AS n FROM comment_rooms cr JOIN posts p ON p.id = cr.post_id WHERE cr.comment_count != p.comment_count`,
  );
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] backfill comment_rooms.comment_count: ${driftBefore} row(s)`);
  } else {
    await db.execute(
      `UPDATE comment_rooms
       SET comment_count = (SELECT comment_count FROM posts WHERE posts.id = comment_rooms.post_id),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE comment_count != (SELECT comment_count FROM posts WHERE posts.id = comment_rooms.post_id)`,
    );
    console.log(`  backfill comment_rooms.comment_count: fixed ${driftBefore} row(s)`);
  }

  // 2. Delete ₦0 active subscriptions.
  await del(
    "delete ₦0 subscriptions",
    `SELECT COUNT(*) AS n FROM subscriptions WHERE status='active' AND amount=0`,
    `DELETE FROM subscriptions WHERE status='active' AND amount=0`,
  );

  // 3. Delete stuck pending top-ups.
  await del(
    "delete pending top-up transactions",
    `SELECT COUNT(*) AS n FROM transactions WHERE type='credit' AND status='pending'`,
    `DELETE FROM transactions WHERE type='credit' AND status='pending'`,
  );

  // 4. Delete legacy messaging (messages → members → conversations).
  await del("delete legacy messages", `SELECT COUNT(*) AS n FROM messages`, `DELETE FROM messages`);
  await del("delete legacy conversation_members", `SELECT COUNT(*) AS n FROM conversation_members`, `DELETE FROM conversation_members`);
  await del("delete legacy conversations", `SELECT COUNT(*) AS n FROM conversations`, `DELETE FROM conversations`);

  // 5. Delete post_views (write-only dead table).
  await del("delete post_views rows", `SELECT COUNT(*) AS n FROM post_views`, `DELETE FROM post_views`);

  console.log(`\n=== cleanup complete ${DRY_RUN ? "(dry run — nothing written)" : ""} ===`);
  await db.close();
}

main().catch((e) => {
  console.error("Cleanup failed:", e);
  process.exit(1);
});
