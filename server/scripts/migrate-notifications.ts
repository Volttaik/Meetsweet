/**
 * migrate-notifications.ts
 *
 * Notification-system rebuild migration:
 *   1. `notifications.dedupe_key` (TEXT NULL) — one logical event → at most
 *      one notification row per recipient. The NotificationService derives
 *      the key from the event (e.g. like:{postId}:{actorId}) so retried or
 *      replayed events can never duplicate rows or double-push.
 *   2. Unique partial index on `notifications (user_id, dedupe_key)` where
 *      dedupe_key IS NOT NULL — enforces the dedupe at the DB level (race-safe).
 *   3. Unique partial index on `devices (push_token)` where push_token IS
 *      NOT NULL — one row per installation; concurrent registrations of the
 *      same token upsert instead of double-inserting.
 *
 * Idempotent: every step is guarded, existing rows are untouched, and the
 * whole run commits in one transaction.
 *
 * Usage:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... pnpm exec tsx scripts/migrate-notifications.ts
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
    // 1. notifications.dedupe_key
    const notifCols = await tableInfo(tx, "notifications");
    if (!notifCols.includes("dedupe_key")) {
      await tx.execute("ALTER TABLE notifications ADD COLUMN dedupe_key TEXT");
      console.log("[migrate] notifications.dedupe_key added");
    } else {
      console.log("[migrate] notifications.dedupe_key exists — skipped");
    }

    const notifIdx = await indexes(tx, "notifications");
    if (!notifIdx.includes("notifications_dedupe_user_idx")) {
      await tx.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_user_idx ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL",
      );
      console.log("[migrate] notifications_dedupe_user_idx created");
    } else {
      console.log("[migrate] notifications_dedupe_user_idx exists — skipped");
    }

    if (!notifIdx.includes("notifications_user_created_idx")) {
      await tx.execute(
        "CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at)",
      );
      console.log("[migrate] notifications_user_created_idx created");
    } else {
      console.log("[migrate] notifications_user_created_idx exists — skipped");
    }

    // 2. devices.push_token uniqueness
    const deviceIdx = await indexes(tx, "devices");
    if (!deviceIdx.includes("devices_push_token_idx")) {
      await tx.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS devices_push_token_idx ON devices (push_token) WHERE push_token IS NOT NULL",
      );
      console.log("[migrate] devices_push_token_idx created");
    } else {
      console.log("[migrate] devices_push_token_idx exists — skipped");
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
