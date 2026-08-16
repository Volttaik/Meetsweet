/**
 * Focused investigation (read-only).
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
  const r = await db.execute(sql);
  console.log(`\n── ${label} ── (rows: ${r.rows.length})`);
  for (const row of r.rows.slice(0, 40)) console.log("  " + JSON.stringify(row));
}

async function main() {
  console.log("=== investigation ===");
  await q("total users", `SELECT COUNT(*) AS n FROM users`);
  await q("all users (full status)", `SELECT id, username, is_creator, is_active, deleted_at, created_at FROM users ORDER BY created_at`);
  await q(
    "posts whose creator is deleted/inactive",
    `SELECT p.id, p.creator_id, u.username, u.is_active, u.deleted_at, p.status, p.content_type, p.published_at
     FROM posts p JOIN users u ON u.id = p.creator_id
     WHERE u.deleted_at IS NOT NULL OR u.is_active = 0
     ORDER BY p.published_at DESC`,
  );
  await q(
    "posts by creator (all)",
    `SELECT p.creator_id, u.username, u.is_active, COUNT(*) AS posts
     FROM posts p JOIN users u ON u.id=p.creator_id
     GROUP BY p.creator_id, u.username, u.is_active`,
  );
  await db.close();
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
