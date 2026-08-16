/**
 * Referential-integrity + logical-consistency audit (read-only).
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
    for (const row of r.rows.slice(0, 12)) console.log("  " + JSON.stringify(row));
    if (r.rows.length > 12) console.log(`  …(${r.rows.length - 12} more)`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log(`\n── ${label} ──`);
    console.log(`  ERROR: ${m}`);
  }
}

async function main() {
  console.log("=== MeetSweet referential-integrity audit (read-only) ===\n");

  // ── Orphans: rows referencing missing parents ─────────────────────────────
  await q("posts with missing creator", `SELECT COUNT(*) AS n FROM posts p LEFT JOIN users u ON u.id=p.creator_id WHERE u.id IS NULL`);
  await q("posts with deleted creator", `SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id=p.creator_id WHERE u.deleted_at IS NOT NULL OR u.is_active=0`);
  await q("media with missing uploader", `SELECT COUNT(*) AS n FROM media m LEFT JOIN users u ON u.id=m.uploader_id WHERE u.id IS NULL`);
  await q("media with missing post", `SELECT COUNT(*) AS n FROM media m LEFT JOIN posts p ON p.id=m.post_id WHERE m.post_id IS NOT NULL AND p.id IS NULL`);
  await q("comments with missing post", `SELECT COUNT(*) AS n FROM comments c LEFT JOIN posts p ON p.id=c.post_id WHERE p.id IS NULL`);
  await q("comments with missing author", `SELECT COUNT(*) AS n FROM comments c LEFT JOIN users u ON u.id=c.author_id WHERE u.id IS NULL`);
  await q("comment_replies with missing comment", `SELECT COUNT(*) AS n FROM comment_replies r LEFT JOIN comments c ON c.id=r.comment_id WHERE c.id IS NULL`);
  await q("post_likes with missing post", `SELECT COUNT(*) AS n FROM post_likes pl LEFT JOIN posts p ON p.id=pl.post_id WHERE p.id IS NULL`);
  await q("saved_posts with missing post", `SELECT COUNT(*) AS n FROM saved_posts sp LEFT JOIN posts p ON p.id=sp.post_id WHERE p.id IS NULL`);
  await q("follows with missing users", `SELECT COUNT(*) AS n FROM follows f LEFT JOIN users u1 ON u1.id=f.follower_id LEFT JOIN users u2 ON u2.id=f.following_id WHERE u1.id IS NULL OR u2.id IS NULL`);
  await q("devices with missing user", `SELECT COUNT(*) AS n FROM devices d LEFT JOIN users u ON u.id=d.user_id WHERE u.id IS NULL`);
  await q("albums with missing creator", `SELECT COUNT(*) AS n FROM albums a LEFT JOIN users u ON u.id=a.creator_id WHERE u.id IS NULL`);
  await q("album_items with missing album/media", `SELECT COUNT(*) AS n FROM album_items ai LEFT JOIN albums a ON a.id=ai.album_id LEFT JOIN media m ON m.id=ai.media_id WHERE a.id IS NULL OR m.id IS NULL`);
  await q("album_unlocks with missing album", `SELECT COUNT(*) AS n FROM album_unlocks au LEFT JOIN albums a ON a.id=au.album_id WHERE a.id IS NULL`);
  await q("subscriptions with missing subscriber", `SELECT COUNT(*) AS n FROM subscriptions s LEFT JOIN users u ON u.id=s.subscriber_id WHERE u.id IS NULL`);
  await q("notifications with missing user/actor", `SELECT COUNT(*) AS n FROM notifications n LEFT JOIN users u ON u.id=n.user_id WHERE u.id IS NULL`);
  await q("transactions with missing user", `SELECT COUNT(*) AS n FROM transactions t LEFT JOIN users u ON u.id=t.user_id WHERE u.id IS NULL`);
  await q("profiles with missing user", `SELECT COUNT(*) AS n FROM profiles p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL`);
  await q("users without a profiles row", `SELECT COUNT(*) AS n FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE p.id IS NULL`);
  await q("creator_settings with missing user", `SELECT COUNT(*) AS n FROM creator_settings cs LEFT JOIN users u ON u.id=cs.user_id WHERE u.id IS NULL`);
  await q("comment_rooms with missing post", `SELECT COUNT(*) AS n FROM comment_rooms cr LEFT JOIN posts p ON p.id=cr.post_id WHERE p.id IS NULL`);
  await q("post_categories with missing post/category", `SELECT COUNT(*) AS n FROM post_categories pc LEFT JOIN posts p ON p.id=pc.post_id LEFT JOIN categories c ON c.id=pc.category_id WHERE p.id IS NULL OR c.id IS NULL`);

  // ── Invalid enum / data values ────────────────────────────────────────────
  await q("posts with invalid tier", `SELECT tier, COUNT(*) AS n FROM posts WHERE tier NOT IN ('free','subscriber','subscriber_plus') AND tier IS NOT NULL GROUP BY tier`);
  await q("posts with invalid content_type", `SELECT content_type, COUNT(*) AS n FROM posts WHERE content_type NOT IN ('post','video','short','album') GROUP BY content_type`);
  await q("posts with invalid visibility", `SELECT visibility, COUNT(*) AS n FROM posts WHERE visibility NOT IN ('public','subscribers','draft') GROUP BY visibility`);
  await q("posts with invalid status", `SELECT status, COUNT(*) AS n FROM posts WHERE status NOT IN ('draft','published') GROUP BY status`);
  await q("subscriptions with invalid tier", `SELECT tier, COUNT(*) AS n FROM subscriptions WHERE tier NOT IN ('subscriber','subscriber_plus') AND tier IS NOT NULL GROUP BY tier`);
  await q("subscriptions with invalid status", `SELECT status, COUNT(*) AS n FROM subscriptions WHERE status NOT IN ('active','pending','cancelled','expired') GROUP BY status`);
  await q("users role vs is_creator mismatch", `SELECT username, role, is_creator FROM users WHERE (role='creator' AND is_creator=0) OR (role!='creator' AND is_creator=1)`);

  // ── Logical consistency ────────────────────────────────────────────────────
  await q("active subscriptions already expired", `SELECT COUNT(*) AS n FROM subscriptions WHERE status='active' AND expires_at IS NOT NULL AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  await q("published posts with null published_at", `SELECT COUNT(*) AS n FROM posts WHERE status='published' AND published_at IS NULL`);
  await q("posts with negative counters", `SELECT COUNT(*) AS n FROM posts WHERE view_count<0 OR like_count<0 OR comment_count<0 OR save_count<0 OR share_count<0`);
  await q("comments with negative like_count", `SELECT COUNT(*) AS n FROM comments WHERE like_count<0`);
  await q("transactions with non-positive amount", `SELECT COUNT(*) AS n FROM transactions WHERE amount <= 0`);
  await q("transactions with invalid status", `SELECT status, COUNT(*) AS n FROM transactions WHERE status NOT IN ('pending','success','failed','processing','completed') GROUP BY status`);
  await q("duplicate wallets per user", `SELECT user_id, COUNT(*) AS n FROM wallets GROUP BY user_id HAVING COUNT(*)>1`);
  await q("duplicate profiles per user", `SELECT user_id, COUNT(*) AS n FROM profiles GROUP BY user_id HAVING COUNT(*)>1`);
  await q("duplicate creator_settings per user", `SELECT user_id, COUNT(*) AS n FROM creator_settings GROUP BY user_id HAVING COUNT(*)>1`);

  console.log("\n=== referential-integrity audit complete ===");
  await db.close();
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(1);
});
