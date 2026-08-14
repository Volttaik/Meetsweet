# MeetSweet Backend Specification

> **Authoritative blueprint.** Derived from the actual `MeetSweet-mobile` Expo
> application (the source of truth for expected client behaviour), compared
> against the existing backend in this repository (`server/`).
>
> This document describes **what the mobile app expects**, **what the server
> must receive / do / return**, and **what is currently missing, broken, or
> legacy**. Reconstruction of the backend must follow this document.

---

## 1. Stack & Conventions

- **Runtime:** Next.js 15 (App Router route handlers), Node ≥ 20, TypeScript.
- **Database:** Turso (libSQL) via Drizzle ORM. Schema source of truth:
  `server/lib/db/schema.ts`.
- **Storage:** Cloudflare R2 (S3-compatible) — `server/lib/services/r2.ts` and
  `app/api/media/upload/route.ts`.
- **Email:** Resend — `server/lib/services/email.ts`.
- **Payments:** Paystack — `server/app/api/payments/*`.
- **Auth:** Argon2 password hashing + `jose` JWTs. Access token 15m, refresh
  token 30d (rotated on use, stored hashed in `refresh_tokens`).

### Wire contract (both sides must agree exactly)

- **Base URL:** `EXPO_PUBLIC_API_URL` or `https://meetsweet.space/api`.
- **Headers on every request:** `X-Client-App-Id: meetsweet-mobile`
  (mobile already sends this on every call), `Content-Type: application/json`,
  and `Authorization: Bearer <access_token>` when authenticated.
- **Success envelope:** `{ ok: true, data: <payload>, message? }`.
  The mobile `apiFetch` unwraps `data` and returns it directly.
- **Error envelope:** `{ ok: false, error: <message>, code?: <string> }` with a
  non-2xx status. The mobile `apiFetch` surfaces `error` (or `message`) and
  `code` as `ApiError`.
- **401 semantics:** a 401 on an *already authenticated* request triggers a
  transparent refresh+retry in the mobile client (`POST /auth/refresh`). A 401
  on login/register is a normal auth error, not a session expiry.
- **Field naming:** the backend returns snake_case and the mobile normalizers
  accept both snake_case and camelCase. Backend must not rely on a single
  casing; keep returning the canonical snake_case field **plus** its camelCase
  alias where the mobile normalizer reads camelCase (many existing routes do
  this already — preserve the pattern).

---

## 2. Authentication

Mobile entry points: `contexts/AuthContext.tsx`, `services/api.ts`,
`app/login`, `app/register`, `app/create-account`, `app/verify-email`,
`app/forgot-password`.

| Mobile call | Backend route (must exist) | Request → Response |
|---|---|---|
| `login` | `POST /auth/login` | `{ email, password, device_id? }` → `{ access_token, refresh_token, token_type, expires_in, user }` |
| `register` | `POST /auth/register` | `{ full_name, username, email, password, confirm_password, phone?, bio?, date_of_birth?, avatar_url? }` → `{ user_id }` (and optionally `message`, `requires_verification`, `email`) |
| refresh | `POST /auth/refresh` | `{ refresh_token }` → `{ access_token, refresh_token, token_type, expires_in }` |
| logout | `POST /auth/logout` (Bearer) | revoke refresh token |
| logout all | `POST /auth/logout-all` (Bearer) | revoke all refresh tokens |
| change password | `POST /auth/change-password` (Bearer) | `{ current_password, new_password }` |
| verify email | `POST /auth/verify-email` | `{ code, email? }` |
| resend verification | `POST /auth/resend-verification` | `{ email? }` |
| forgot password | `POST /auth/forgot-password` | `{ email }` |
| reset password | `POST /auth/reset-password` | `{ code, email, new_password }` |
| delete account | `DELETE /users/me` (Bearer) | `{ password }` |

**Email verification is mandatory.** No SMS OTP. Login of an unverified
account must return `403 { code: "EMAIL_NOT_VERIFIED" }` (already implemented)
and re-send the code. The mobile app persists the session token locally in
SQLite (`lib/session-storage.ts`), so sessions must remain valid until
expiry/logout/revocation.

### Current backend status

- ✅ `login`, `refresh` (rotating), `logout`, `logout-all`, `change-password`,
  `verify-email`, `resend-verification`, `forgot-password`, `reset-password`,
  `delete-account` exist.
