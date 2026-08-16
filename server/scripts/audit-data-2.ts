/**
 * Read-only deep dive (SELECT only).
 * Run with TURSO_DATABASE_URL / TURSO_AUTH_TOKEN set.
 */

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL not set");
  process.exit(1);
}
const db = createClient({ url, authToken });

async function q(label: string, sql: string): Promise<void> {
  try {
    const r = await db.execute(sql);
    console.log(`\n── ${label} ──`);
    console.log(`rows: ${r.rows.length}`);
    for (const row of r.rows.slice(0, 30)) console.log("  " + JSON.stringify(row));
    if (r.rows.length > 30) console.log(`  …(${r.rows.length - 30} more)`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log(`\n── ${label} ──`);
    console.log(`  ERROR: ${m}`);
  }
}

async function main() {
  console.log("=== MeetSweet deep-dive audit (read-only) ===");

  await q("subscriptions (all)", `SELECT * FROM subscriptions`);

  await q("wallets (all)", `SELECT w.id, u.username, w.balance, w.currency FROM wallets w LEFT JOIN users u ON u.id = w.user_id`);

  await q("transactions (all)", `SELECT * FROM transactions ORDER BY created_at`);

  await q(
    "comment-count drift posts",
    `SELECT p.id AS post_id, u.username, p.comment_count AS posts_count, cr.comment_count AS room_count
     FROM posts p
     JOIN comment_rooms cr ON cr.post_id = p.id
     JOIN users u ON u.id = p.creator_id
     WHERE p.comment_count != cr.comment_count`,
  );

  await q("chat_rooms count", `SELECT COUNT(*) AS n FROM chat_rooms`);
  await q("chat_room_members count", `SELECT COUNT(*) AS n FROM chat_room_members`);
  await q("chat_room_messages count", `SELECT COUNT(*) AS n FROM chat_room_messages`);

  await q("legacy conversations", `SELECT id, created_by, type, last_message_at, created_at FROM conversations`);
  await q("legacy conversation_members", `SELECT * FROM conversation_members`);
  await q("legacy messages", `SELECT id, conversation_id, sender_id, body, created_at FROM messages`);

  await q("users summary (creators)", `SELECT id, username, is_creator, is_active, created_at FROM users ORDER BY created_at`);

  await q(
    "creators + their prices",
    `SELECT u.username, p.subscription_price AS profile_price, cs.subscription_price AS settings_price, cs.subscription_plus_price AS plus_price
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN creator_settings cs ON cs.user_id = u.id
     WHERE u.is_creator = 1`,
  );

  await q(
    "posts summary by tier",
    `SELECT tier, COUNT(*) AS n FROM posts WHERE deleted_at IS NULL AND status='published' GROUP BY tier`,
  );

  console.log("\n=== deep-dive complete ===");
  await db.close();
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
