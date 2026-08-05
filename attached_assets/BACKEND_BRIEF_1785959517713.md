# MeetSweet — Backend Alignment Brief

## Purpose

The mobile app has been fully migrated off the legacy pay-to-unlock monetization system. This document is the complete specification for what the backend needs to do to match the current app. Read it fully before touching any file.

---

## Product Rules (Non-Negotiable)

These are the rules the entire backend must be built around:

1. **Subscriptions are the only gate.** There is no per-post purchasing, no credits system, no pay-per-view. A user either subscribes to a creator or they don't.
2. **Wallet funds subscriptions.** Users add Naira to their in-app wallet, then use that balance to pay a creator's monthly subscription price.
3. **Three content tiers exist:**
   - `free` — visible to anyone, no account needed
   - `subscriber` — visible only to users with an active subscription to that creator
   - `subscriber_plus` — visible only to users whose subscription is at the `subscriber_plus` tier
4. **Explore shows only free content.** No subscriber-gated post ever appears in the Explore feed regardless of who is requesting.
5. **Home feed shows subscribed content.** Once a user subscribes to a creator, that creator's free + subscriber posts appear in the user's home feed.
6. **DMs are never paid.** No locked messages, no pay-to-read, no unlock flow of any kind.
7. **Albums are separate.** Album purchases are à-la-carte, one-time Naira wallet payments — completely separate from subscriptions. Do not change anything about the album system.

---

## Part 1 — Database Schema Changes

File: `lib/db/schema.ts`

### 1.1 Remove from the `posts` table

```ts
// DELETE this line:
unlock_price: integer("unlock_price"),
```

This column stored the per-post unlock price in the credits system. It no longer exists in the product.

### 1.2 Drop the `post_unlocks` table entirely

```ts
// DELETE this entire table definition:
export const post_unlocks = sqliteTable("post_unlocks", {
  id: id(),
  post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  credits_spent: integer("credits_spent").notNull(),
  created_at: createdAt(),
}, (table) => [
  index("post_unlocks_user_post_idx").on(table.user_id, table.post_id),
]);
```

This table recorded individual post purchases. With per-post purchasing removed, it is dead data.

### 1.3 Remove from the `messages` table

```ts
// DELETE these two lines from the messages table:
is_paid: integer("is_paid", { mode: "boolean" }).notNull().default(false),
paid_price: integer("paid_price"),
```

Paid DMs no longer exist. These columns are dead.

### 1.4 Drop the `message_unlocks` table entirely

```ts
// DELETE this entire table definition:
export const message_unlocks = sqliteTable("message_unlocks", {
  id: id(),
  message_id: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  credits_spent: integer("credits_spent").notNull(),
  created_at: createdAt(),
}, (table) => [
  index("message_unlocks_user_message_idx").on(table.user_id, table.message_id),
]);
```

### 1.5 Write and run the migration

After making the above schema changes, generate and apply the migration. The migration must:

1. Drop `post_unlocks` table
2. Drop `message_unlocks` table
3. Remove `unlock_price` column from `posts`
4. Remove `is_paid` and `paid_price` columns from `messages`

---

## Part 2 — Remove Legacy API Routes

### 2.1 Delete the post unlock route

```
DELETE: app/api/posts/[id]/unlock/route.ts
```

This route handled per-post credit purchases. It is dead — the frontend no longer calls it and the underlying table is being dropped.

### 2.2 Delete the message unlock route

```
DELETE: app/api/messages/[id]/unlock/route.ts
```

Same reason. Dead route, dead table.

---

## Part 3 — Posts API Cleanup

File: `app/api/posts/route.ts`

### 3.1 Remove `unlock_price` from the create schema

```ts
// BEFORE — delete this line from createSchema:
unlock_price: z.number().int().min(0).nullable().optional(),

// AFTER — it simply does not exist in the schema
```

### 3.2 Remove `unlock_price` from the insert payload

```ts
// BEFORE — delete this line from the db.insert(posts).values({...}):
unlock_price: unlock_price ?? null,

// AFTER — the column no longer exists
```