- ❌ **`register` does NOT return `user_id`.** It returns
  `{ message, requires_verification, email }`. `AuthContext.register` reads
  `result.user_id || result.id` and both are undefined — the registration →
  verification flow is broken end-to-end.
- ❌ **Username availability** is at `/auth/username-availability`, but the
  mobile `users.ts` calls `GET /users/check-username?username=`. Needs an
  alias at `/users/check-username`.
- ❌ **Delete account** mobile call is `DELETE /users/me {password}`, backend
  has `DELETE /auth/delete-account`. Needs an alias (or move).

---

## 3. Users & Profiles

User fields the mobile `normalizeUser` consumes (must be present on
`GET /users/me` and profile responses):

```
id, full_name, username, email, phone, bio, avatar_url, banner_url, website,
location, is_verified, is_creator, is_verified_creator, role,
subscriber_count, subscribing_count, post_count, created_at
```

| Mobile call | Backend route | Notes |
|---|---|---|
| `getMe` | `GET /users/me` | already returns the joined user at the top level ✅ |
| `updateMe` | `PATCH /users/me` | returns `{ user }` ✅ (keep `{ user }` wrapper) |
| `getUserProfile` | `GET /users/:username` | returns `{ user }` ✅ |
| `searchUsers` | `GET /users/search?q=` | returns `{ users }` ✅ (requires auth) |
| block | `POST /users/:username/block` | ✅ |
| unblock | `DELETE /users/:username/block` | ✅ |
| report | `POST /users/:username/report {reason}` | ✅ |

**Nothing the user enters may be silently dropped.** `PATCH /users/me` already
accepts `bio`, `avatar_url`, `banner_url`, `website`, `location`, `phone`,
`username`, `full_name`, `display_name`. Register should also persist
`date_of_birth` if supplied (currently dropped — add a `date_of_birth` column
or store in profile).

---

## 4. Settings (privacy / notifications / app)

Mobile `services/settings.ts` calls these routes:

| Mobile call | Expected route | Backend today |
|---|---|---|
| `getPrivacySettings` / `updatePrivacySettings` | `GET/PATCH /users/me/privacy` | `/settings/privacy` ❌ mismatch |
| `getNotificationSettings` / `updateNotificationSettings` | `GET/PATCH /users/me/notifications` | `/settings/notifications` ❌ mismatch |
| `getSettings` / `updateSettings` | `GET/PATCH /users/me/settings` | `/settings` ❌ mismatch |
| `deleteAccount` | `DELETE /users/me {password}` | `/auth/delete-account` ❌ mismatch |
| `logoutAllDevices` | `POST /auth/logout-all` | ✅ |
| `updatePassword` | `POST /auth/change-password` | ✅ |

**Required:** add `/users/me/privacy`, `/users/me/notifications`,
`/users/me/settings` route handlers (thin re-exports of the existing
`/settings/*` logic) and `DELETE /users/me`. Keep the `/settings/*` routes for
backward compatibility. Privacy fields that exist in `user_settings` but are
**not** in the backend privacy PATCH schema include `message_perm` and
`profile_visibility` — these are mobile fields; either add columns or map them
to existing equivalents.

---

## 5. Content Model (posts / videos / shorts / albums)

Content is a **single `posts` table** with `content_type`:
`post | video | short | album`. "Videos" and "shorts" are video posts; shorts
are distinguished by `content_type = 'short'`. Albums have a first-class
`albums` table + `media` items.

### Tiers & visibility (server-enforced, never client-trusted)

- `tier`: `free | subscriber | subscriber_plus` (null = free).
- `visibility`: `public | subscribers | draft`.
- Access rule (implemented in `lib/services/content.ts:canViewContent`):
  - owner → always;
  - draft → never (except owner);
  - free/public → everyone;
  - `subscriber` tier → any active subscription to that creator;
  - `subscriber_plus` tier → only `subscriber_plus` subscription.
- Locked content must omit `media` / `video_url` (already done).

### Posts endpoints (mobile contract)

