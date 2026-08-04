---
name: MeetSweet API compatibility
description: Mobile-facing API design decisions, content routing rules, and tier system
---

# MeetSweet API — content routing & tier system

## Content type routing (critical)
- `POST /api/posts` **only** accepts `content_type: "post"` (image posts). Returns 422 for video/short/album.
- Videos → `POST /api/videos`; Shorts → `POST /api/shorts`; Albums → `POST /api/albums`
- All four content types share the `posts` table (discriminated by `content_type` column).
- The GET feeds each filter strictly: `/api/posts` GET = content_type='post' only; `/api/videos` GET = 'video' only; etc.

## Subscription tier system
- Tiers (in order): `bronze < silver < gold < diamond`
- Tier prices (credits): bronze=200, silver=500, gold=800, diamond=1000
- `subscriptions.tier` column stores the subscriber's tier (added via migration).
- Posts/videos/shorts have a `tier` column (access gate): users need subscription.tier >= post.tier to view.
- Tier enforcement happens in detail routes (`/api/videos/[id]`, `/api/shorts/[id]`) — returns 403 with code TIER_REQUIRED or SUBSCRIPTION_REQUIRED.
- Feed routes include all content but set `is_locked: true` in the response shape.

**Why:** Previously upgrade/downgrade routes used `free/normal/premium/vip` (mismatched with `posts.tier` which uses `bronze/silver/gold/diamond`). Aligned everything to bronze/silver/gold/diamond.

## Thumbnail rules
- `posts.thumbnail_url` = post-level thumbnail (priority)
- `media.thumbnail_url` = per-media thumbnail (fallback)
- `buildVideoRow` / `buildShortRow` in `lib/services/content.ts` read post-level first, then media-level.

## Key shared helpers (lib/services/content.ts)
- `TIER_ORDER`, `tierIndex()`, `hasTierAccess()`, `canViewContent()` — all tier logic lives here
- `buildVideoRow(row, media, liked, subscribed, comments?, subTier?)` — returns full video shape
- `buildShortRow(row, media, liked, subscribed, subTier?)` — returns full short shape

## Migration
- `server/scripts/migrate.ts` is the canonical migration runner. Run `cd server && npx tsx scripts/migrate.ts` after schema changes.
- It is idempotent (safe to run multiple times). Always add new migrations there.