Also remove `unlock_price` from the destructuring of `parsed.data` at the top of the POST handler.

### 3.3 Remove `is_premium` / `isPremium` from the `postRow()` response shape

The mobile app no longer reads these fields. They must be removed from the response to avoid confusion.

```ts
// BEFORE — inside postRow(), delete these two lines:
is_premium: p.visibility === "subscribers" || !!p.tier,
// (also remove any isPremium alias)

// AFTER — only these gating fields remain in the response:
// is_locked / isLocked (already present, computed correctly)
// tier (already present)
```

The full `postRow()` function response shape after cleanup should contain:
- `id`, `content_type`, `creator_id`, `creator_username`, `creator_display_name`, `creator_avatar`, `creator_is_verified`
- `caption`, `title`, `description`, `visibility`, `status`, `is_pinned`
- `tier` — `"free" | "subscriber" | "subscriber_plus" | null`
- `thumbnail_url`, `tags`, `preview_duration`
- `like_count`, `comment_count`, `save_count`, `view_count`
- `published_at`, `created_at`, `updated_at`
- `liked_by_me`, `bookmarked_by_me`
- `is_locked` / `isLocked` — boolean, computed from `canViewContent()`
- `media` — empty array if locked, full array if unlocked

**Do not include** `is_premium`, `isPremium`, `unlock_price`, or any credits-related field.

---

## Part 4 — Content Service Cleanup

File: `lib/services/content.ts`

### 4.1 Remove `is_premium` / `isPremium` from `buildPost()`

```ts
// BEFORE — delete these two lines from buildPost() return shape:
is_premium: row.visibility === "subscribers" || !!row.tier,
isPremium: row.visibility === "subscribers" || !!row.tier,

// AFTER — remove both lines entirely
```

### 4.2 Remove `is_premium` / `isPremium` from `buildVideo()`

Same change — find and remove both `is_premium` and `isPremium` output lines from the `buildVideo()` return shape.

### 4.3 Remove `is_premium` / `isPremium` from `buildShortRow()`

Same change — remove both output lines from `buildShortRow()`.

### 4.4 Keep `canViewContent()` exactly as-is

This function is correct. It determines `is_locked` from tier + subscription status. Do not modify it.

### 4.5 Keep `is_locked` / `isLocked` in all response shapes

These are the fields the app reads. They must stay.

---

## Part 5 — Explore Feed Filtering

**This is the most important functional change.**

The Explore feed must return **only `tier = 'free'` posts**. Right now the `/api/posts` endpoint does not filter by tier when serving Explore content. This means subscriber-gated posts can leak into Explore, which violates the product rules.

### What needs to happen

Wherever the Explore feed query is built (likely inside `app/api/posts/route.ts` GET handler, or a dedicated explore endpoint), add a tier filter:

```ts
// Add this condition to the WHERE clause for Explore queries:
and(
  eq(posts.tier, "free"),        // only free-tier posts
  eq(posts.visibility, "public"), // only publicly visible
  eq(posts.status, "published"),  // only published
)
```

If `tier` is nullable (some older posts may have `tier = null`), treat null as free:

```ts
or(
  eq(posts.tier, "free"),
  isNull(posts.tier)
)
```

The Explore endpoint should **never** require authentication — it shows only public free content.

---

## Part 6 — Home Feed

The authenticated home feed must show:

1. **Free posts** from creators the user follows or subscribes to
2. **Subscriber posts** (`tier = 'subscriber'`) from creators where the user has an **active subscription** at any tier
3. **Subscriber+ posts** (`tier = 'subscriber_plus'`) from creators where the user's active subscription tier is specifically `subscriber_plus`

### Suggested query approach

