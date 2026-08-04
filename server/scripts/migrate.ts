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
    // ── album support ──────────────────────────────────────────────────────
    {
      name: "create albums",
      sql: `
        CREATE TABLE IF NOT EXISTS albums (
          id TEXT PRIMARY KEY,
          creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          cover_url TEXT,
          price_credits INTEGER NOT NULL DEFAULT 0,
          is_premium INTEGER NOT NULL DEFAULT 0,
          visibility TEXT NOT NULL DEFAULT 'public',
          item_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          deleted_at TEXT
        )
      `,
    },
    {
      name: "albums: creator index",
      sql: `CREATE INDEX IF NOT EXISTS albums_creator_created_idx ON albums(creator_id, created_at)`,
    },
    {
      name: "albums: visibility index",
      sql: `CREATE INDEX IF NOT EXISTS albums_visibility_created_idx ON albums(visibility, created_at)`,
    },
    {
      name: "create album_items",
      sql: `
        CREATE TABLE IF NOT EXISTS album_items (
          id TEXT PRIMARY KEY,
          album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
          media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "album_items: unique album/media index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS album_items_album_media_idx ON album_items(album_id, media_id)`,
    },
    {
      name: "album_items: ordering index",
      sql: `CREATE INDEX IF NOT EXISTS album_items_album_sort_idx ON album_items(album_id, sort_order)`,
    },
    {
      name: "album_items: media index",
      sql: `CREATE INDEX IF NOT EXISTS album_items_media_idx ON album_items(media_id)`,
    },
    {
      name: "create album_unlocks",
      sql: `
        CREATE TABLE IF NOT EXISTS album_unlocks (
          id TEXT PRIMARY KEY,
          album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          credits_spent INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "album_unlocks: unique album/user index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS album_unlocks_album_user_idx ON album_unlocks(album_id, user_id)`,
    },
    {
      name: "album_unlocks: user history index",
      sql: `CREATE INDEX IF NOT EXISTS album_unlocks_user_created_idx ON album_unlocks(user_id, created_at)`,
    },
    {
      name: "create post_unlocks",
      sql: `
        CREATE TABLE IF NOT EXISTS post_unlocks (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          credits_spent INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "post_unlocks: unique post/user index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS post_unlocks_post_user_idx ON post_unlocks(post_id, user_id)`,
    },
    {
      name: "post_unlocks: user history index",
      sql: `CREATE INDEX IF NOT EXISTS post_unlocks_user_created_idx ON post_unlocks(user_id, created_at)`,
    },

    // ── creator_settings table additions ──────────────────────────────────────
    {
      name: "creator_settings: add who_can_message",
      sql: `ALTER TABLE creator_settings ADD COLUMN who_can_message TEXT NOT NULL DEFAULT 'everyone'`,
    },
    {
      name: "creator_settings: add welcome_message",
      sql: `ALTER TABLE creator_settings ADD COLUMN welcome_message TEXT`,
    },
    {
      name: "creator_settings: add verification_status",
      sql: `ALTER TABLE creator_settings ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'none'`,
    },

    // ── posts table: content_type discriminator (post / video / short) ────────
    {
      name: "posts: add content_type",
      sql: `ALTER TABLE posts ADD COLUMN content_type TEXT NOT NULL DEFAULT 'post'`,
    },
    {
      name: "posts: add title",
      sql: `ALTER TABLE posts ADD COLUMN title TEXT`,
    },
    {
      name: "posts: add description",
      sql: `ALTER TABLE posts ADD COLUMN description TEXT`,
    },
    {
      name: "posts: add share_count",
      sql: `ALTER TABLE posts ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "posts: add thumbnail_url",
      sql: `ALTER TABLE posts ADD COLUMN thumbnail_url TEXT`,
    },
    {
      name: "posts: add tier",
      sql: `ALTER TABLE posts ADD COLUMN tier TEXT`,
    },
    {
      name: "posts: add tags",
      sql: `ALTER TABLE posts ADD COLUMN tags TEXT`,
    },
    {
      name: "posts: content_type index",
      sql: `CREATE INDEX IF NOT EXISTS posts_content_type_status_idx ON posts(content_type, status, visibility)`,
    },
    {
      name: "posts: creator+content_type index",
      sql: `CREATE INDEX IF NOT EXISTS posts_creator_content_type_idx ON posts(creator_id, content_type)`,
    },

    // ── post_categories junction table ────────────────────────────────────────
    {
      name: "create post_categories",
      sql: `
        CREATE TABLE IF NOT EXISTS post_categories (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "post_categories: unique post/category index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS post_categories_post_cat_idx ON post_categories(post_id, category_id)`,
    },
    {
      name: "post_categories: category index",
      sql: `CREATE INDEX IF NOT EXISTS post_categories_category_idx ON post_categories(category_id)`,
    },

    // ── creator_reviews table (new) ───────────────────────────────────────────
    {
      name: "create creator_reviews",
      sql: `
        CREATE TABLE IF NOT EXISTS creator_reviews (
          id TEXT PRIMARY KEY,
          creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rating INTEGER NOT NULL,
          body TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "creator_reviews: unique creator/reviewer index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS creator_reviews_creator_reviewer_idx ON creator_reviews(creator_id, reviewer_id)`,
    },
    {
      name: "creator_reviews: creator index",
      sql: `CREATE INDEX IF NOT EXISTS creator_reviews_creator_idx ON creator_reviews(creator_id)`,
    },

    // ── shares table (new) ────────────────────────────────────────────────────
    {
      name: "create shares",
      sql: `
        CREATE TABLE IF NOT EXISTS shares (
          id TEXT PRIMARY KEY,
          creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          content_type TEXT NOT NULL,
          content_id TEXT NOT NULL,
          token TEXT NOT NULL,
          expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "shares: unique token index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS shares_token_idx ON shares(token)`,
    },
    {
      name: "shares: content index",
      sql: `CREATE INDEX IF NOT EXISTS shares_content_idx ON shares(content_type, content_id)`,
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
