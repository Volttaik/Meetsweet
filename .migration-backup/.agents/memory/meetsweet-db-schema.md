---
name: MeetSweet Database Schema
description: Full PostgreSQL schema for MeetSweet — all 16 tables, their columns, and relationships. The API server uses raw pg queries (not Drizzle ORM), with helpers in artifacts/api-server/src/lib/db.ts.
---

# MeetSweet Database Schema

**ORM approach:** Raw `pg` (node-postgres) with `query`, `queryOne`, `queryRaw` helpers in `artifacts/api-server/src/lib/db.ts`. The `lib/db` workspace package exists but is NOT used by the API server — the server has its own pool.

**Schema SQL file:** `artifacts/api-server/src/db/schema.sql` — run once to set up tables.

**Tables:**

| Table | Key columns |
|---|---|
| `users` | id (uuid PK), name, username (unique), email (unique), phone, password_hash, bio, avatar_url, banner_url, is_verified, is_creator, credits (int), follower_count, following_count, subscriber_count, post_count, email_verified, created_at, updated_at |
| `refresh_tokens` | id, user_id (FK→users), token_hash (unique), expires_at |
| `email_verifications` | id, user_id (FK→users), email, code, type ('verify'\|'reset'), expires_at, used_at |
| `categories` | id, name (unique), slug (unique), post_count; seeded with 10 defaults |
| `posts` | id, user_id (FK→users), caption, visibility ('public'\|'subscribers'\|'draft'), media_url, media_type ('image'\|'video'), thumbnail_url, duration_secs, file_size, width, height, is_premium, price_credits, like_count, comment_count, bookmark_count, is_archived |
| `post_categories` | post_id + category_id (composite PK) |
| `post_tags` | post_id + tag (composite PK) |
| `likes` | id, user_id, post_id; UNIQUE(user_id, post_id) |
| `bookmarks` | id, user_id, post_id; UNIQUE(user_id, post_id) |
| `comments` | id, user_id, post_id, parent_id (self-ref), body, like_count |
| `comment_likes` | user_id + comment_id (composite PK) |
| `follows` | id, follower_id, following_id; UNIQUE(follower_id, following_id) |
| `conversations` | id, last_message_body, last_message_at |
| `conversation_participants` | conversation_id + user_id (composite PK), last_read_at, is_muted, is_archived |
| `messages` | id, conversation_id (FK), sender_id (FK), body, media_url, media_type, is_deleted, is_edited |
| `notifications` | id, user_id (FK), actor_id (FK→users nullable), post_id (FK nullable), type, title, body, is_read |
| `transactions` | id, user_id (FK), type ('credit'\|'debit'), amount, description |
| `media` | id, user_id (FK), url, thumbnail_url, media_type, filename, original_name, mime_type, file_size |

**Why:** The API server (artifacts/api-server) uses raw SQL to keep things simple and avoid ORM overhead. All routes import from `lib/db.ts` (the server-local one, not the workspace lib/db package).

**How to apply:** Run `artifacts/api-server/src/db/schema.sql` once against the PostgreSQL database. Uses `IF NOT EXISTS` so it's idempotent.