```ts
// Get the list of creator IDs the user subscribes to (any tier)
const subscribedCreatorIds = await db
  .select({ creator_id: subscriptions.creator_id })
  .from(subscriptions)
  .where(
    and(
      eq(subscriptions.subscriber_id, auth.user.userId),
      eq(subscriptions.status, "active")
    )
  );

// Get creator IDs where user has subscriber_plus specifically
const plusCreatorIds = await db
  .select({ creator_id: subscriptions.creator_id })
  .from(subscriptions)
  .where(
    and(
      eq(subscriptions.subscriber_id, auth.user.userId),
      eq(subscriptions.status, "active"),
      eq(subscriptions.tier, "subscriber_plus")
    )
  );

// Home feed query — posts that the user can see:
// 1. Free posts from subscribed creators
// 2. Subscriber posts from any active subscription
// 3. Subscriber+ posts only from subscriber_plus subscriptions
WHERE posts.creator_id IN (subscribedCreatorIds)
AND (
  posts.tier = 'free'
  OR (posts.tier = 'subscriber' AND posts.creator_id IN (subscribedCreatorIds))
  OR (posts.tier = 'subscriber_plus' AND posts.creator_id IN (plusCreatorIds))
)
AND posts.status = 'published'
ORDER BY posts.published_at DESC
```

The `canViewContent()` function already encodes this logic — you can use it as a post-query filter if the SQL approach is complex.

---

## Part 7 — Wallet & Subscription System (Keep Intact)

Do not change any of the following:

| Area | Status |
|---|---|
| Wallet top-up (Paystack, add Naira) | Keep exactly as-is |
| `subscriptions` table | Keep exactly as-is |
| Subscription price on creator profile | Keep exactly as-is |
| Subscribe/unsubscribe endpoints | Keep exactly as-is |
| `app/api/albums/[id]/purchase/route.ts` | Keep exactly as-is |
| `app/api/albums/[id]/unlock/route.ts` | Keep exactly as-is |
| `album_unlocks` table | Keep exactly as-is |
| `albums` table | Keep exactly as-is |

---

## Part 8 — What the Mobile App Expects From Every Post Response

This is the contract. Every post-related API endpoint must conform to this:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `content_type` | `"post" \| "video" \| "short" \| "album"` | |
| `tier` | `"free" \| "subscriber" \| "subscriber_plus" \| null` | Required |
| `is_locked` | `boolean` | Computed from `canViewContent()` |
| `isLocked` | `boolean` | Same value, camelCase alias |
| `media` | `array` | Empty array if `is_locked = true` |
| `visibility` | `"public" \| "subscribers" \| "draft"` | |
| `liked_by_me` | `boolean` | |
| `bookmarked_by_me` | `boolean` | |

**Must NOT be present in any response:**

| Field | Reason |
|---|---|
| `is_premium` | Removed — app no longer reads it |
| `isPremium` | Removed — app no longer reads it |
| `unlock_price` | Column being dropped |
| `credits_spent` | Table being dropped |

---

## Summary Checklist

- [ ] Drop `post_unlocks` table (migration)
- [ ] Drop `message_unlocks` table (migration)
- [ ] Remove `unlock_price` column from `posts` (migration)
- [ ] Remove `is_paid`, `paid_price` columns from `messages` (migration)
- [ ] Delete `app/api/posts/[id]/unlock/route.ts`
- [ ] Delete `app/api/messages/[id]/unlock/route.ts`
- [ ] Remove `unlock_price` from `createSchema` in posts route
- [ ] Remove `unlock_price` from `db.insert` in posts route
- [ ] Remove `is_premium` / `isPremium` from `postRow()` in posts route
- [ ] Remove `is_premium` / `isPremium` from `buildPost()` in content service
- [ ] Remove `is_premium` / `isPremium` from `buildVideo()` in content service
- [ ] Remove `is_premium` / `isPremium` from `buildShortRow()` in content service
- [ ] Explore feed: add `tier = 'free'` filter to query
- [ ] Home feed: query returns free + subscriber posts for subscribed creators only
- [ ] Verify wallet top-up and subscription payment flows still work end-to-end
- [ ] Verify album purchase flow still works end-to-end

---

*Document written against the MeetSweet backend source as of the current state. The mobile app is already fully aligned with this specification — the app will work correctly the moment the backend implements these changes.*
