/**
 * audit-data-5.ts — comprehensive read-only integrity audit.
 * Covers half-delete inversions, stored-counter drift, invalid logical
 * states, and remaining orphan checks not in audit-data-3.ts.
 *
 * Run: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/audit-data-5.ts
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
    console.log(`\n── ${label} ──  rows: ${r.rows.length}`);
    for (const row of r.rows.slice(0, 20)) console.log("  " + JSON.stringify(row));
    if (r.rows.length > 20) console.log(`  …(${r.rows.length - 20} more)`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log(`\n── ${label} ──\n  ERROR: ${m}`);
  }
}

async function main() {
  console.log("=== MeetSweet half-state / counter-drift / orphan audit (read-only) ===\n");

  // ── A. Half-delete inversions ────────────────────────────────────────────
  await q(
    "A1 users: deleted_at set BUT is_active=1 (half-deleted)",
    `SELECT username, is_active, deleted_at FROM users WHERE deleted_at IS NOT NULL AND is_active=1`,
  );
  await q(
    "A2 users: is_active=0 BUT deleted_at null (deactivated w/o timestamp)",
    `SELECT username, is_active, deleted_at FROM users WHERE is_active=0 AND deleted_at IS NULL`,
  );
  await q(
    "A3 posts: deleted_at set BUT status still published",
    `SELECT id, creator_id, status, content_type, deleted_at FROM posts WHERE deleted_at IS NOT NULL AND status='published'`,
  );
  await q(
    "A4 posts: deleted_at set (all soft-deleted posts)",
    `SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NOT NULL`,
  );
  await q(
    "A5 albums: deleted_at set (soft-deleted albums)",
    `SELECT id, creator_id, title, deleted_at FROM albums WHERE deleted_at IS NOT NULL`,
  );
  await q(
    "A6 comments: deleted_at set",
    `SELECT COUNT(*) AS n FROM comments WHERE deleted_at IS NOT NULL`,
  );
  await q(
    "A7 comment_replies: deleted_at set",
    `SELECT COUNT(*) AS n FROM comment_replies WHERE deleted_at IS NOT NULL`,
  );

  // ── B. Stored-counter drift (counter vs actual rows) ─────────────────────
  await q(
    "B1 posts.like_count vs post_likes",
    `SELECT p.id, p.like_count, (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id) AS actual
     FROM posts p WHERE p.deleted_at IS NULL AND p.like_count != (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id)`,
  );
  await q(
    "B2 posts.comment_count vs comments",
    `SELECT p.id, p.comment_count, (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS actual
     FROM posts p WHERE p.deleted_at IS NULL AND p.comment_count != (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL)`,
  );
  await q(
    "B3 posts.save_count vs saved_posts",
    `SELECT p.id, p.save_count, (SELECT COUNT(*) FROM saved_posts sp WHERE sp.post_id=p.id) AS actual
     FROM posts p WHERE p.deleted_at IS NULL AND p.save_count != (SELECT COUNT(*) FROM saved_posts sp WHERE sp.post_id=p.id)`,
  );
  await q(
    "B4 albums.item_count vs album_items",
    `SELECT a.id, a.item_count, (SELECT COUNT(*) FROM album_items ai WHERE ai.album_id=a.id) AS actual
     FROM albums a WHERE a.deleted_at IS NULL AND a.item_count != (SELECT COUNT(*) FROM album_items ai WHERE ai.album_id=a.id)`,
  );
  await q(
    "B5 comments.reply_count vs comment_replies",
    `SELECT c.id, c.reply_count, (SELECT COUNT(*) FROM comment_replies r WHERE r.comment_id=c.id AND r.deleted_at IS NULL) AS actual
     FROM comments c WHERE c.deleted_at IS NULL AND c.reply_count != (SELECT COUNT(*) FROM comment_replies r WHERE r.comment_id=c.id AND r.deleted_at IS NULL)`,
  );
  await q(
    "B6 comments.like_count vs comment_likes",
    `SELECT c.id, c.like_count, (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id=c.id) AS actual
     FROM comments c WHERE c.deleted_at IS NULL AND c.like_count != (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id=c.id)`,
  );
  // ── C. Invalid logical states ────────────────────────────────────────────
  await q(
    "C1 active subscriptions with amount=0",
    `SELECT id, subscriber_id, creator_id, tier, amount, status FROM subscriptions WHERE status='active' AND amount<=0`,
  );
  await q(
    "C2 active subscriptions with null started_at",
    `SELECT id, subscriber_id, creator_id, tier, started_at FROM subscriptions WHERE status='active' AND started_at IS NULL`,
  );
  await q(
    "C3 subscriptions with null tier",
    `SELECT id, subscriber_id, creator_id, tier, status FROM subscriptions WHERE tier IS NULL`,
  );
  await q(
    "C4 completed/success transactions with null reference",
    `SELECT id, user_id, type, amount, status, reference, paystack_ref FROM transactions WHERE status IN ('success','completed') AND reference IS NULL AND paystack_ref IS NULL`,
  );
  await q(
    "C5 posts: visibility=draft BUT status=published",
    `SELECT id, creator_id, visibility, status FROM posts WHERE visibility='draft' AND status='published'`,
  );
  await q(
    "C6 posts: visibility=subscribers with null tier",
    `SELECT id, creator_id, visibility, tier FROM posts WHERE visibility='subscribers' AND tier IS NULL AND deleted_at IS NULL`,
  );
  await q(
    "C7 wallets with negative balance",
    `SELECT user_id, balance FROM wallets WHERE balance < 0`,
  );

  // ── D. Remaining orphans (not in audit-data-3) ───────────────────────────
  await q("D1 saved_posts missing user", `SELECT COUNT(*) AS n FROM saved_posts sp LEFT JOIN users u ON u.id=sp.user_id WHERE u.id IS NULL`);
  await q("D2 post_likes missing user", `SELECT COUNT(*) AS n FROM post_likes pl LEFT JOIN users u ON u.id=pl.user_id WHERE u.id IS NULL`);
  await q("D3 hidden_posts missing post", `SELECT COUNT(*) AS n FROM hidden_posts h LEFT JOIN posts p ON p.id=h.post_id WHERE p.id IS NULL`);
  await q("D4 hidden_posts missing user", `SELECT COUNT(*) AS n FROM hidden_posts h LEFT JOIN users u ON u.id=h.user_id WHERE u.id IS NULL`);
  await q("D5 comment_likes missing comment", `SELECT COUNT(*) AS n FROM comment_likes cl LEFT JOIN comments c ON c.id=cl.comment_id WHERE cl.comment_id IS NOT NULL AND c.id IS NULL`);
  await q("D6 comment_replies missing author", `SELECT COUNT(*) AS n FROM comment_replies r LEFT JOIN users u ON u.id=r.author_id WHERE u.id IS NULL`);
  await q("D7 chat_room_messages missing room", `SELECT COUNT(*) AS n FROM chat_room_messages m LEFT JOIN chat_rooms r ON r.id=m.chat_room_id WHERE r.id IS NULL`);
  await q("D8 chat_room_messages missing sender", `SELECT COUNT(*) AS n FROM chat_room_messages m LEFT JOIN users u ON u.id=m.sender_id WHERE u.id IS NULL`);
  await q("D9 chat_room_members missing room", `SELECT COUNT(*) AS n FROM chat_room_members m LEFT JOIN chat_rooms r ON r.id=m.chat_room_id WHERE r.id IS NULL`);
  await q("D10 chat_room_members missing user", `SELECT COUNT(*) AS n FROM chat_room_members m LEFT JOIN users u ON u.id=m.user_id WHERE u.id IS NULL`);
  await q("D11 notifications missing actor", `SELECT COUNT(*) AS n FROM notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE n.actor_id IS NOT NULL AND u.id IS NULL`);
  await q("D12 refresh_tokens missing user", `SELECT COUNT(*) AS n FROM refresh_tokens t LEFT JOIN users u ON u.id=t.user_id WHERE u.id IS NULL`);
  await q("D13 sessions missing user", `SELECT COUNT(*) AS n FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL`);
  await q("D14 reports missing reporter", `SELECT COUNT(*) AS n FROM reports r LEFT JOIN users u ON u.id=r.reporter_id WHERE u.id IS NULL`);
  await q("D15 blocked_users missing users", `SELECT COUNT(*) AS n FROM blocked_users b LEFT JOIN users u1 ON u1.id=b.blocker_id LEFT JOIN users u2 ON u2.id=b.blocked_id WHERE u1.id IS NULL OR u2.id IS NULL`);
  await q("D16 muted_users missing users", `SELECT COUNT(*) AS n FROM muted_users m LEFT JOIN users u1 ON u1.id=m.muter_id LEFT JOIN users u2 ON u2.id=m.muted_id WHERE u1.id IS NULL OR u2.id IS NULL`);
  await q("D17 recent_searches missing user", `SELECT COUNT(*) AS n FROM recent_searches s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL`);
  await q("D18 creator_reviews missing creator/reviewer", `SELECT COUNT(*) AS n FROM creator_reviews r LEFT JOIN users u1 ON u1.id=r.creator_id LEFT JOIN users u2 ON u2.id=r.reviewer_id WHERE u1.id IS NULL OR u2.id IS NULL`);
  await q("D19 user_settings missing user", `SELECT COUNT(*) AS n FROM user_settings s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL`);
  await q("D20 verification_codes missing user", `SELECT COUNT(*) AS n FROM verification_codes v LEFT JOIN users u ON u.id=v.user_id WHERE u.id IS NULL`);
  await q("D21 credential_grants missing user", `SELECT COUNT(*) AS n FROM credential_grants g LEFT JOIN users u ON u.id=g.user_id WHERE u.id IS NULL`);
  await q("D22 follows self-follow", `SELECT COUNT(*) AS n FROM follows WHERE follower_id = following_id`);
  await q("D23 subscriptions self-subscribe", `SELECT COUNT(*) AS n FROM subscriptions WHERE subscriber_id = creator_id`);
  await q("D24 blocked self", `SELECT COUNT(*) AS n FROM blocked_users WHERE blocker_id = blocked_id`);

  // ── E. Table row counts (baseline) ───────────────────────────────────────
  const tables = [
    "users", "profiles", "user_settings", "posts", "media", "post_likes", "saved_posts",
    "hidden_posts", "categories", "post_categories", "albums", "album_items", "album_unlocks",
    "creator_reviews", "shares", "follows", "blocked_users", "muted_users", "recent_searches",
    "comments", "comment_replies", "comment_likes", "comment_rooms", "reports", "chat_rooms",
    "chat_room_members", "chat_room_messages", "notifications", "wallets", "transactions",
    "subscriptions", "creator_settings", "devices", "refresh_tokens", "sessions", "login_history",
  ];
  for (const t of tables) {
    try {
      const r = await db.execute(`SELECT COUNT(*) AS n FROM ${t}`);
      const n = (r.rows[0] as unknown as { n?: number } | undefined)?.n ?? "?";
      console.log(`  ${t}: ${n}`);
    } catch {
      console.log(`  ${t}: (missing table)`);
    }
  }

  console.log("\n=== audit complete ===");
  await db.close();
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(1);
});
