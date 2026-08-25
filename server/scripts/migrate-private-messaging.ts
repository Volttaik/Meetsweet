/**
 * migrate-private-messaging.ts
 *
 * Aligns the LIVE Turso database with the server's authoritative schema
 * (lib/db/schema.ts) for the Private Messaging system. Run from the server
 * repo with TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in the environment.
 *
 * What it does (all guarded / idempotent, single transaction):
 *   1. Creates `private_messages` (the email-style paid inbox table) + indexes.
 *   2. Creates `private_message_attachments` (paid reply media) + indexes.
 *   3. Migrates the legacy `realtime_events` table (id/event_id/event_type/
 *      actor_id) to the schema the realtime outbox expects (seq/id/type/
 *      user_id), PRESERVING all existing rows.
 *   4. Adds the Private Inbox columns to `creator_settings`
 *      (private_inbox_enabled, private_message_price).
 *
 * Existing production data is never deleted or overwritten; the only table
 * touched destructively is `realtime_events`, which is rebuilt with its rows
 * mapped column-for-column into the new schema inside the same transaction.
 *
 * Usage:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... pnpm exec tsx scripts/migrate-private-messaging.ts
 */
import { createClient } from "@libsql/client";
import { config } from "@/lib/config";

const url = config.turso.url();
const token = config.turso.token();
if (!url || !token) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are required");

const client = createClient({ url, authToken: token });

/** PRAGMA table_info column names for a table ([] when the table is absent). */
async function columnNames(table: string): Promise<string[]> {
  const r = await client.execute(`PRAGMA table_info(${table})`);
  return r.rows.map((row) => String(row.name));
}

async function main() {
  const tx = await client.transaction("write");

  try {
    // ── 1. private_messages ─────────────────────────────────────────────────
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS private_messages (
        id TEXT PRIMARY KEY NOT NULL,
        sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_message_id TEXT,
        body TEXT NOT NULL,
        price_paid REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'sent',
        idempotency_key TEXT NOT NULL,
        read_at TEXT,
        replied_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await tx.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS private_messages_idempotency_idx ON private_messages (sender_id, idempotency_key)",
    );
    await tx.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS private_messages_parent_idx ON private_messages (parent_message_id) WHERE parent_message_id IS NOT NULL",
    );
    await tx.execute(
      "CREATE INDEX IF NOT EXISTS private_messages_recipient_idx ON private_messages (recipient_id, created_at)",
    );
    await tx.execute(
      "CREATE INDEX IF NOT EXISTS private_messages_sender_idx ON private_messages (sender_id, created_at)",
    );

    // ── 2. private_message_attachments ──────────────────────────────────────
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS private_message_attachments (
        id TEXT PRIMARY KEY NOT NULL,
        message_id TEXT NOT NULL REFERENCES private_messages(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL DEFAULT 'image',
        price REAL NOT NULL DEFAULT 0,
        purchased_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        purchase_transaction_id TEXT,
        purchased_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await tx.execute(
      "CREATE INDEX IF NOT EXISTS private_message_attachments_message_idx ON private_message_attachments (message_id)",
    );
    await tx.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS private_message_attachments_purchase_tx_idx ON private_message_attachments (purchase_transaction_id) WHERE purchase_transaction_id IS NOT NULL",
    );

    // ── 3. realtime_events → new schema (preserve every row) ────────────────
    const rtCols = await columnNames("realtime_events");
    if (rtCols.length > 0 && !rtCols.includes("seq")) {
      // Legacy layout (id/event_id/event_type/actor_id) → new layout
      // (seq/id/type/user_id). Map column-for-column so nothing is lost.
      await tx.execute(`
        CREATE TABLE realtime_events_new (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL,
          type TEXT NOT NULL,
          channel TEXT NOT NULL,
          user_id TEXT,
          resource_id TEXT,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `);
      await tx.execute(`
        INSERT INTO realtime_events_new (id, type, channel, user_id, resource_id, payload, created_at)
        SELECT event_id, event_type, channel, actor_id, resource_id, COALESCE(payload, '{}'), created_at
        FROM realtime_events
      `);
      await tx.execute("DROP TABLE realtime_events");
      await tx.execute("ALTER TABLE realtime_events_new RENAME TO realtime_events");
      console.log("[migrate] realtime_events migrated from legacy schema (rows preserved)");
    } else if (rtCols.length === 0) {
      await tx.execute(`
        CREATE TABLE IF NOT EXISTS realtime_events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL,
          type TEXT NOT NULL,
          channel TEXT NOT NULL,
          user_id TEXT,
          resource_id TEXT,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `);
      console.log("[migrate] realtime_events created");
    } else {
      console.log("[migrate] realtime_events already on the new schema — skipped");
    }
    await tx.execute(
      "CREATE INDEX IF NOT EXISTS realtime_events_channel_seq_idx ON realtime_events (channel, seq)",
    );

    // ── 4. creator_settings — Private Inbox columns ─────────────────────────
    const csCols = await columnNames("creator_settings");
    if (!csCols.includes("private_inbox_enabled")) {
      await tx.execute("ALTER TABLE creator_settings ADD COLUMN private_inbox_enabled INTEGER NOT NULL DEFAULT 1");
      console.log("[migrate] creator_settings.private_inbox_enabled added");
    } else {
      console.log("[migrate] creator_settings.private_inbox_enabled exists — skipped");
    }
    if (!csCols.includes("private_message_price")) {
      await tx.execute("ALTER TABLE creator_settings ADD COLUMN private_message_price REAL NOT NULL DEFAULT 100");
      console.log("[migrate] creator_settings.private_message_price added");
    } else {
      console.log("[migrate] creator_settings.private_message_price exists — skipped");
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
