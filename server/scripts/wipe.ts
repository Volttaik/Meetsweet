/**
 * Nuclear wipe script — deletes ALL objects from R2 and ALL rows from every
 * database table.  The schema structure is preserved; only data is removed.
 *
 * Run with:
 *   cd server && npx tsx scripts/wipe.ts
 */

import { createClient } from "@libsql/client";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { config } from "../lib/config";

// ── Validate env ──────────────────────────────────────────────────────────────

const tursoUrl   = config.turso.url();
const tursoToken = config.turso.token();
const accountId  = config.r2.accountId();
const accessKey  = config.r2.accessKeyId();
const secretKey  = config.r2.secretAccessKey();
const bucket     = config.r2.bucket();
const endpoint   = config.r2.endpoint() ??
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

if (!tursoUrl)  { console.error("TURSO_DATABASE_URL is not set"); process.exit(1); }
if (!accessKey) { console.error("R2_ACCESS_KEY_ID is not set");   process.exit(1); }
if (!secretKey) { console.error("R2_SECRET_ACCESS_KEY is not set"); process.exit(1); }
if (!bucket)    { console.error("R2_BUCKET_NAME is not set");      process.exit(1); }
if (!endpoint)  { console.error("R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID is not set"); process.exit(1); }

// ── R2 wipe ───────────────────────────────────────────────────────────────────

async function wipeR2() {
  console.log(`\n── R2 bucket: ${bucket} ──`);

  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: accessKey!, secretAccessKey: secretKey! },
  });

  let totalDeleted = 0;
  let continuationToken: string | undefined;

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket!,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    const objects = list.Contents ?? [];
    if (objects.length === 0) break;

    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket!,
        Delete: {
          Objects: objects.map((o) => ({ Key: o.Key! })),
          Quiet: true,
        },
      }),
    );

    totalDeleted += objects.length;
    console.log(`  deleted ${totalDeleted} objects so far…`);
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);

  console.log(`  ✓ R2 wipe complete — ${totalDeleted} objects deleted`);
}

// ── Database wipe ─────────────────────────────────────────────────────────────

// Tables ordered children-first so FK constraints (if enforced) don't block deletes.
const TABLES = [
  "notifications",
  "message_reads",
  "message_unlocks",
  "messages",
  "conversation_members",
  "conversations",
  "comment_likes",
  "comment_replies",
  "comments",
  "post_unlocks",
  "album_unlocks",
  "album_items",
  "albums",
  "post_categories",
  "post_likes",
  "saved_posts",
  "media",
  "posts",
  "shares",
  "creator_reviews",
  "creator_statistics",
  "creator_settings",
  "transactions",
  "wallets",
  "subscriptions",
  "follows",
  "blocked_users",
  "muted_users",
  "recent_searches",
  "reports",
  "refresh_tokens",
  "sessions",
  "verification_codes",
  "user_settings",
  "profiles",
  "users",
  "categories",
];

async function wipeDatabase() {
  console.log(`\n── Turso database ──`);

  const db = createClient({ url: tursoUrl!, authToken: tursoToken });

  // Disable FK enforcement for the wipe so order doesn't matter
  await db.execute("PRAGMA foreign_keys = OFF");

  for (const table of TABLES) {
    try {
      const result = await db.execute(`DELETE FROM ${table}`);
      const rows = result.rowsAffected ?? 0;
      console.log(`  ✓ ${table} — ${rows} rows deleted`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no such table")) {
        console.log(`  ─ ${table} (table does not exist, skipping)`);
      } else {
        console.error(`  ✗ ${table}: ${msg}`);
      }
    }
  }

  await db.execute("PRAGMA foreign_keys = ON");
  await db.close();
  console.log("  ✓ Database wipe complete");
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function run() {
  console.log("Starting full wipe…");
  await wipeR2();
  await wipeDatabase();
  console.log("\n✓ All done — clean slate.");
}

run().catch((e) => {
  console.error("Wipe failed:", e);
  process.exit(1);
});
