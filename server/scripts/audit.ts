/**
 * audit.ts — consolidated data-integrity gate (read-only).
 *
 * Runs the actionable integrity checks (half-delete inversions, counter drift,
 * orphans, invalid logical states) and EXITS NON-ZERO if any finding is present,
 * so it can gate a deploy/CI step.
 *
 * Usage:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/audit.ts
 *   pnpm audit:data
 *
 * Read-only — never writes. Exit code 0 = clean, 1 = findings found.
 *
 * See scripts/audit-data-3.ts and audit-data-5.ts for the detailed,
 * always-report versions of these checks.
 */
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL not set");
  process.exit(2);
}
const db = createClient({ url, authToken });

type Check = { label: string; sql: string };

const CHECKS: Check[] = [
  // ── Half-delete inversions ─────────────────────────────────────────────
  { label: "users: deleted_at set but is_active=1", sql: `SELECT id, username FROM users WHERE deleted_at IS NOT NULL AND is_active=1` },
  { label: "users: is_active=0 but deleted_at null", sql: `SELECT id, username FROM users WHERE is_active=0 AND deleted_at IS NULL` },

  // ── Stored-counter drift ───────────────────────────────────────────────
  { label: "posts.like_count != post_likes", sql: `SELECT p.id FROM posts p WHERE p.deleted_at IS NULL AND p.like_count != (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id)` },
  { label: "posts.comment_count != comments", sql: `SELECT p.id FROM posts p WHERE p.deleted_at IS NULL AND p.comment_count != (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL)` },
  { label: "posts.save_count != saved_posts", sql: `SELECT p.id FROM posts p WHERE p.deleted_at IS NULL AND p.save_count != (SELECT COUNT(*) FROM saved_posts sp WHERE sp.post_id=p.id)` },
  { label: "albums.item_count != album_items", sql: `SELECT a.id FROM albums a WHERE a.deleted_at IS NULL AND a.item_count != (SELECT COUNT(*) FROM album_items ai WHERE ai.album_id=a.id)` },
  { label: "comments.reply_count != comment_replies", sql: `SELECT c.id FROM comments c WHERE c.deleted_at IS NULL AND c.reply_count != (SELECT COUNT(*) FROM comment_replies r WHERE r.comment_id=c.id AND r.deleted_at IS NULL)` },
  { label: "comments.like_count != comment_likes", sql: `SELECT c.id FROM comments c WHERE c.deleted_at IS NULL AND c.like_count != (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id=c.id)` },

  // ── Orphans (referential integrity) ────────────────────────────────────
  { label: "posts with missing creator", sql: `SELECT p.id FROM posts p LEFT JOIN users u ON u.id=p.creator_id WHERE u.id IS NULL` },
  { label: "media with missing post", sql: `SELECT m.id FROM media m LEFT JOIN posts p ON p.id=m.post_id WHERE m.post_id IS NOT NULL AND p.id IS NULL` },
  { label: "comments with missing post", sql: `SELECT c.id FROM comments c LEFT JOIN posts p ON p.id=c.post_id WHERE p.id IS NULL` },
  { label: "comments with missing author", sql: `SELECT c.id FROM comments c LEFT JOIN users u ON u.id=c.author_id WHERE u.id IS NULL` },
  { label: "comment_replies with missing comment", sql: `SELECT r.id FROM comment_replies r LEFT JOIN comments c ON c.id=r.comment_id WHERE c.id IS NULL` },
  { label: "post_likes with missing post", sql: `SELECT pl.id FROM post_likes pl LEFT JOIN posts p ON p.id=pl.post_id WHERE p.id IS NULL` },
  { label: "saved_posts with missing post", sql: `SELECT sp.id FROM saved_posts sp LEFT JOIN posts p ON p.id=sp.post_id WHERE p.id IS NULL` },
  { label: "follows with missing users", sql: `SELECT f.id FROM follows f LEFT JOIN users u1 ON u1.id=f.follower_id LEFT JOIN users u2 ON u2.id=f.following_id WHERE u1.id IS NULL OR u2.id IS NULL` },
  { label: "devices with missing user", sql: `SELECT d.id FROM devices d LEFT JOIN users u ON u.id=d.user_id WHERE u.id IS NULL` },
  { label: "albums with missing creator", sql: `SELECT a.id FROM albums a LEFT JOIN users u ON u.id=a.creator_id WHERE u.id IS NULL` },
  { label: "album_items with missing album/media", sql: `SELECT ai.id FROM album_items ai LEFT JOIN albums a ON a.id=ai.album_id LEFT JOIN media m ON m.id=ai.media_id WHERE a.id IS NULL OR m.id IS NULL` },
  { label: "subscriptions with missing subscriber", sql: `SELECT s.id FROM subscriptions s LEFT JOIN users u ON u.id=s.subscriber_id WHERE u.id IS NULL` },
  { label: "subscriptions with missing creator", sql: `SELECT s.id FROM subscriptions s LEFT JOIN users u ON u.id=s.creator_id WHERE u.id IS NULL` },
  { label: "transactions with missing user", sql: `SELECT t.id FROM transactions t LEFT JOIN users u ON u.id=t.user_id WHERE u.id IS NULL` },
  { label: "profiles with missing user", sql: `SELECT p.id FROM profiles p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL` },
  { label: "comment_rooms with missing post", sql: `SELECT cr.id FROM comment_rooms cr LEFT JOIN posts p ON p.id=cr.post_id WHERE p.id IS NULL` },
  { label: "post_categories with missing post/category", sql: `SELECT pc.id FROM post_categories pc LEFT JOIN posts p ON p.id=pc.post_id LEFT JOIN categories c ON c.id=pc.category_id WHERE p.id IS NULL OR c.id IS NULL` },
  { label: "chat_room_messages with missing room", sql: `SELECT m.id FROM chat_room_messages m LEFT JOIN chat_rooms r ON r.id=m.chat_room_id WHERE r.id IS NULL` },
  { label: "chat_room_messages with missing sender", sql: `SELECT m.id FROM chat_room_messages m LEFT JOIN users u ON u.id=m.sender_id WHERE u.id IS NULL` },
  { label: "chat_room_members with missing room", sql: `SELECT m.id FROM chat_room_members m LEFT JOIN chat_rooms r ON r.id=m.chat_room_id WHERE r.id IS NULL` },
  { label: "chat_room_members with missing user", sql: `SELECT m.id FROM chat_room_members m LEFT JOIN users u ON u.id=m.user_id WHERE u.id IS NULL` },
  { label: "notifications with missing user", sql: `SELECT n.id FROM notifications n LEFT JOIN users u ON u.id=n.user_id WHERE u.id IS NULL` },

  // ── Duplicates (unique violations) ─────────────────────────────────────
  { label: "duplicate wallets per user", sql: `SELECT user_id, COUNT(*) AS n FROM wallets GROUP BY user_id HAVING COUNT(*)>1` },
  { label: "duplicate profiles per user", sql: `SELECT user_id, COUNT(*) AS n FROM profiles GROUP BY user_id HAVING COUNT(*)>1` },
  { label: "duplicate creator_settings per user", sql: `SELECT user_id, COUNT(*) AS n FROM creator_settings GROUP BY user_id HAVING COUNT(*)>1` },

  // ── Invalid logical states ─────────────────────────────────────────────
  { label: "posts with invalid tier", sql: `SELECT id FROM posts WHERE tier NOT IN ('free','subscriber','subscriber_plus') AND tier IS NOT NULL` },
  { label: "posts with invalid status", sql: `SELECT id FROM posts WHERE status NOT IN ('draft','published')` },
  { label: "posts with invalid visibility", sql: `SELECT id FROM posts WHERE visibility NOT IN ('public','subscribers','draft')` },
  { label: "subscriptions with invalid tier", sql: `SELECT id FROM subscriptions WHERE tier NOT IN ('subscriber','subscriber_plus') AND tier IS NOT NULL` },
  { label: "subscriptions with invalid status", sql: `SELECT id FROM subscriptions WHERE status NOT IN ('active','pending','cancelled','expired')` },
  { label: "transactions with invalid status", sql: `SELECT id FROM transactions WHERE status NOT IN ('pending','processing','success','completed','failed')` },
  { label: "active subscriptions with amount<=0", sql: `SELECT id FROM subscriptions WHERE status='active' AND amount<=0` },
  { label: "active subscriptions with null started_at", sql: `SELECT id FROM subscriptions WHERE status='active' AND started_at IS NULL` },
  { label: "published posts with null published_at", sql: `SELECT id FROM posts WHERE status='published' AND published_at IS NULL` },
  { label: "wallets with negative balance", sql: `SELECT user_id FROM wallets WHERE balance < 0` },
  { label: "users role/is_creator mismatch", sql: `SELECT id, username FROM users WHERE (role='creator' AND is_creator=0) OR (role!='creator' AND is_creator=1)` },
];

async function main() {
  console.log("=== MeetSweet data-integrity gate (read-only) ===\n");
  let findings = 0;

  for (const check of CHECKS) {
    try {
      const r = await db.execute(check.sql);
      if (r.rows.length > 0) {
        findings += r.rows.length;
        console.log(`  ✗ ${check.label} — ${r.rows.length} row(s)`);
        for (const row of r.rows.slice(0, 3)) console.log("      " + JSON.stringify(row));
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // Missing tables/columns mean the schema drifted from this script — that's a finding too.
      findings += 1;
      console.log(`  ✗ ${check.label} — ERROR: ${m}`);
    }
  }

  console.log(`\n${findings === 0 ? "✓ Clean — no integrity findings." : `✗ ${findings} finding(s) found.`}`);
  await db.close();
  process.exit(findings === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(2);
});