| Mobile call | Route | Status |
|---|---|---|
| `getHomeFeed(page)` | `GET /posts/feed?page=` | ❌ backend implements `GET /posts?feed=home`. `/posts/feed` currently matches `/posts/[id]` (404). Add a `/posts/feed` route (or `rewrites`) |
| `getBookmarkedPosts()` | `GET /posts/bookmarks` | ❌ backend implements `GET /posts?bookmarked=true`. `/posts/bookmarks` currently matches `[id]` (404). Add route |
| `getPostsByCreator` | `GET /posts?creatorId=` (camelCase) | ❌ backend reads `creator_id`. Accept both `creatorId` and `creator_id` |
| video feed | `GET /posts?cursor=&limit=` (client filters `content_type != short`) | ✅ |
| shorts feed | `GET /posts?content_type=short&cursor=&limit=` | ✅ |
| `getPost` | `GET /posts/:id` | ✅ |
| `createPost` | `POST /posts` | ✅ (returns `{ id }`; mobile reads `resp.post || resp` — return `{ post }` too) |
| `editPost` | `PATCH /posts/:id` | ✅ |
| `deletePost` | `DELETE /posts/:id` | ✅ |
| like/unlike | `POST/DELETE /posts/:id/like` | ✅ |
| bookmark | `POST/DELETE /posts/:id/bookmark` | ✅ |
| report | `POST /posts/:id/report {reason}` | ✅ |
| view | `POST /posts/:id/view` | ✅ |
| comments-enabled | `PUT /posts/:id/comments-enabled {enabled}` | ❌ missing |

`createPost` payload must persist **everything**: `content`, `caption`,
`title`, `content_type`, `visibility`, `tier`, `media_urls`/`media_ids`,
`thumbnail_url`, `categories`/`category_id`, `tags`, `is_subscribers_only`,
`comments_enabled`. No field may be silently dropped. `is_subscribers_only`
must map to `visibility: 'subscribers'`/`tier` server-side.

---

## 6. Explore, Search, Categories

| Mobile call | Route | Status |
|---|---|---|
| `getExploreFeed(category?)` | `GET /explore?category=` → `{ items }` | ✅ backend returns `items` (+ `posts/videos/shorts/albums/users`) |
| `getCategories` | `GET /categories` → `{ categories }` | ✅ |
| search (screen) | `GET /search?q=&type=` | ✅ (route exists) |
| recent / trending search | `GET /search/recent`, `GET /search/trending` | ✅ |

Rules: Explore shows **only free/public content** (already enforced);
subscriber-gated content must never appear. Search returns unambiguous
objects with `id` + `content_type`.

---

## 7. Albums

Mobile `services/albums.ts` contract:

| Call | Route | Request → Response |
|---|---|---|
| `getAlbums({cursor,creatorId,limit})` | `GET /albums?cursor=&creator_id=&limit=&purchased=` | `{ albums, next_cursor, has_more }` |
| `getAlbum(id)` | `GET /albums/:id` | `{ album }` |
| `createAlbum` | `POST /albums` | `{ id }` |
| `updateAlbum` | `PATCH /albums/:id` | `{ album }` |
| `deleteAlbum` | `DELETE /albums/:id` | 204 |
| `purchaseAlbum` | `POST /albums/:id/purchase` | `{ purchased }` |
| `getPurchasedAlbums` | `GET /albums?purchased=true` | `{ albums }` |

**Album object the mobile renders** (from `normalizeAlbum`):
`id, title, description, cover_url, preview_urls[], items[], item_count,
requiresPurchase (is_premium or price>0), price (Naira), gradient,
is_unlocked_by_me, creator{...}, created_at, updated_at`.

Backend today returns `price_credits`, `is_premium`, `unlocked`, `is_unlocked`
— close but must also emit `is_unlocked_by_me` (or `isUnlockedByMe`) and treat
`price_credits` as the Naira price the mobile calls `price`. **Purchase must
be wallet-authoritative**: deduct from `wallets.balance`, record a
`transactions` row, and insert `album_unlocks` atomically; never trust a
client "purchased" flag. `album_unlocks.credits_spent` = price.

---

## 8. Subscriptions

Mobile `services/subscriptions.ts` + `app/creator/[id].tsx`:

| Call | Route | Status |
|---|---|---|
| `subscribe(creatorId, plan)` | `POST /creators/:creatorId/subscribe {plan}` | ❌ backend is `POST /subscriptions {creator_id, tier}`. Add alias. `plan` maps to `tier` (`subscriber` / `subscriber_plus`) |
| `getCreatorMessagingSettings(creatorId)` | `GET /creators/:creatorId/messaging-settings` | ❌ missing. Must return `{ who_can_message }` from that creator's `creator_settings` |

