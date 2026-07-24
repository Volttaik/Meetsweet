-- MeetSweet Database Schema
-- Run this once against your provisioned PostgreSQL database

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  username          TEXT        NOT NULL UNIQUE,
  email             TEXT        NOT NULL UNIQUE,
  phone             TEXT,
  password_hash     TEXT        NOT NULL,
  bio               TEXT,
  avatar_url        TEXT,
  banner_url        TEXT,
  is_verified       BOOLEAN     NOT NULL DEFAULT FALSE,
  is_creator        BOOLEAN     NOT NULL DEFAULT FALSE,
  credits           INTEGER     NOT NULL DEFAULT 0,
  follower_count    INTEGER     NOT NULL DEFAULT 0,
  following_count   INTEGER     NOT NULL DEFAULT 0,
  subscriber_count  INTEGER     NOT NULL DEFAULT 0,
  post_count        INTEGER     NOT NULL DEFAULT 0,
  email_verified    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Auth ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  code        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('verify', 'reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Categories ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  slug       TEXT NOT NULL UNIQUE,
  post_count INTEGER NOT NULL DEFAULT 0
);

-- Seed initial categories
INSERT INTO categories (name, slug) VALUES
  ('Art & Design',     'art-design'),
  ('Music',            'music'),
  ('Fitness',          'fitness'),
  ('Photography',      'photography'),
  ('Gaming',           'gaming'),
  ('Food & Cooking',   'food-cooking'),
  ('Travel',           'travel'),
  ('Education',        'education'),
  ('Comedy',           'comedy'),
  ('Lifestyle',        'lifestyle')
ON CONFLICT DO NOTHING;

-- ─── Posts ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption        TEXT,
  visibility     TEXT        NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'subscribers', 'draft')),
  media_url      TEXT,
  media_type     TEXT        CHECK (media_type IN ('image', 'video')),
  thumbnail_url  TEXT,
  duration_secs  INTEGER,
  file_size      INTEGER,
  width          INTEGER,
  height         INTEGER,
  is_premium     BOOLEAN     NOT NULL DEFAULT FALSE,
  price_credits  INTEGER,
  like_count     INTEGER     NOT NULL DEFAULT 0,
  comment_count  INTEGER     NOT NULL DEFAULT 0,
  bookmark_count INTEGER     NOT NULL DEFAULT 0,
  is_archived    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id     ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_visibility   ON posts(visibility);
CREATE INDEX IF NOT EXISTS idx_posts_created_at   ON posts(created_at DESC);

-- Optional previews let subscriber-only posts expose a cover or short teaser
ALTER TABLE posts ADD COLUMN IF NOT EXISTS preview_media_url TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS preview_media_type TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS preview_duration_secs INTEGER;

CREATE TABLE IF NOT EXISTS post_categories (
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);

-- ─── Likes & Bookmarks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, post_id)
);

-- ─── Subscriptions (payment layer foundation) ────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  monthly_credits INTEGER     NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscriber_id, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber ON subscriptions(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_creator ON subscriptions(creator_id);

-- ─── Reports ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, reporter_id)
);

-- ─── Comments ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id   UUID        REFERENCES comments(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL,
  like_count  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);

CREATE TABLE IF NOT EXISTS comment_likes (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, comment_id)
);

-- ─── Follows ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follows (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, following_id)
);

-- ─── Messages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  last_message_body TEXT,
  last_message_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ,
  is_muted        BOOLEAN     NOT NULL DEFAULT FALSE,
  is_archived     BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT,
  media_url       TEXT,
  media_type      TEXT,
  is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
  is_edited       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  post_id    UUID        REFERENCES posts(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- ─── Transactions (wallet) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('credit', 'debit')),
  amount      INTEGER     NOT NULL,
  description TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Media ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url            TEXT        NOT NULL,
  thumbnail_url  TEXT,
  media_type     TEXT        NOT NULL,
  filename       TEXT        NOT NULL,
  original_name  TEXT        NOT NULL,
  mime_type      TEXT        NOT NULL,
  file_size      INTEGER     NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
