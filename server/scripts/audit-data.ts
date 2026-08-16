/**
 * Read-only data-integrity audit.
 *
 * Run with TURSO_DATABASE_URL / TURSO_AUTH_TOKEN set:
 *   cd server && TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/audit-data.ts
 *
 * Performs SELECT-only queries. Never writes.
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
    for (const row of r.rows.slice(0, 15)) {
      console.log("  " + JSON.stringify(row));
    }
    if (r.rows.length > 15) console.log(`  …(${r.rows.length - 15} more)`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log(`\n── ${label} ──`);
    console.log(`  ERROR: ${m}`);
  }
}

async function main() {
  console.log("=== MeetSweet data audit (read-only) ===");

  // 1. Dead tables — do they still hold rows?
  for (const t of [
    "post_views",
    "archives",
    "creator_statistics",
    "conversations",
    "conversation_members",
    "messages",
    "message_reads",
  ]) {
    await q(`dead table: ${t}`, `SELECT COUNT(*) AS n FROM ${t}`);
  }

  // 2. Masked legacy price: settings price 0/null but profile price > 0.
  await q(
    "creators: profile price > 0 but creator_settings price 0/null (masked price)",
    `SELECT u.username, p.subscription_price AS profile_price, cs.subscription_price AS settings_price
     FROM users u
     JOIN profiles p ON p.user_id = u.id
     LEFT JOIN creator_settings cs ON cs.user_id = u.id
     WHERE u.is_creator = 1
       AND p.subscription_price > 0
       AND (cs.subscription_price IS NULL OR cs.subscription_price = 0)
     LIMIT 20`,
  );

  // 3. Subscriber-gated posts whose creator has zero base price (unlockable for free).
  await q(
    "gated posts (tier subscriber/subscriber_plus) with creator price 0",
    `SELECT u.username, cs.subscription_price AS settings_price, p.subscription_price AS profile_price, COUNT(*) AS gated_posts
     FROM posts po
     JOIN users u ON u.id = po.creator_id
     LEFT JOIN creator_settings cs ON cs.user_id = u.id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE po.tier IN ('subscriber','subscriber_plus')
       AND po.status = 'published'
       AND po.deleted_at IS NULL
     GROUP BY u.id, u.username, cs.subscription_price, p.subscription_price
     HAVING COALESCE(NULLIF(cs.subscription_price,0), p.subscription_price, 0) = 0
     LIMIT 20`,
  );

  // 4. Comment count drift vs comment_rooms.
  await q(
    "posts where posts.comment_count != comment_rooms.comment_count",
    `SELECT COUNT(*) AS n FROM posts p
     JOIN comment_rooms cr ON cr.post_id = p.id
     WHERE p.comment_count != cr.comment_count`,
  );

  // 5. Like count drift vs post_likes.
  await q(
    "posts where posts.like_count != actual post_likes count",
    `SELECT COUNT(*) AS n FROM posts p
     WHERE p.like_count != (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id)`,
  );

  // 6. Save count drift vs saved_posts.
  await q(
    "posts where posts.save_count != actual saved_posts count",
    `SELECT COUNT(*) AS n FROM posts p
     WHERE p.save_count != (SELECT COUNT(*) FROM saved_posts sp WHERE sp.post_id = p.id)`,
  );

  // 7. Comment count drift vs actual non-deleted comments.
  await q(
    "posts where posts.comment_count != actual non-deleted comments",
    `SELECT COUNT(*) AS n FROM posts p
     WHERE p.comment_count != (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL)`,
  );

  // 8. Category post_count drift vs post_categories (published, non-deleted).
  await q(
    "categories where categories.post_count != actual published posts in category",
    `SELECT c.name, c.post_count AS stored,
            (SELECT COUNT(*) FROM post_categories pc
             JOIN posts p ON p.id = pc.post_id
             WHERE pc.category_id = c.id AND p.status='published' AND p.deleted_at IS NULL) AS actual
     FROM categories c
     WHERE c.post_count != (SELECT COUNT(*) FROM post_categories pc
             JOIN posts p ON p.id = pc.post_id
             WHERE pc.category_id = c.id AND p.status='published' AND p.deleted_at IS NULL)
     LIMIT 20`,
  );

  // 9. Wallets with negative balance.
  await q("wallets with negative balance", `SELECT COUNT(*) AS n FROM wallets WHERE balance < 0`);

  // 10. Duplicate active subscriptions (same subscriber+creator).
  await q(
    "duplicate active subscriptions (subscriber+creator)",
    `SELECT subscriber_id, creator_id, COUNT(*) AS n
     FROM subscriptions WHERE status='active'
     GROUP BY subscriber_id, creator_id HAVING COUNT(*) > 1 LIMIT 20`,
  );

  // 11. Subscription status distribution.
  await q(
    "subscription status distribution",
    `SELECT status, COUNT(*) AS n FROM subscriptions GROUP BY status`,
  );

  // 12. Orphaned subscriptions (creator_id not in users).
  await q(
    "subscriptions with missing creator user",
    `SELECT COUNT(*) AS n FROM subscriptions s
     LEFT JOIN users u ON u.id = s.creator_id WHERE u.id IS NULL`,
  );

  // 13. Active subscriptions with amount 0 but a priced creator.
  await q(
    "active subscriptions with amount 0",
    `SELECT COUNT(*) AS n FROM subscriptions WHERE status='active' AND amount = 0`,
  );

  // 14. Transaction status/type distribution.
  await q(
    "transaction type distribution",
    `SELECT type, status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM transactions GROUP BY type, status ORDER BY type`,
  );

  // 15. Wallets vs creators: creators without a wallet row.
  await q(
    "creators without a wallet row",
    `SELECT COUNT(*) AS n FROM users u
     WHERE u.is_creator = 1
       AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id)`,
  );

  console.log("\n=== audit complete ===");
  await db.close();
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(1);
});