**Server-authoritative.** The backend already computes price from
`creator_settings.subscription_price` / `subscription_plus_price`, charges the
wallet atomically, inserts a `subscriptions` row (`status: active`), records a
`transactions` row, and notifies the creator. Idempotency: re-subscribing an
active subscription returns the existing one. `subscriptions/check/:creatorId`
exists for access checks. Also support upgrade/downgrade/cancel (exist).

`GET /subscriptions?type=subscribers` already serves a creator's own
subscriber list (used for the missing `/creator/subscribers` alias).

---

## 9. Wallet, Payments, Withdrawals

Consumer (mobile `services/wallet.ts`):

| Call | Route | Status |
|---|---|---|
| `getWallet` | `GET /wallet` → `{ balance, currency, transactions }` | ⚠️ backend returns only `{ balance, currency }`. Must include `transactions` (from `transactions` table) |
| `initiateWalletDeposit` | `POST /payments/initiate-paystack {amount}` | ✅ returns `{ transactionId, reference, authorizationUrl, accountNumber, bankName, amount }` |
| `verifyWalletDeposit` | `POST /payments/verify-paystack {transactionId}` | ✅ returns `{ success, amountAdded, newBalance }` |

Creator payout (mobile expects `/creator/wallet/*`, backend has `/payments/*`
and `/creator/withdraw`):

| Mobile call | Expected route | Backend today |
|---|---|---|
| `getCreatorBalance` | `GET /creator/wallet/balance` | `/payments/balance` ❌ |
| `getBankDetails` | `GET /creator/wallet/bank-details` | `/payments/save-bank-details` (POST only) ❌ |
| `saveBankDetails` | `POST /creator/wallet/bank-details` | `/payments/save-bank-details` ❌ |
| `requestWithdrawal` | `POST /creator/wallet/withdraw` | `/payments/withdraw` + `/creator/withdraw` ❌ |
| `getWithdrawalHistory` | `GET /creator/wallet/withdrawals` | `/payments/withdrawal-history` ❌ |

**Required:** add `/creator/wallet/*` handlers (balance, bank-details
GET/POST, withdraw POST, withdrawals GET). Financial safety: wallet balance is
server-calculated; debit is atomic; withdrawals must be idempotent (dedupe by
amount+status+recent, or a reference) and never double-debit. Verify Paystack
server-side; never credit on client claim. Prevent duplicate credits via
`transactions.reference`/`paystack_ref` uniqueness check.

---

## 10. Creators

### Public profile (`services/creators.ts`)

| Call | Route | Status |
|---|---|---|
| `getCreatorProfile(username)` | `GET /creators/:username` → `{ creator, posts, albums }` | ⚠️ backend `/creators/[id]` exists — verify it returns `posts` + `albums` inline, not just creator |
| `getCreators` | `GET /creators` → `{ creators }` | ✅ |
| `getCreatorById` | `GET /creators/:usernameOrId` | ✅ (must include `subscribed`, `subscription_price`, `subscription_plus_price`, `who_can_message`, counts) |
| content posts/videos/shorts | `GET /creators/:id/posts|/videos|/shorts` | ✅ |
| content albums | `GET /albums?creator_id=` | ✅ |
| reviews | `GET /creators/:id/reviews` | ✅ |

### Own dashboard (`services/creator.ts`)

| Call | Route | Status |
|---|---|---|
| `getCreatorDashboard` | `GET /creator/dashboard` → `{ total_revenue, active_subscribers, total_posts, period_stats[] }` | ❌ backend has `/creator/statistics`. Add `/creator/dashboard` alias that returns **this exact shape** |
| `getCreatorSettings` / `updateCreatorSettings` | `GET/PATCH /creator/settings` | ✅ (verify it returns `who_can_comment`, `who_can_see`, `subscriptions_enabled` too) |
| `getCreatorSubscribers(page)` | `GET /creator/subscribers?page=` → `{ subscribers: [{id, username, display_name, avatar_url, subscribed_at}] }` | ❌ add alias over `/subscriptions?type=subscribers` |
| become creator | `POST /creator/become` | ✅ |

**No fake analytics.** `/creator/dashboard` must compute from real
`creator_statistics` + live `subscriptions`/`posts` counts. The mobile
fallback zeros are only for the pre-layout error path, not a substitute for
real data.

---

## 11. Notifications & Push

