/**
 * migrate-comment-threading.ts
 *
 * Unified threaded comments migration. Before this, top-level comments lived
 * in `comments` and the single reply level lived in `comment_replies`. This
 * migration unifies everything into `comments` with a self-referencing
 * `parent_id` so replies can nest to ANY depth:
 *
 *   1. Adds `comments.parent_id` (TEXT NULL, self-reference) — NULL means a
 *      top-level comment, otherwise the direct parent comment/reply id.
 *   2. Backfills every existing `comment_replies` row into `comments` with
 *      `parent_id = comment_id` (their direct parent).
 *   3. Remaps `comment_likes.reply_id` → `comment_id` so likes on old replies
 *      keep pointing at the rows that are now comments.
 *   4. Creates `comments_post_idx` / `comments_parent_idx`.
 *
 * The legacy `comment_replies` table is left in place (unused) so nothing is
 * destroyed; all new writes go through `comments`.
 *
 * Idempotent: every step is guarded, existing rows are untouched, and the
 * whole run commits in one transaction.
 *
 * Usage:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... pnpm exec tsx scripts/migrate-comment-threading.ts
 */
import { createClient, type Transaction } from "@libsql/client";
import { config } from "@/lib/config";

const url = config.turso.url();
const token = config.turso.token();
if (!url || !token) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are required");

const client = createClient({ url, authToken: token });

async function tableInfo(tx: Transaction, table: string) {
  const r = await tx.execute(`PRAGMA table_info(${table})`);
  return r.rows.map((row) => String(row.name));
}

async function tableExists(tx: Transaction, table: string) {
  const r = await tx.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return r.rows.length > 0;
}

async function main() {
  const tx = await client.transaction("write");
  try {
    const cols = await tableInfo(tx, "comments");

    // 1. parent_id column
    if (!cols.includes("parent_id")) {
      await tx.execute("ALTER TABLE comments ADD COLUMN parent_id TEXT REFERENCES comments(id)");
      console.log("[migrate] comments.parent_id added");
    } else {
      console.log("[migrate] comments.parent_id exists — skipped");
    }

    // 2. Backfill comment_replies → comments (guarded so a re-run is a no-op).
    if (await tableExists(tx, "comment_replies")) {
      const before = await tx.execute(
        "SELECT COUNT(*) AS n FROM comment_replies r JOIN comments c ON c.id = r.comment_id",
      );
      const total = Number(before.rows[0]?.n ?? 0);
      const migrated = await tx.execute(`
        INSERT INTO comments (id, post_id, author_id, body, like_count, reply_count, created_at, updated_at, deleted_at, parent_id)
        SELECT r.id, c.post_id, r.author_id, r.body, r.like_count, 0, r.created_at, r.updated_at, r.deleted_at, r.comment_id
        FROM comment_replies r
        JOIN comments c ON c.id = r.comment_id
        WHERE NOT EXISTS (SELECT 1 FROM comments WHERE comments.id = r.id)
      `);
      console.log(
        `[migrate] comment_replies → comments: ${migrated.rowsAffected} of ${total} migrated`,
      );

      // 3. Likes on old replies now point at the unified comment rows.
      const likes = await tx.execute(
        "UPDATE comment_likes SET comment_id = reply_id, reply_id = NULL WHERE reply_id IS NOT NULL",
      );
      console.log(`[migrate] comment_likes remapped: ${likes.rowsAffected} reply likes → comment likes`);
    } else {
      console.log("[migrate] comment_replies table missing — backfill skipped");
    }

    // 4. Indexes for room listing + parent lookups / recursive traversal.
    await tx.execute("CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id)");
    await tx.execute("CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id)");
    console.log("[migrate] comments_post_idx / comments_parent_idx ensured");

    await tx.commit();
    console.log("[migrate] COMMITTED");
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* ignore rollback failure */
    }
    console.error("[migrate] FAILED — rolled back:", error);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.close());
