import { createClient } from "@libsql/client";

const TABLES = [
  "notifications", "comment_likes", "comment_replies",
  "comments", "post_unlocks", "album_unlocks", "album_items", "albums",
  "post_categories", "post_likes", "saved_posts", "media", "posts", "shares",
  "creator_reviews", "creator_settings", "transactions",
  "wallets", "subscriptions", "follows", "blocked_users", "muted_users",
  "recent_searches", "reports", "refresh_tokens", "sessions",
  "verification_codes", "user_settings", "profiles", "users", "categories",
];

(async () => {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) { console.error("TURSO_DATABASE_URL not set"); process.exit(1); }

  const db = createClient({ url, authToken });

  await db.execute("PRAGMA foreign_keys = OFF");

  for (const t of TABLES) {
    try {
      const r = await db.execute(`DELETE FROM ${t}`);
      console.log(`  ✓  ${t} — ${r.rowsAffected ?? 0} rows deleted`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("no such table")) {
        console.log(`  ─  ${t} (table does not exist, skipped)`);
      } else {
        console.error(`  ✗  ${t}: ${m}`);
      }
    }
  }

  await db.execute("PRAGMA foreign_keys = ON");
  await db.close();
  console.log("\n✓  Database wiped — clean slate.");
})();