| Call | Route | Status |
|---|---|---|
| `getNotifications(page)` | `GET /notifications?page=` → `{ notifications, unread_count }` | ✅ |
| `markNotificationRead` | `POST /notifications/:id/read` | ✅ |
| `markAllNotificationsRead` | `POST /notifications/read-all` | ✅ |
| `deleteNotification` | `DELETE /notifications/:id` | ✅ |
| `registerPushTokenToBackend` | `POST /notifications/push-token {token, platform}` | ✅ |

Every notification must carry enough routing data (`data.content_type`,
`entity_id`, `post_id`/`video_id`/`short_id`/`album_id`/`comment_id`,
`actor_*`) — already done. Push delivery via `lib/services/push.ts`.
Notification preferences in `user_settings.notif_*` must actually gate
delivery (currently `push.ts` may not consult them — verify and enforce).

---

## 12. Messaging — **Chat Rooms** (replaces legacy conversations)

This is the largest gap. The mobile app uses a **USER → ROOM → CONTENT**
model and explicitly states there is **no fallback to a conversation
architecture**. The backend still only implements the legacy
`/conversations` + `/messages` model.

### Identifiers (never conflate)

- `chatRoomId` — permanent room, one per user pair (A+B == B+A), server-owned.
- `contextId` — one participant's context inside a room (per room+user).
- `contextAuth` — server-controlled membership map
  `{ message_ids?, removed_message_ids?, marker? }` for delete-for-me /
  delete-for-everyone / clear semantics.
- `messageId` — one message, server-owned.

### Required routes (mobile `services/room-service.ts`)

| Method + path | Request → Response |
|---|---|
| `POST /chat-rooms` | `{ participant_id }` → `{ chat_room_id, created, context_id, participants, other_user, ... }` |
| `GET /chat-rooms?tab=all\|archived` | `{ chat_rooms: [...] }` |
| `GET /chat-rooms/:chatRoomId` | `{ chat_room }` |
| `GET /chat-rooms/:chatRoomId/context?since=` | `{ chat_room_id, context_id, context_auth }` |
| `GET /chat-rooms/:chatRoomId/messages?before=&after=` | `{ messages, has_more }` |
| `POST /chat-rooms/:chatRoomId/messages` | `{ body, media_url, media_type, caption, file_name, file_size, mime_type, audio_duration, file_type, is_voice_note, reply_to_id }` → `{ message }` |
| `POST /chat-rooms/:chatRoomId/read` | mark room read |
| `POST /chat-rooms/:chatRoomId/clear` | clear current user's context |
| `GET /chat-rooms/:chatRoomId/changes?since=` | `{ changed, marker, messages? }` |
| `DELETE /chat-rooms/:chatRoomId/messages/:messageId?scope=me\|everyone` | delete from one/both contexts |
| `PATCH /chat-rooms/:chatRoomId/messages/:messageId` | `{ body }` (edit) |
| `POST /chat-rooms/:chatRoomId/messages/:messageId/reactions` | `{ emoji }` → `{ reactions }` |
| `PUT /chat-rooms/:chatRoomId/mute` | `{ muted }` |
| `PUT /chat-rooms/:chatRoomId/archive` | `{ archived }` |
| `DELETE /chat-rooms/:chatRoomId` | remove from current user's list |

**Message payload must preserve voice/file metadata** (`file_type`,
`is_voice_note`) — the backend `messages` table already has `media_type`,
`mime_type`, `file_name`, `file_size`, `audio_duration`, `is_edited`,
`is_recalled`, `reactions` columns (add `file_type`, `is_voice_note` if
needed). Blocking must be reflected server-side (room inactive/blocked state)
rather than only client-local.

### Chat access rules (server-enforced)

`creator_settings.who_can_message`: `everyone | subscribers | none`.
Non-subscriber messaging a restricted creator must receive a clear error
(`403` with a code the mobile can use to redirect to the creator profile for
subscription). The backend must enforce this on room creation/message send —
not the UI alone.

**Legacy removal:** the `/conversations` and standalone `/messages` routes and
the `conversations`/`conversation_members` tables are the legacy architecture.
They are superseded by chat rooms. Migrate: create `chat_rooms`,
`chat_room_members` (with per-member context/archive/mute/clear state), and
reuse `messages` (renamed/aliased as room messages) — or a new
`chat_room_messages` table. Keep the old tables only as long as migration
requires; document and stop serving them as the active path.

---

## 13. Comments — **Comment Rooms**

The mobile app uses a **Comment Room** model
(`services/comment-room-service.ts`); the backend still only exposes
post-scoped `/posts/:id/comments`.

