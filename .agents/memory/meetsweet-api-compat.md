---
name: MeetSweet API compatibility
description: Backend-vs-mobile audit results and production database migration status
---

# MeetSweet Backend ↔ Mobile Compatibility

## Audit status (July 2026)
Full 10-phase audit completed. Backend compared against MeetSweet-mobile.git frontend.

## Production database
All 40 tables confirmed present in live Turso database.
Migration script (`server/scripts/migrate.ts`) was run for the first time in July 2026 — all 24 steps applied fresh:
- Added `media.thumbnail_url`, `media.file_name`
- Added `messages.caption`, `.mime_type`, `.file_name`, `.file_size`, `.audio_duration`, `.is_paid`, `.paid_price`
- Created `message_unlocks` table (with unique index)
- Created `albums`, `album_items`, `album_unlocks` tables (with indexes)
- Created `post_unlocks` table (with indexes)

**Why:** Production DB had never had the migration run — tables/columns were missing before this.

## Missing route found and fixed
`POST /api/auth/resend-verification` — was absent, now at `server/app/api/auth/resend-verification/route.ts`.
Used by `verify-email.tsx` screen's "Resend Code" button.

## Health endpoint
- Mobile polls `HEAD /api/health` for connectivity. The route lives at `server/app/api/health/route.ts` and `/api/health` must be in `PUBLIC_BYPASS` in `server/middleware.ts` — if it falls off that list, all connectivity polls return 403.

## Known non-issues (intentional design)
- Mobile explore service derives catalog from `GET /api/posts`, not `GET /api/explore` — explore route exists but mobile bypasses it
- Mobile album service is local-only (derived from explore posts) — album API routes exist and are correct but mobile doesn't call them yet

## Response shape notes
- All mobile-facing routes output both camelCase and snake_case fields (mobile normalizers accept either)
- `GET /users/me` returns user flat in data envelope; `PATCH /users/me` returns `{user: ...}` — mobile handles both via `raw?.user ?? raw`
- `GET /credentials/upload-url` returns camelCase (`uploadUrl`, `key`) — mobile normalizes both
