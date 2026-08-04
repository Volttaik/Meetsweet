---
name: MeetSweet API compatibility
description: Mobile is source of truth for response shapes; covers all schema additions and route fixes made to match the mobile contract.
---

# MeetSweet API Compatibility

## Rule
Mobile app (Expo/React Native) is the source of truth for all response shapes. Every post object returned from ANY endpoint must include `content_type`, `title`, `thumbnail_url`, `tier`, `tags`, `media` (with `id`), and all social counts.

**Why:** The mobile's content routing (shorts vs videos vs posts vs albums) breaks silently if `content_type` is missing or wrong. `tags` is stored as JSON text in DB and must be parsed on read.

## How to apply
- `tags` column on `posts` table is `TEXT` storing a JSON array string (e.g. `'["comedy","lifestyle"]'`). Always `JSON.parse()` on read; `JSON.stringify()` on write.
- `thumbnail_url` on the `posts` table holds the creator-supplied custom thumbnail, not the media row thumbnail. Both exist — the posts.thumbnail_url is the preferred one for video/short posts.
- `post_categories` junction table links posts to categories. Insert with `onConflictDoNothing()`.
- `content_type` enum: `"post" | "video" | "short" | "album"` — "album" was added in August 2026 to the schema but NOT enforced at the DB level (SQLite text, no hard constraint).

## Schema additions (August 2026)
- `posts.thumbnail_url` TEXT
- `posts.tier` TEXT (bronze/silver/gold/diamond)
- `posts.tags` TEXT (JSON array)
- New table: `post_categories` (post_id, category_id, unique index)
- Migration script: `cd server && npx tsx scripts/migrate.ts` — idempotent

## Key route fixes made
- `POST /api/posts` now stores `content_type`, `title`, `thumbnail_url`, `tier`, `tags`, and wires `categories` → `post_categories`
- `GET /api/posts` `postRow()` no longer hardcodes `content_type: "post"` — reads from DB
- `GET /api/posts/:id` returns full field set including `thumbnail_url`, `tier`, `tags` (parsed)
- `PATCH /api/media/:id` added at `server/app/api/media/[id]/route.ts`
- Subscriptions POST is now idempotent (returns existing active subscription instead of 409)
- `creators/[id]/posts` now returns `content_type`, `title`, `thumbnail_url`, `tier`, `tags`