- Every post has a `comment_room_id` returned in post data
  (mobile `normalizePost` reads `comment_room_id`).
- Comments belong to `commentRoomId`, never to a user conversation.

### Required routes

| Method + path | Request → Response |
|---|---|
| `GET /comment-rooms/:commentRoomId` | `{ comment_room: { comment_room_id, post_id, comments_enabled, comment_count } }` |
| `GET /comment-rooms/:commentRoomId/comments?after=` | `{ comments, has_more }` |
| `POST /comment-rooms/:commentRoomId/comments` | `{ body, parent_id? }` → `{ comment }` |
| `GET /comment-rooms/:commentRoomId/comments/changes?since=` | `{ changed, marker, comments? }` |
| `GET /comment-rooms/:commentRoomId/comments/:commentId/replies` | `{ replies }` |
| `PATCH /comment-rooms/:commentRoomId/comments/:commentId` | `{ body }` |
| `DELETE /comment-rooms/:commentRoomId/comments/:commentId` | delete |
| `POST/DELETE /comment-rooms/:commentRoomId/comments/:commentId/like` | `{ like_count }` |
| `PUT /posts/:postId/comments-enabled` | `{ enabled }` (post owner only) |

The Comment Room is **not deleted** when comments are disabled — it stays
associated with the post and can be re-enabled. Backend must enforce
`comments_enabled` on submission. The existing `comments` table already
carries `post_id`, `author_id`, `body`, `is_pinned`, `like_count`,
`reply_count`, and `comment_replies` handles threading — add a
`comment_rooms` table (or a stable `comment_room_id` per post) and map the
new routes onto the existing comments tables.

**Comment IDs are distinct from Post IDs, Comment Room IDs, and User IDs.**

---

## 14. Media & Uploads

| Mobile call | Route | Status |
|---|---|---|
| `uploadMedia(uri, mime, name)` | `POST /upload` (multipart `file`) → `{ id, url, media_type }` | ❌ backend is `POST /media/upload` returning `{ media: { id, url, type, ... } }`. Add `/upload` alias returning top-level `{ id, url, media_type }` |
| create-post cleanup | `DELETE /media/:id` | ✅ |

Uploads must be associated with the originating user (and optionally `post_id`).
Never accept an upload and lose its relationship. R2 direct upload/download
credential routes (`/credentials/upload-url`, `/credentials/download-url`)
are the scoped-credential broker for client-direct transfers.

---

## 15. Sharing / Deep Links

| Mobile call | Route | Status |
|---|---|---|
| `createShareLink(type, id)` | `POST /share/create {type, target_id}` → `{ share_url }` | ❌ backend is `POST /shares {content_type, content_id}`. Add alias mapping `type`→`content_type`, `target_id`→`content_id` |
| `resolveShareLink(token)` | `GET /share/resolve/:token` | ❌ backend is `GET /shares/:token`. Add alias |

Share token resolves via the `/s/[token]` web page (backend `app/s/[token]`).

---

## 16. Data Integrity Rules (must not regress)

1. No field received but not persisted; no field persisted but not returned.
2. Return snake_case **and** camelCase aliases the mobile normalizers read.
3. IDs: user ID ≠ creator ID (they are the same `users.id`, but creator-scoped
   queries must filter by `is_creator`/ownership appropriately — never confuse
   a profile ID with a creator ID in routes like `/creators/:id`).
4. Post ID ≠ comment room ID ≠ comment ID ≠ user ID.
5. No fake success: a failed operation must return a non-2xx error with a
   `code`, never `200 { ok: true }` on failure.
6. No silent exceptions; log and return `{ ok:false, error, code }`.
7. Financial ops atomic + idempotent (see §9).
8. Never trust client-provided ownership / `purchased` / `is_subscribed` /
   `balance` fields.

---

## 17. Authorization Rules

- Auth required for: all writes, `/users/me`, chat, notifications, wallet,
  subscriptions, creator dashboard, uploads.
- Ownership checks: users can only mutate their own posts/albums/comments/
  messages/wallet/settings.
- Subscription access: server verifies `subscriptions` state (never a client
  `isSubscribed` flag).
- Album access: server verifies `album_unlocks` (never a client
  `purchased: true`).
- Messaging: server enforces `who_can_message` + block state.

---

## 18. Legacy Systems To Remove / Replace

