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
    // ── profiles: date_of_birth column ────────────────────────────────────
    {
      name: "profiles: add date_of_birth",
      sql: `ALTER TABLE profiles ADD COLUMN date_of_birth TEXT`,
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
    {
      name: "creator_settings: add subscription_plus_price",
      sql: `ALTER TABLE creator_settings ADD COLUMN subscription_plus_price REAL`,
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

    // ── subscriptions: add tier column ────────────────────────────────────────
    // Aligns the subscription tier with post tier names (bronze/silver/gold/diamond).
    // Previous upgrade/downgrade routes inferred tier from amount — this column stores it explicitly.
    {
      name: "subscriptions: add tier",
      sql: `ALTER TABLE subscriptions ADD COLUMN tier TEXT`,
    },

    // ── posts: pin / preview / expiry columns ──────────────────────────────
    // These may have been absent from the original base posts table in older deployments.
    {
      name: "posts: add is_pinned",
      sql: `ALTER TABLE posts ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "posts: add preview_duration",
      sql: `ALTER TABLE posts ADD COLUMN preview_duration INTEGER`,
    },
    {
      name: "posts: add expires_at",
      sql: `ALTER TABLE posts ADD COLUMN expires_at TEXT`,
    },

    // ── wallets table ──────────────────────────────────────────────────────
    {
      name: "create wallets",
      sql: `
        CREATE TABLE IF NOT EXISTS wallets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          balance REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'NGN',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "wallets: user index",
      sql: `CREATE INDEX IF NOT EXISTS wallets_user_idx ON wallets(user_id)`,
    },

    // ── creator_settings: dedicated bank_details column ───────────────────
    // Replaces the old BANK_DETAILS:{json} hack in welcome_message.
    // Idempotent — safe to run even if already applied.
    {
      name: "creator_settings: add bank_details",
      sql: `ALTER TABLE creator_settings ADD COLUMN bank_details TEXT`,
    },
    // Migrate any existing BANK_DETAILS:{json} values from welcome_message
    // into bank_details and clear the mangled welcome_message.
    {
      name: "creator_settings: migrate bank_details from welcome_message",
      sql: `
        UPDATE creator_settings
        SET
          bank_details = SUBSTR(welcome_message, 14),
          welcome_message = NULL
        WHERE welcome_message LIKE 'BANK_DETAILS:%'
      `,
    },

    // ── transactions table ─────────────────────────────────────────────────
    {
      name: "create transactions",
      sql: `
        CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'NGN',
          status TEXT NOT NULL DEFAULT 'pending',
          reference TEXT,
          description TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "transactions: user index",
      sql: `CREATE INDEX IF NOT EXISTS transactions_user_created_idx ON transactions(user_id, created_at)`,
    },
    {
      name: "transactions: reference index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS transactions_reference_idx ON transactions(reference) WHERE reference IS NOT NULL`,
    },
    {
      name: "transactions: status index",
      sql: `CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions(status)`,
    },

    // ── Remove legacy pay-to-unlock system ────────────────────────────────────
    // Per-post purchasing and paid DMs have been removed. Subscriptions are the
    // only content gate. Drop dead tables and columns.
    // SQLite does not support DROP COLUMN IF EXISTS — "no such column/table" errors
    // are caught below and treated as already-applied (idempotent).
    {
      name: "drop post_unlocks table",
      sql: `DROP TABLE IF EXISTS post_unlocks`,
    },
    {
      name: "drop message_unlocks table",
      sql: `DROP TABLE IF EXISTS message_unlocks`,
    },
    {
      name: "posts: drop unlock_price column",
      sql: `ALTER TABLE posts DROP COLUMN unlock_price`,
    },
    {
      name: "messages: drop is_paid column",
      sql: `ALTER TABLE messages DROP COLUMN is_paid`,
    },
    {
      name: "messages: drop paid_price column",
      sql: `ALTER TABLE messages DROP COLUMN paid_price`,
    },

    // ── conversation_members: clear-chat and background support ───────────────
    {
      name: "conversation_members: add cleared_at",
      sql: `ALTER TABLE conversation_members ADD COLUMN cleared_at TEXT`,
    },
    {
      name: "conversation_members: add background",
      sql: `ALTER TABLE conversation_members ADD COLUMN background TEXT`,
    },

    // ── user_settings: privacy + notification columns ────────────────────────
    {
      name: "user_settings: add private_account",
      sql: `ALTER TABLE user_settings ADD COLUMN private_account INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "user_settings: add online_status",
      sql: `ALTER TABLE user_settings ADD COLUMN online_status INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add activity_status",
      sql: `ALTER TABLE user_settings ADD COLUMN activity_status INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add typing_indicator",
      sql: `ALTER TABLE user_settings ADD COLUMN typing_indicator INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add read_receipts",
      sql: `ALTER TABLE user_settings ADD COLUMN read_receipts INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add allow_dms",
      sql: `ALTER TABLE user_settings ADD COLUMN allow_dms INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add allow_mentions",
      sql: `ALTER TABLE user_settings ADD COLUMN allow_mentions INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add allow_tags",
      sql: `ALTER TABLE user_settings ADD COLUMN allow_tags INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add search_visible",
      sql: `ALTER TABLE user_settings ADD COLUMN search_visible INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add birthday_visible",
      sql: `ALTER TABLE user_settings ADD COLUMN birthday_visible INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "user_settings: add phone_visible",
      sql: `ALTER TABLE user_settings ADD COLUMN phone_visible INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "user_settings: add sensitive_blur",
      sql: `ALTER TABLE user_settings ADD COLUMN sensitive_blur INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add qr_discovery",
      sql: `ALTER TABLE user_settings ADD COLUMN qr_discovery INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add auto_archive",
      sql: `ALTER TABLE user_settings ADD COLUMN auto_archive INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "user_settings: add notif_messages",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_messages INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_comments",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_comments INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_mentions",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_mentions INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_likes",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_likes INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_new_subscribers",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_new_subscribers INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_creator_updates",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_creator_updates INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_marketing",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_marketing INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "user_settings: add notif_vibration",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_vibration INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_sound",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_sound INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_preview",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_preview INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add notif_quiet_hours",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_quiet_hours INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "user_settings: add notif_quiet_start",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_quiet_start TEXT NOT NULL DEFAULT '22:00'`,
    },
    {
      name: "user_settings: add notif_quiet_end",
      sql: `ALTER TABLE user_settings ADD COLUMN notif_quiet_end TEXT NOT NULL DEFAULT '08:00'`,
    },
    {
      name: "user_settings: add high_quality_media",
      sql: `ALTER TABLE user_settings ADD COLUMN high_quality_media INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "user_settings: add sensitive_content",
      sql: `ALTER TABLE user_settings ADD COLUMN sensitive_content INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "user_settings: add language",
      sql: `ALTER TABLE user_settings ADD COLUMN language TEXT NOT NULL DEFAULT 'English'`,
    },

    // ── messages: media_type column ──────────────────────────────────────────
    {
      name: "messages: add media_type",
      sql: `ALTER TABLE messages ADD COLUMN media_type TEXT`,
    },

    // ── hidden_posts table ────────────────────────────────────────────────────
    {
      name: "create hidden_posts",
      sql: `
        CREATE TABLE IF NOT EXISTS hidden_posts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "hidden_posts: user index",
      sql: `CREATE INDEX IF NOT EXISTS hidden_posts_user_idx ON hidden_posts(user_id)`,
    },

    // ── muted_users table ────────────────────────────────────────────────────
    {
      name: "create muted_users",
      sql: `
        CREATE TABLE IF NOT EXISTS muted_users (
          id TEXT PRIMARY KEY,
          muter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          muted_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },

    // ── recent_searches table ─────────────────────────────────────────────────
    {
      name: "create recent_searches",
      sql: `
        CREATE TABLE IF NOT EXISTS recent_searches (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          query TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "recent_searches: user index",
      sql: `CREATE INDEX IF NOT EXISTS recent_searches_user_idx ON recent_searches(user_id)`,
    },

    // ── message_reads table ───────────────────────────────────────────────────
    {
      name: "create message_reads",
      sql: `
        CREATE TABLE IF NOT EXISTS message_reads (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "message_reads: message index",
      sql: `CREATE INDEX IF NOT EXISTS message_reads_message_idx ON message_reads(message_id)`,
    },
    {
      name: "message_reads: user index",
      sql: `CREATE INDEX IF NOT EXISTS message_reads_user_idx ON message_reads(user_id)`,
    },

    // ── creator_statistics table ──────────────────────────────────────────────
    {
      name: "create creator_statistics",
      sql: `
        CREATE TABLE IF NOT EXISTS creator_statistics (
          id TEXT PRIMARY KEY,
          creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          period TEXT NOT NULL,
          total_subscribers INTEGER NOT NULL DEFAULT 0,
          new_subscribers INTEGER NOT NULL DEFAULT 0,
          total_revenue REAL NOT NULL DEFAULT 0,
          total_views INTEGER NOT NULL DEFAULT 0,
          total_likes INTEGER NOT NULL DEFAULT 0,
          total_posts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "creator_statistics: creator period index",
      sql: `CREATE INDEX IF NOT EXISTS creator_statistics_creator_period_idx ON creator_statistics(creator_id, period)`,
    },

    // ── Tier system migration: bronze/silver/gold/diamond → free/subscriber/subscriber_plus ──
    // posts.tier: map old values to new three-tier system
    {
      name: "posts.tier: bronze → free",
      sql: `UPDATE posts SET tier = 'free' WHERE tier = 'bronze'`,
    },
    {
      name: "posts.tier: silver → subscriber",
      sql: `UPDATE posts SET tier = 'subscriber' WHERE tier = 'silver'`,
    },
    {
      name: "posts.tier: gold → subscriber",
      sql: `UPDATE posts SET tier = 'subscriber' WHERE tier = 'gold'`,
    },
    {
      name: "posts.tier: diamond → subscriber_plus",
      sql: `UPDATE posts SET tier = 'subscriber_plus' WHERE tier = 'diamond'`,
    },
    // subscriptions.tier: map old values to new two-tier system
    {
      name: "subscriptions.tier: bronze → subscriber",
      sql: `UPDATE subscriptions SET tier = 'subscriber' WHERE tier = 'bronze'`,
    },
    {
      name: "subscriptions.tier: silver → subscriber",
      sql: `UPDATE subscriptions SET tier = 'subscriber' WHERE tier = 'silver'`,
    },
    {
      name: "subscriptions.tier: gold → subscriber",
      sql: `UPDATE subscriptions SET tier = 'subscriber' WHERE tier = 'gold'`,
    },
    {
      name: "subscriptions.tier: diamond → subscriber_plus",
      sql: `UPDATE subscriptions SET tier = 'subscriber_plus' WHERE tier = 'diamond'`,
    },

    // ── Comment Rooms ──────────────────────────────────────────────────────
    {
      name: "create comment_rooms",
      sql: `
        CREATE TABLE IF NOT EXISTS comment_rooms (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          comments_enabled INTEGER NOT NULL DEFAULT 1,
          comment_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "comment_rooms: unique post index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS comment_rooms_post_idx ON comment_rooms(post_id)`,
    },

    // ── Chat Rooms ─────────────────────────────────────────────────────────
    {
      name: "create chat_rooms",
      sql: `
        CREATE TABLE IF NOT EXISTS chat_rooms (
          id TEXT PRIMARY KEY,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          last_message_at TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "chat_rooms: last message index",
      sql: `CREATE INDEX IF NOT EXISTS chat_rooms_last_message_idx ON chat_rooms(last_message_at)`,
    },
    {
      name: "create chat_room_members",
      sql: `
        CREATE TABLE IF NOT EXISTS chat_room_members (
          id TEXT PRIMARY KEY,
          chat_room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          context_id TEXT NOT NULL,
          is_muted INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          cleared_at TEXT,
          last_read_at TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
      `,
    },
    {
      name: "chat_room_members: add left_at",
      sql: `ALTER TABLE chat_room_members ADD COLUMN left_at TEXT`,
    },
    {
      name: "chat_room_members: unique room/user index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS chat_room_members_room_user_idx ON chat_room_members(chat_room_id, user_id)`,
    },
    {
      name: "chat_room_members: unique context index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS chat_room_members_context_idx ON chat_room_members(context_id)`,
    },
    {
      name: "chat_room_members: user index",
      sql: `CREATE INDEX IF NOT EXISTS chat_room_members_user_idx ON chat_room_members(user_id)`,
    },
    {
      name: "create chat_room_messages",
      sql: `
        CREATE TABLE IF NOT EXISTS chat_room_messages (
          id TEXT PRIMARY KEY,
          chat_room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reply_to_id TEXT,
          body TEXT,
          media_url TEXT,
          media_type TEXT,
          caption TEXT,
          file_name TEXT,
          file_size INTEGER,
          mime_type TEXT,
          audio_duration REAL,
          file_type TEXT,
          is_voice_note INTEGER NOT NULL DEFAULT 0,
          reactions TEXT,
          deleted_for TEXT,
          is_edited INTEGER NOT NULL DEFAULT 0,
          is_recalled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          deleted_at TEXT
        )
      `,
    },
    {
      name: "chat_room_messages: room/created index",
      sql: `CREATE INDEX IF NOT EXISTS chat_room_messages_room_created_idx ON chat_room_messages(chat_room_id, created_at)`,
    },

    // ── Two-factor authentication (TOTP) ────────────────────────────────────
    {
      name: "users: add totp_secret",
      sql: `ALTER TABLE users ADD COLUMN totp_secret TEXT`,
    },
    {
      name: "users: add totp_enabled",
      sql: `ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`,
    },
  ];

  for (const m of migrations) {
    try {
      await client.execute(m.sql);
      console.log(`  ✓  ${m.name}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // These messages all mean the migration was already applied — treat as no-op.
      // "duplicate column" / "already exists" → ADD COLUMN / CREATE TABLE already ran.
      // "no such column" → DROP COLUMN already ran (column was already removed).
      // "no such table" → DROP TABLE already ran (table was already removed).
      if (
        msg.includes("duplicate column") ||
        msg.includes("already exists") ||
        msg.includes("table already exists") ||
        msg.includes("no such column") ||
        msg.includes("no such table")
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
