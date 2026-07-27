/**
 * Manual migration script — applies schema additions that Drizzle db:push
 * would apply, using direct LibSQL SQL statements.
 *
 * Run with:
 *   cd server && npx tsx scripts/migrate.ts
 *
 * Safe to run multiple times — uses IF NOT EXISTS / ALTER COLUMN IF NOT EXISTS.
 */

import { createClient } from "@libsql/client";
import { config } from "../lib/config";

const url = config.turso.url();
const authToken = config.turso.token();

if (!url) {
  console.error("TURSO_DATABASE_URL (or DATABASE_URL) is not set.");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function run() {
  console.log("Starting migration...\n");

  const migrations: { name: string; sql: string }[] = [
    // ── media table additions ──────────────────────────────────────────────
    {
      name: "media: add thumbnail_url",
      sql: `ALTER TABLE media ADD COLUMN thumbnail_url TEXT`,
    },
    {
      name: "media: add file_name",
      sql: `ALTER TABLE media ADD COLUMN file_name TEXT`,
    },

    // ── messages table additions ───────────────────────────────────────────
    {
      name: "messages: add caption",
      sql: `ALTER TABLE messages ADD COLUMN caption TEXT`,
    },
    {
      name: "messages: add mime_type",
      sql: `ALTER TABLE messages ADD COLUMN mime_type TEXT`,
    },
    {
      name: "messages: add file_name",
      sql: `ALTER TABLE messages ADD COLUMN file_name TEXT`,
    },
    {
      name: "messages: add file_size",
      sql: `ALTER TABLE messages ADD COLUMN file_size INTEGER`,
    },
    {
      name: "messages: add audio_duration",
      sql: `ALTER TABLE messages ADD COLUMN audio_duration REAL`,
    },
    {
      name: "messages: add is_paid",
      sql: `ALTER TABLE messages ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "messages: add paid_price",
      sql: `ALTER TABLE messages ADD COLUMN paid_price INTEGER`,
    },

    // ── message_unlocks table (new) ────────────────────────────────────────
    {
      name: "create message_unlocks",
      sql: `
        CREATE TABLE IF NOT EXISTS message_unlocks (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          credits_spent INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "message_unlocks: unique index (message_id, user_id)",
      sql: `
        CREATE UNIQUE INDEX IF NOT EXISTS message_unlocks_msg_user_idx
        ON message_unlocks(message_id, user_id)
      `,
    },
  ];

  for (const m of migrations) {
    try {
      await client.execute(m.sql);
      console.log(`  ✓  ${m.name}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // "duplicate column name" or "already exists" means migration already applied
      if (
        msg.includes("duplicate column") ||
        msg.includes("already exists") ||
        msg.includes("table already exists")
      ) {
        console.log(`  ─  ${m.name} (already applied)`);
      } else {
        console.error(`  ✗  ${m.name}: ${msg}`);
        throw e;
      }
    }
  }

  console.log("\nMigration complete.");
  await client.close();
}

run().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
