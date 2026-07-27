# MeetSweet Server

Production backend for the MeetSweet mobile app. Built with Next.js 15 App Router.
Acts as a credential broker + full feature API.

## Run & Operate

- Start server: `cd server && pnpm install && pnpm dev` (workflow: `MeetSweet Server`)
- DB push (Drizzle): `cd server && pnpm db:push`
- Manual migration script: `cd server && npx tsx scripts/migrate.ts`

## Stack

- Next.js 15 App Router (API routes + diagnostic page)
- Turso (LibSQL) + Drizzle ORM
- Cloudflare R2 (direct signed uploads/downloads)
- Resend (email)
- JWT (jose) + Argon2 (auth)
- Zod (validation)
- Paystack (payments)

## Required Environment Variables

| Variable               | Description                                     |
|------------------------|-------------------------------------------------|
| `TURSO_DATABASE_URL`   | Turso database URL (`libsql://...`)             |
| `TURSO_AUTH_TOKEN`     | Turso auth token                                |
| `CLOUDFLARE_ACCOUNT_ID`| Cloudflare account ID (or set `R2_ENDPOINT`)    |
| `R2_ACCESS_KEY_ID`     | R2 access key                                   |
| `R2_SECRET_ACCESS_KEY` | R2 secret key                                   |
| `R2_BUCKET_NAME`       | R2 bucket name                                  |
| `JWT_SECRET`           | JWT signing secret (min 32 chars)               |
| `RESEND_API_KEY`       | Resend API key                                  |
| `VERIFIED_SENDER_EMAIL`| Verified sender email                           |
| `APP_URL`              | Public URL of this server                       |
| `CLIENT_APP_ID`        | Client app identifier (default: meetsweet-mobile)|

`SESSION_SECRET` is already configured. `JWT_SECRET` falls back to `SESSION_SECRET` if not set.

## Where things live

- `server/app/api/auth/` — authentication and session routes
- `server/app/api/credentials/` — scoped credential and signed URL routes
- `server/app/api/conversations/` — messaging conversations
- `server/app/api/messages/` — individual message operations (edit, delete, unlock)
- `server/app/api/posts/` — posts feed (content_type='post' only), comments, likes, bookmarks
- `server/app/api/videos/` — long-form video feed, detail, likes, comments, recommendations
- `server/app/api/shorts/` — shorts feed, detail, likes, views, comments, recommendations
- `server/app/api/creators/` — creator profiles, posts/videos/shorts/albums per creator, reviews, stats, subscribers
- `server/app/api/albums/` — albums CRUD, items, unlock, purchase
- `server/app/api/explore/` — public discovery feed (posts only)
- `server/app/api/collections/` — algorithmic content collections for Explore tab
- `server/app/api/search/` — full-text search, recent searches, trending searches
- `server/app/api/shares/` — share link generation and resolution
- `server/app/api/users/` — user profiles and social graph
- `server/app/api/media/` — media registration and proxy upload
- `server/app/api/wallet/` — wallet balance and transactions
- `server/lib/db/schema.ts` — full Drizzle schema
- `server/lib/auth/` — JWT + password helpers
- `server/lib/services/content.ts` — shared helpers for video/short/comment response shapes
- `server/middleware.ts` — CORS + security headers
- `server/app/page.tsx` — diagnostic status panel
- `server/scripts/migrate.ts` — one-shot migration for new columns

## Migration Note

After the July 2026 sync, `pnpm migrate` (or `npx tsx scripts/migrate.ts`) must be
run once against the production Turso database to add new columns:
- `messages`: `caption`, `mime_type`, `file_name`, `file_size`, `audio_duration`, `is_paid`, `paid_price`
- `media`: `thumbnail_url`, `file_name`
- New table: `message_unlocks`

## User preferences

- Server is backend-only (API + diagnostic page, no full frontend)
