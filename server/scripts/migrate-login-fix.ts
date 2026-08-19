/**
 * Focused schema fix for the login HTTP 500.
 *
 * Root cause: the `users.two_fa_enabled` column the auth routes read does not
 * exist in the live database — the rename migration (`totp_enabled` →
 * `two_fa_enabled`) was never applied, so the column is still named
 * `totp_enabled`. The login/2FA/`/users/me` queries all SELECT
 * `two_fa_enabled`, which throws "no such column" → HTTP 500.
 *
 * This script applies ONLY the missing pieces, idempotently, without touching
 * any data:
 *   1. users: rename totp_enabled → two_fa_enabled (preserves the boolean)
 *   2. users: drop the unused totp_secret column
 *   3. media: add stream_uid / stream_status / qualities (Cloudflare Stream)
 *
 * It deliberately does NOT run scripts/migrate.ts, which drops & recreates
 * `post_views` (losing view data) and performs other destructive cleanup.
 *
 * Run with:
 *   cd server && npx tsx scripts/migrate-login-fix.ts
 */

import { createClient } from "@libsql/client";
import { config } from "../lib/config";

const url = config.turso.url();
const authToken = config.turso.token();

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function columnNames(table: string): Promise<Set<string>> {
  const r = await client.execute(`PRAGMA table_info("${table}")`);
  return new Set(r.rows.map((row) => String(row.name)));
}

async function run() {
  console.log("Applying focused schema fixes…\n");

  // ── 1. users: rename totp_enabled → two_fa_enabled ──────────────────────
  const userCols = await columnNames("users");
  if (userCols.has("two_fa_enabled")) {
    console.log("  ─  users.two_fa_enabled already present");
  } else if (userCols.has("totp_enabled")) {
    await client.execute(
      `ALTER TABLE users RENAME COLUMN totp_enabled TO two_fa_enabled`,
    );
    console.log("  ✓  users: renamed totp_enabled → two_fa_enabled");
  } else {
    console.log("  ✗  users has neither totp_enabled nor two_fa_enabled");
  }

  // ── 2. users: drop unused totp_secret ───────────────────────────────────
  const userCols2 = await columnNames("users");
  if (userCols2.has("totp_secret")) {
    await client.execute(`ALTER TABLE users DROP COLUMN totp_secret`);
    console.log("  ✓  users: dropped totp_secret");
  } else {
    console.log("  ─  users.totp_secret already absent");
  }

  // ── 3. media: Cloudflare Stream columns ─────────────────────────────────
  const mediaCols = await columnNames("media");
  if (!mediaCols.has("stream_uid")) {
    await client.execute(`ALTER TABLE media ADD COLUMN stream_uid TEXT`);
    console.log("  ✓  media: added stream_uid");
  } else {
    console.log("  ─  media.stream_uid already present");
  }
  if (!mediaCols.has("stream_status")) {
    await client.execute(
      `ALTER TABLE media ADD COLUMN stream_status TEXT NOT NULL DEFAULT 'none'`,
    );
    console.log("  ✓  media: added stream_status");
  } else {
    console.log("  ─  media.stream_status already present");
  }
  if (!mediaCols.has("qualities")) {
    await client.execute(`ALTER TABLE media ADD COLUMN qualities TEXT`);
    console.log("  ✓  media: added qualities");
  } else {
    console.log("  ─  media.qualities already present");
  }

  // ── Verify ──────────────────────────────────────────────────────────────
  console.log("\nVerifying…");
  const verify = await client.execute(
    `SELECT id, full_name, username, email, password_hash, role, is_creator, is_active, is_verified, two_fa_enabled, deleted_at FROM users LIMIT 1`,
  );
  console.log("  ✓ login SELECT works:", JSON.stringify(verify.rows[0]));
  const mediaVerify = await client.execute(
    `SELECT stream_uid, stream_status, qualities FROM media LIMIT 1`,
  );
  console.log("  ✓ media stream SELECT works");

  console.log("\nDone.");
  await client.close();
}

run().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