1. **Conversations** (`/conversations`, `/messages` routes, `conversations`,
   `conversation_members` tables) → replaced by **Chat Rooms**.
2. **Post-scoped comments** (`/posts/:id/comments`, `/comments/:commentId/replies`)
   → superseded by **Comment Rooms** (keep as internal impl or aliases during
   migration).
3. **Credential broker** (`/credentials/*`, `credential_grants` table): retain
   only if the mobile actually uses the presigned R2 upload/download flow;
   otherwise mark legacy and remove. (Verify mobile usage before deleting.)
4. `archives` table — appears unused by the current mobile; verify and drop or
   document.
5. `creator_reviews` / `/creators/:id/reviews` — mobile `useCreatorReviews`
   is currently a **stub**; either wire it to real reviews or remove the stub.

---

## 19. Missing Backend Capabilities (summary)

- `POST /auth/register` → return `user_id`.
- `GET /users/check-username`.
- `DELETE /users/me`.
- `/users/me/privacy|notifications|settings` aliases.
- `GET /posts/feed`, `GET /posts/bookmarks`, `?creatorId=` alias,
  `PUT /posts/:id/comments-enabled`.
- `/upload` alias (+ top-level media response shape).
- `/share/create`, `/share/resolve/:token` aliases.
- `POST /creators/:creatorId/subscribe`, `GET /creators/:creatorId/messaging-settings`.
- `GET /creator/dashboard`, `GET /creator/subscribers`.
- `/creator/wallet/*` (balance, bank-details, withdraw, withdrawals).
- `GET /wallet` → include `transactions`.
- **Chat Rooms** (full subsystem).
- **Comment Rooms** (full subsystem).
- `POST /albums` price in Naira + `is_unlocked_by_me` response fields.

---

## 20. Required Migrations

- `users.date_of_birth` (or profile) for registration payload.
- `chat_rooms`, `chat_room_members`, `chat_room_messages` (or reuse `messages`
  with room FK); per-member `context_auth` storage for delete-for-me/clear.
- `comment_rooms` table (or `comment_room_id` on posts + stable id).
- `user_settings`: add `profile_visibility`, `message_perm` (or map to
  existing columns).
- Wallet/transaction idempotency index on `reference`.
- Indexes for the new room/message/comment queries.

---

## 21. Final Mobile ↔ Backend Contract Check (by feature)

For each feature the chain must hold end-to-end:

```
mobile service → route → auth → validation → DB → business logic → response
→ mobile normalize → local persistence → UI
```

| Feature | Status |
|---|---|
| Register → verify email → login | ⚠️ broken (`user_id` missing) |
| Session persist + refresh | ✅ |
| Profile get/update | ✅ |
| Settings (privacy/notifications/app) | ❌ route mismatch |
| Home feed / bookmarks | ❌ route mismatch |
| Post create/edit/delete/like/bookmark/report/view | ✅ (add `{ post }` wrapper + comments-enabled) |
| Videos / shorts feeds | ✅ |
| Albums (list/detail/create/purchase) | ⚠️ price/field semantics + purchase atomicity |
| Explore / search / categories | ✅ |
| Subscribe / messaging rules | ❌ route mismatch + missing messaging-settings |
| Wallet deposit/verify | ✅ (add transactions to `/wallet`) |
| Creator dashboard / subscribers / settings | ❌ route mismatch |
| Creator wallet / bank / withdrawals | ❌ route mismatch |
| Messaging (chat rooms) | ❌ **entire subsystem missing** |
| Comments (comment rooms) | ❌ **entire subsystem missing** |
| Notifications / push | ✅ |
| Sharing / deep links | ❌ route mismatch |
| Media upload | ❌ route mismatch |

---

## 22. Reconstruction Order

1. Auth fixes (register `user_id`, username check, delete-account alias).
2. Settings aliases (`/users/me/*`).
3. Content route aliases (`/posts/feed`, `/posts/bookmarks`, `creatorId`,
   comments-enabled).
4. Upload / share / subscribe / messaging-settings / dashboard / subscribers /
   creator-wallet aliases.
5. Wallet `transactions` on `/wallet`; idempotency for deposits/withdrawals.
6. **Chat Rooms** subsystem (tables + routes + context auth + polling changes).
7. **Comment Rooms** subsystem.
8. Clean mobile fake data (explore catalog stubs, creator-reviews stub,
   dashboard/wallet zero-fallbacks where they mask real data).
9. Typecheck both repos; end-to-end verify.
