---
name: MeetSweet API compatibility
description: Mobile-facing API design decisions, content routing rules, and tier system
---

# MeetSweet API — content routing & tier system

## Tier System (current — August 2026)

### Content tiers (posts.tier column)
- `free` → public, visible on Explore, no gate
- `subscriber` → any active subscriber can view
- `subscriber_plus` → only `subscriber_plus` subscription holders can view
- `null` → use `visibility` field to determine access

### Subscription tiers (subscriptions.tier column)
- `subscriber` → pays creator's `subscription_price` (1×)
- `subscriber_plus` → pays `subscription_price × 2` (exclusive, most premium)

### Access logic (`lib/services/content.ts`)
- `TIER_ORDER`: `["free", "subscriber", "subscriber_plus"]`
- `canViewContent(visibility, requiredTier, isSubscribed, subscriptionTier, isOwner)`:
  - `tier === "free"` or (`visibility === "public"` && no tier) → everyone can view
  - `tier === "subscriber"` → any active subscription qualifies
  - `tier === "subscriber_plus"` → only `subscriber_plus` subscription holders
  - draft → always hidden

### Content type routing (critical)
- `POST /api/posts` accepts all `content_type` values: post/video/short/album
- `GET /api/videos` feed: includes ALL published non-draft videos (public + subscriber)
- `GET /api/posts` feed: includes ALL published non-draft posts — `is_locked` set per item
- `GET /api/shorts/feed`: public only (shorts have NO tiers — always public)
- `GET /api/explore`: public only (discovery feed)
- Shorts have NO tier — `tier` is always `null`; visibility defaults to `public`

**Why feeds were changed:** Previously `eq(posts.visibility, "public")` filter dropped all subscriber content from feeds. Fixed to exclude only `draft` — items appear in feed but `is_locked: true` if viewer not subscribed.

### Albums
- Albums have their own `price_credits` — no tier gating
- Access via `/api/albums/:id/purchase` (wallet-based unlock)

### Subscription pricing routes
- `POST /api/subscriptions` — body: `{ creator_id, tier?: "subscriber" | "subscriber_plus" }`
- `POST /api/subscriptions/:id/upgrade` — body: `{ tier: "subscriber_plus" }`
- `POST /api/subscriptions/:id/downgrade` — body: `{ tier: "subscriber" }`

### Paystack payment flow (wallet top-up)
- `POST /api/payments/initiate-paystack` — body: `{ amount: number }` (Naira)
  → calls Paystack Initialize Transaction (NOT dedicated_account)
  → returns `{ transactionId, reference, authorization_url, access_code, amount }`
- `POST /api/payments/verify-paystack` — body: `{ reference: string }`
  → verifies with Paystack, credits wallet
  → returns `{ success, amountAdded, newBalance }`

## Key shared helpers (`lib/services/content.ts`)
- `TIER_ORDER`, `tierIndex()`, `hasTierAccess()`, `canViewContent()` — all tier logic here
- `buildVideoRow(row, media, liked, subscribed, comments?, subTier?)` — full video shape
- `buildShortRow(row, media, liked, subscribed, subTier?)` — full short shape

## Migration
- `server/scripts/migrate.ts` — canonical migration runner, idempotent
- Run: `cd server && npx tsx scripts/migrate.ts`
- Includes data migration: bronze→free, silver/gold→subscriber, diamond→subscriber_plus in `posts.tier`
- Includes data migration: bronze/silver/gold→subscriber, diamond→subscriber_plus in `subscriptions.tier`
