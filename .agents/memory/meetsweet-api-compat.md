---
name: MeetSweet API compatibility
description: Mobile is source of truth for the API contract; backend adapted to match.
---

# MeetSweet API Compatibility

## Rule
The mobile app (`services/`, `contexts/`, `lib/api-client-react/`) is the source of truth.
Backend routes must match the exact request fields and response shapes the mobile expects.

**Why:** Mobile is shipped to end-users and cannot be hot-patched; the backend can be deployed at any time.

## Mobile normalizer patterns
- Snake_case and camelCase are both checked with `??`: `raw.mediaUrl ?? raw.media_url`
- `apiFetch` unwraps the `{ ok: true, data: ... }` envelope automatically
- `requestUploadUrl` in `services/credentials/index.ts` normalizes both `uploadUrl`/`upload_url`, `key`/`object_key` — backend can return either

## Key sync performed (July 2026)
- Added `caption`, `mime_type`, `file_name`, `file_size`, `audio_duration`, `is_paid`, `paid_price` to `messages` table
- Added `thumbnail_url`, `file_name` to `media` table
- Expanded `media.type` enum: image | video | **audio | document | other**
- New table: `message_unlocks` (unique on message_id + user_id)
- New route: `PATCH /api/messages/:id` — edit own message
- New route: `POST /api/messages/:id/unlock` — unlock paid content via credits
- `POST /api/conversations/:id/messages` schema expanded for all new fields
- `GET /api/conversations/:id/messages` response includes all new fields + unlock status
- `GET /api/explore` now returns `media[]` array on each post
- `POST /api/media` and `POST /api/media/upload` expanded to accept audio/document/other
- `GET /api/conversations` unread count now correct when `last_read_at` is null

## Migration required on production
Run `cd server && npx tsx scripts/migrate.ts` once to apply ALTER TABLE statements.
