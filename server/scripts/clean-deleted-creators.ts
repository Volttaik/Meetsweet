/**
 * Completes half-deleted accounts: any user whose `deleted_at` is set but
 * `is_active` is still 1 (an inconsistency) is fully deactivated and their
 * published posts/albums are soft-deleted so they stop leaking into feeds.
 *
 * Run with TURSO_DATABASE_URL / TURSO_AUTH_TOKEN set. DRY_RUN=1 to preview.
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

async function main() {
  console.log(`=== complete half-deleted accounts ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);
  const users = await db.execute(
    `SELECT id, username FROM users WHERE deleted_at IS NOT NULL AND is_active = 1`,
  );

  for (const u of users.rows) {
    const uid = String(u.id);
    const username = String(u.username);

    const posts = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM posts WHERE creator_id = ? AND deleted_at IS NULL`,
      args: [uid],
    });
    const albums = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM albums WHERE creator_id = ? AND deleted_at IS NULL`,
      args: [uid],
    });
    const postN = Number(posts.rows[0]?.n ?? 0);
    const albumN = Number(albums.rows[0]?.n ?? 0);

    console.log(`  ${DRY_RUN ? "[DRY-RUN] " : ""}${username}: deactivate + soft-delete ${postN} posts, ${albumN} albums`);

    if (!DRY_RUN) {
      await db.execute({
        sql: `UPDATE users SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        args: [uid],
      });
      await db.execute({
        sql: `UPDATE posts SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE creator_id = ? AND deleted_at IS NULL`,
        args: [uid],
      });
      await db.execute({
        sql: `UPDATE albums SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE creator_id = ? AND deleted_at IS NULL`,
        args: [uid],
      });
    }
  }

  console.log(`\n=== complete ${DRY_RUN ? "(dry run — nothing written)" : ""} ===`);
  await db.close();
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
