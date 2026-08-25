/**
 * migrate-pm-features.ts
 *
 * Live-database migration for the Private Messaging refinement:
 *   1. `private_messages.status` gains "waiting" (TEXT column — no DDL needed,
 *      the enum is app-level only).
 *   2. `private_messages.deleted_for_sender_at` / `deleted_for_recipient_at`
 *      (TEXT NULL) — per-participant deletion visibility.
 *   3. The old one-reply-per-original unique index is replaced by a plain
 *      thread index so replies-to-replies are possible.
 *   4. New `dm_restrictions` table — "mute / set to waiting" sender rules.
 *
 * Idempotent: every step is guarded, existing rows are untouched, and the
 * whole run commits in one transaction.
 *
 * Usage:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... pnpm exec tsx scripts/migrate-pm-features.ts
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

async function indexes(tx: Transaction, table: string) {
  const r = await tx.execute(`PRAGMA index_list(${table})`);
  return r.rows.map((row) => String(row.name));
}

async function main() {
  const tx = await client.transaction("write");
  try {
    const cols = await tableInfo(tx, "private_messages");
    const idx = await indexes(tx, "private_messages");

    if (!cols.includes("deleted_for_sender_at")) {
      await tx.execute("ALTER TABLE private_messages ADD COLUMN deleted_for_sender_at TEXT");
      console.log("[migrate] private_messages.deleted_for_sender_at added");
    } else {
      console.log("[migrate] private_messages.deleted_for_sender_at exists — skipped");
    }

    if (!cols.includes("deleted_for_recipient_at")) {
      await tx.execute("ALTER TABLE private_messages ADD COLUMN deleted_for_recipient_at TEXT");
      console.log("[migrate] private_messages.deleted_for_recipient_at added");
    } else {
      console.log("[migrate] private_messages.deleted_for_recipient_at exists — skipped");
    }

    // One-reply-per-original was enforced by this unique index; threading is
    // now a flat chain per root, so replace it with a plain lookup index.
    await tx.execute("DROP INDEX IF EXISTS private_messages_parent_idx");
    await tx.execute(
      "CREATE INDEX IF NOT EXISTS private_messages_parent_thread_idx ON private_messages (parent_message_id)",
    );
    console.log("[migrate] private_messages threading index swapped (unique → plain)");

    const dmCols = await tableInfo(tx, "dm_restrictions").catch(() => [] as string[]);
    if (dmCols.length === 0) {
      await tx.execute(`
        CREATE TABLE dm_restrictions (
          id TEXT NOT NULL PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          restricted_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        )
      `);
      await tx.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS dm_restrictions_pair_idx ON dm_restrictions (user_id, restricted_id)",
      );
      await tx.execute("CREATE INDEX IF NOT EXISTS dm_restrictions_user_idx ON dm_restrictions (user_id)");
      console.log("[migrate] dm_restrictions table created");
    } else {
      console.log("[migrate] dm_restrictions table exists — skipped");
    }

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
