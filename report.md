# MeetSweet Backend Specification

> **Authoritative blueprint.** Derived from the actual `MeetSweet-mobile` Expo
> application (the source of truth for expected client behaviour), compared
> against the existing backend in this repository (`server/`).
>
> This document describes **what the mobile app expects**, **what the server
> must receive / do / return**, and **what is currently missing, broken, or
> legacy**.
>
> **Status last refreshed: 2026-08-14.** The backend is now essentially
> complete against the mobile contract — the previously-missing Chat Rooms,
> Comment Rooms, creator-wallet, settings aliases, and share/upload aliases are
> all implemented. Remaining items are listed in §19.

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
  token 30d (rotated on use, stored hashed in `refresh_tokens`). TOTP 2FA via
  `lib/security/totp.ts` (AES-256-GCM encrypted secrets at rest).

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
  alias where the mobile normalizer reads camelCase.

---

## 2. Authentication

Mobile entry points: `contexts/AuthContext.tsx`, `services/api.ts`,
`app/auth.tsx`, `app/register.tsx`, `app/verify-email.tsx`,
`app/forgot-password.tsx`, `app/two-factor.tsx`.

| Mobile call | Backend route (must exist) | Request → Response |
|---|---|---|
| `login` | `POST /auth/login` | `{ email, password, device_id? }` → `{ access_token, refresh_token, token_type, expires_in, user }` — **or** `{ requires_2fa: true, challenge_token, user }` for TOTP accounts |
| `completeTwoFactorLogin` | `POST /auth/2fa/verify` | `{ challenge_token, code }` → `{ access_token, refresh_token, token_type, expires_in, user }` |
| 2FA status / setup / enable / disable | `GET /auth/2fa/status`, `POST /auth/2fa/setup`, `POST /auth/2fa/enable`, `POST /auth/2fa/disable` | TOTP lifecycle |
| `register` | `POST /auth/register` | `{ full_name, username, email, password, confirm_password, phone?, bio?, date_of_birth?, avatar_url? }` → `{ user_id, id, message, requires_verification, email }` |
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
account returns `403 { code: "EMAIL_NOT_VERIFIED" }` and re-sends the code.
The mobile app persists the session token locally (`lib/session-storage.ts`
SecureStore + SQLite + AsyncStorage), so sessions must remain valid until
expiry/logout/revocation.

### Current backend status

- ✅ `login` (incl. TOTP challenge gate), `refresh` (rotating), `logout`,
  `logout-all`, `change-password`, `verify-email`, `resend-verification`,
  `forgot-password`, `reset-password`, `delete-account` (and `DELETE /users/me`).
- ✅ `register` returns `user_id` **and** `id` (plus `requires_verification`,
  `email`).
- ✅ Username availability at `/users/check-username` (mobile call target).
- ✅ 2FA (TOTP) fully wired: `/auth/2fa/{status,setup,enable,disable,verify}`.
- ✅ Rate limiting on login/register/verify/2FA (in-memory sliding window).

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
| `getMe` | `GET /users/me` | returns the joined user + counts at the top level ✅ |
| `updateMe` | `PATCH /users/me` | returns `{ user }` ✅ |
| `getUserProfile` | `GET /users/:username` | returns `{ user }` ✅ |
| `searchUsers` | `GET /users/search?q=` | returns `{ users }` ✅ (requires auth) |
| block | `POST /users/:username/block` | ✅ |
| unblock | `DELETE /users/:username/block` | ✅ |
| report | `POST /users/:username/report {reason}` | ✅ |

**Nothing the user enters may be silently dropped.** `PATCH /users/me` accepts
`bio`, `avatar_url`, `banner_url`, `website`, `location`, `phone`, `username`,
`full_name`, `display_name`. `register` persists `date_of_birth`/`dob` and
`avatar_url` onto the `profiles` row ✅.

---

## 4. Settings (privacy / notifications / app)

Mobile `services/settings.ts` calls these routes:

| Mobile call | Expected route | Backend today |
|---|---|---|
| `getPrivacySettings` / `updatePrivacySettings` | `GET/PATCH /users/me/privacy` | ✅ `/users/me/privacy` (alias of `/settings/privacy`) |
| `getNotificationSettings` / `updateNotificationSettings` | `GET/PATCH /users/me/notifications` | ✅ `/users/me/notifications` |
| `getSettings` / `updateSettings` | `GET/PATCH /users/me/settings` | ✅ `/users/me/settings` |
| `deleteAccount` | `DELETE /users/me {password}` | ✅ |
| `logoutAllDevices` | `POST /auth/logout-all` | ✅ |
| `updatePassword` | `POST /auth/change-password` | ✅ |

**All `/users/me/*` aliases now exist** (thin re-exports of the `/settings/*`
logic). The `/settings/*` routes are retained for backward compatibility.

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
- Locked content must omit `media` / `video_url`.
- **List surfaces** (`/creators/:id/{posts,videos,shorts}`) apply the same rule
  via `visibleContentCondition()` so a non-subscriber only ever receives free
  rows (no locked metadata leaks). Explore returns free-only by query.

### Posts endpoints (mobile contract)

| Mobile call | Route | Status |
|---|---|---|
| `getHomeFeed(page)` | `GET /posts/feed?page=` | ✅ `/posts/feed` exists (re-export of `/posts?feed=home`) |
| `getBookmarkedPosts()` | `GET /posts/bookmarks` | ✅ `/posts/bookmarks` exists |
| `getPostsByCreator` | `GET /posts?creatorId=` (camelCase) | ✅ accepts both `creatorId` and `creator_id` |
| video feed | `GET /posts?cursor=&limit=` (client filters `content_type != short`) | ✅ |
| shorts feed | `GET /posts?content_type=short&cursor=&limit=` | ✅ |
| `getPost` | `GET /posts/:id` | ✅ |
| `createPost` | `POST /posts` | ✅ (returns `{ id }`) |
| `editPost` | `PATCH /posts/:id` | ✅ |
| `deletePost` | `DELETE /posts/:id` | ✅ |
| like/unlike | `POST/DELETE /posts/:id/like` | ✅ |
| bookmark | `POST/DELETE /posts/:id/bookmark` | ✅ |
| report | `POST /posts/:id/report {reason}` | ✅ |
| view | `POST /posts/:id/view` | ✅ |
| comments-enabled | `PUT /posts/:id {enabled}` | ✅ |

`createPost` persists `caption`, `title`, `description`, `content_type`,
`visibility`, `tier`, `thumbnail_url`, `tags`, `preview_duration`,
`expires_at`, inline `media`, `media_ids`, and `categories`. A `comment_rooms`
row (id === post id) is created with every post.

---

## 6. Explore, Search, Categories

| Mobile call | Route | Status |
|---|---|---|
| `getExploreFeed(category?)` | `GET /explore?category=` → `{ items }` | ✅ returns `items` (+ `posts/videos/shorts/albums/users`) |
| `getCategories` | `GET /categories` → `{ categories }` | ✅ |
| search (screen) | `GET /search?q=&type=` | ✅ |
| recent / trending search | `GET /search/recent`, `GET /search/trending` | ✅ |

Rules: Explore shows **only free/public content** (enforced at query level);
subscriber-gated content must never appear.

---

## 7. Albums

Mobile `services/albums.ts` contract:

| Call | Route | Request → Response |
|---|---|---|
| `getAlbums({cursor,creatorId,limit})` | `GET /albums?cursor=&creator_id=&limit=&purchased=` | `{ albums, next_cursor, has_more }` ✅ |
| `getAlbum(id)` | `GET /albums/:id` | `{ album }` ✅ |
| `createAlbum` | `POST /albums` | `{ id }` ✅ |
| `updateAlbum` | `PATCH /albums/:id` | `{ album }` ✅ |
| `deleteAlbum` | `DELETE /albums/:id` | ✅ |
| `purchaseAlbum` | `POST /albums/:id/purchase` | `{ purchased }` (alias of `/unlock`) ✅ |
| `getPurchasedAlbums` | `GET /albums?purchased=true` | `{ albums }` ✅ |

**Album object the mobile renders** now includes `id, title, description,
cover_url, preview_urls[], item_count, is_premium, price_credits,
unlock_price, is_unlocked_by_me/isUnlockedByMe, creator{...}, created_at,
updated_at` ✅. **Purchase is wallet-authoritative**: `POST /albums/:id/unlock`
deducts `wallets.balance`, credits the creator, records `transactions` rows,
and inserts `album_unlocks` atomically inside a transaction, with a
conditional balance debit. `album_unlocks.credits_spent` = price.

---

## 8. Subscriptions

Mobile `services/subscriptions.ts` + `app/creator/[id].tsx`:

| Call | Route | Status |
|---|---|---|
| `subscribe(creatorId, plan)` | `POST /creators/:creatorId/subscribe {plan}` | ✅ (`plan` → `tier`) |
| `getCreatorMessagingSettings(creatorId)` | `GET /creators/:creatorId/messaging-settings` | ✅ returns `{ who_can_message, subscribed, can_message }` |

**Server-authoritative.** Price is computed from
`creator_settings.subscription_price` / `subscription_plus_price`, the wallet
is charged atomically, a `subscriptions` row (`status: active`) is inserted,
a `transactions` row recorded, and the creator notified. Idempotent:
re-subscribing an active subscription returns the existing one. Both
`POST /subscriptions` and `POST /creators/:id/subscribe` exist and share the
same atomic debit+insert pattern.

---

## 9. Wallet, Payments, Withdrawals

Consumer (mobile `services/wallet.ts`):

| Call | Route | Status |
|---|---|---|
| `getWallet` | `GET /wallet` → `{ balance, currency, transactions }` | ✅ includes `transactions` |
| `initiateWalletDeposit` | `POST /payments/initiate-paystack {amount}` | ✅ |
| `verifyWalletDeposit` | `POST /payments/verify-paystack {transactionId}` | ✅ (idempotent — see §23) |

Creator payout (`/creator/wallet/*`):

| Mobile call | Expected route | Backend today |
|---|---|---|
| `getCreatorBalance` | `GET /creator/wallet/balance` | ✅ |
| `getBankDetails` | `GET /creator/wallet/bank-details` | ✅ |
| `saveBankDetails` | `POST /creator/wallet/bank-details` | ✅ |
| `requestWithdrawal` | `POST /creator/wallet/withdraw` | ✅ (atomic conditional debit) |
| `getWithdrawalHistory` | `GET /creator/wallet/withdrawals` | ✅ |

Financial safety: wallet balance is server-calculated; debit is atomic
(`gte(balance, price)` + `returning()`); withdrawals are idempotent against
concurrent requests; Paystack is verified server-side and never credited on a
client claim.

**⚠️ Remaining:** no Paystack `charge.success` webhook exists — wallet credit
currently depends on the mobile client calling `verify-paystack` after the
hosted checkout. Add a signature-verified webhook keyed on `reference` for
production-grade reconciliation (see §19).

---

## 10. Creators

### Public profile (`services/creators.ts`)

| Call | Route | Status |
|---|---|---|
| `getCreatorProfile(username)` | `GET /creators/:username` | ✅ |
| `getCreators` | `GET /creators` → `{ creators }` | ✅ |
| `getCreatorById` | `GET /creators/:usernameOrId` | ✅ |
| content posts/videos/shorts | `GET /creators/:id/posts|/videos|/shorts` | ✅ (tier/visibility gated — §5) |
| content albums | `GET /albums?creator_id=` | ✅ |
| reviews | `GET /creators/:id/reviews` | ✅ |

### Own dashboard (`services/creator.ts`)

| Call | Route | Status |
|---|---|---|
| `getCreatorDashboard` | `GET /creator/dashboard` | ✅ (alias of `/creator/statistics`) |
| `getCreatorSettings` / `updateCreatorSettings` | `GET/PATCH /creator/settings` | ✅ |
| `getCreatorSubscribers(page)` | `GET /creator/subscribers?page=` | ✅ |
| become creator | `POST /creator/become` | ✅ |

**No fake analytics.** `/creator/dashboard` computes from real
`creator_statistics` + live `subscriptions`/`posts` counts.

---

## 11. Notifications & Push

| Call | Route | Status |
|---|---|---|
| `getNotifications(page)` | `GET /notifications?page=` → `{ notifications, unread_count }` | ✅ |
| `markNotificationRead` | `POST /notifications/:id/read` | ✅ |
| `markAllNotificationsRead` | `POST /notifications/read-all` | ✅ |
| `deleteNotification` | `DELETE /notifications/:id` | ✅ |
| `registerPushTokenToBackend` | `POST /notifications/push-token {token, platform}` | ✅ |

Every notification carries routing data (`data.content_type`, `entity_id`,
`post_id`/`video_id`/`short_id`/`album_id`/`comment_id`, `chat_room_id`,
`actor_*`). Push via `lib/services/push.ts` (Expo). Mobile cold-start tap
handling is deduplicated (`LAST_HANDLED_NOTIF_KEY`).

---

## 12. Messaging — **Chat Rooms** (implemented)

The mobile app uses a **USER → ROOM → CONTENT** model with no fallback to the
conversation architecture. This is **implemented** — `app/api/chat-rooms/*`
and `lib/services/chat-rooms.ts`.

### Identifiers (never conflate)

- `chatRoomId` — permanent room, one per user pair (A+B == B+A), server-owned.
- `contextId` — one participant's context inside a room (per room+user).
- `contextAuth` — server-controlled membership map
  `{ message_ids?, removed_message_ids?, marker? }` for delete-for-me /
  delete-for-everyone / clear semantics.
- `messageId` — one message, server-owned.

### Routes (mobile `services/room-service.ts`)

| Method + path | Status |
|---|---|
| `POST /chat-rooms` `{ participant_id }` | ✅ |
| `GET /chat-rooms?tab=all\|archived` | ✅ |
| `GET /chat-rooms/:chatRoomId` | ✅ |
| `GET /chat-rooms/:chatRoomId/context?since=` | ✅ |
| `GET /chat-rooms/:chatRoomId/messages?before=&after=` | ✅ |
| `POST /chat-rooms/:chatRoomId/messages` | ✅ (preserves `file_type`, `is_voice_note`, media metadata) |
| `POST /chat-rooms/:chatRoomId/read` | ✅ |
| `POST /chat-rooms/:chatRoomId/clear` | ✅ |
| `GET /chat-rooms/:chatRoomId/changes?since=` | ✅ |
| `DELETE /chat-rooms/:chatRoomId/messages/:messageId?scope=me\|everyone` | ✅ |
| `PATCH /chat-rooms/:chatRoomId/messages/:messageId` | ✅ |
| `POST /chat-rooms/:chatRoomId/messages/:messageId/reactions` | ✅ |
| `PUT /chat-rooms/:chatRoomId/mute` | ✅ |
| `PUT /chat-rooms/:chatRoomId/archive` | ✅ |
| `DELETE /chat-rooms/:chatRoomId` | ✅ |

**Chat access rules (server-enforced):** `creator_settings.who_can_message`
(`everyone | subscribers | none`) is enforced on room creation/message send —
not the UI alone.

**Legacy:** the `/conversations` and standalone `/messages` routes and the
`conversations`/`conversation_members` tables remain as the legacy
architecture; chat rooms are the active path. Remove after migration (§18).

---

## 13. Comments — **Comment Rooms** (implemented)

The mobile app uses a **Comment Room** model
(`services/comment-room-service.ts`). Implemented — `app/api/comment-rooms/*`.

- Every post has a `comment_room_id` equal to its post id (`comment_rooms.id ===
  post.id`), returned in post data.
- Comments belong to `commentRoomId`, never to a user conversation.

### Routes

| Method + path | Status |
|---|---|
| `GET /comment-rooms/:commentRoomId` | ✅ |
| `GET /comment-rooms/:commentRoomId/comments?after=` | ✅ |
| `POST /comment-rooms/:commentRoomId/comments` | ✅ |
| `GET /comment-rooms/:commentRoomId/comments/changes?since=` | ✅ |
| `GET /comment-rooms/:commentRoomId/comments/:commentId/replies` | ✅ |
| `PATCH /comment-rooms/:commentRoomId/comments/:commentId` | ✅ |
| `DELETE /comment-rooms/:commentRoomId/comments/:commentId` | ✅ |
| `POST/DELETE /comment-rooms/:commentRoomId/comments/:commentId/like` | ✅ |
| `PUT /posts/:postId/comments-enabled` | ✅ (post owner only) |

The Comment Room is **not deleted** when comments are disabled — it stays
associated with the post and can be re-enabled. `comments_enabled` is enforced
on submission.

---

## 14. Media & Uploads

| Mobile call | Route | Status |
|---|---|---|
| `uploadMedia(uri, mime, name)` | `POST /upload` (multipart `file`) | ✅ `/upload` alias over `/media/upload` |
| create-post cleanup | `DELETE /media/:id` | ✅ |

Uploads are associated with the originating user (and optionally `post_id`).
R2 direct upload/download credential routes (`/credentials/upload-url`,
`/credentials/download-url`) are the scoped-credential broker for
client-direct transfers.

---

## 15. Sharing / Deep Links

| Mobile call | Route | Status |
|---|---|---|
| `createShareLink(type, id)` | `POST /share/create {type, target_id}` | ✅ (alias over `/shares`) |
| `resolveShareLink(token)` | `GET /share/resolve/:token` | ✅ (alias over `/shares/:token`) |

Share token resolves via the `/s/[token]` web page (backend `app/s/[token]`).

---

## 16. Data Integrity Rules (must not regress)

1. No field received but not persisted; no field persisted but not returned.
2. Return snake_case **and** camelCase aliases the mobile normalizers read.
3. IDs: user ID == creator ID (same `users.id`), but creator-scoped queries must
   filter by `is_creator`/ownership appropriately.
4. Post ID ≠ comment room ID (equal by design) ≠ comment ID ≠ user ID.
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
- Album access: server verifies `album_unlocks` (never a client `purchased`).
- Messaging: server enforces `who_can_message` + block state.

---

## 18. Legacy Systems To Remove / Replace

1. **Conversations** (`/conversations`, `/messages` routes, `conversations`,
   `conversation_members` tables) → superseded by **Chat Rooms** (implemented).
   Remove the legacy routes/tables once the mobile no longer references them.
2. **Post-scoped comments** (`/posts/:id/comments`, `/comments/:commentId/replies`)
   → superseded by **Comment Rooms** (implemented). Keep as internal impl or
   aliases during migration.
3. **Credential broker** (`/credentials/*`, `credential_grants` table): retain
   only if the mobile actually uses the presigned R2 upload/download flow.
4. `archives` table — appears unused by the current mobile; verify and drop or
   document.
5. `creator_reviews` / `/creators/:id/reviews` — mobile `useCreatorReviews` is
   currently a **stub**; either wire it to real reviews or remove the stub.

---

## 19. Remaining Backend Items (as of 2026-08-14)

Previously-missing items are all implemented. Remaining work is polish, not
gaps:

- **Paystack webhook** (`charge.success`) — no server-side webhook exists;
  credit relies on the client calling `verify-paystack`. Add a
  signature-verified webhook keyed on `reference` for robust reconciliation
  when the app is killed mid-checkout.
- **Transaction idempotency index** — add a unique index on
  `transactions.reference` to harden against duplicate deposits/withdrawals at
  the DB layer (the verify route already guards at the application layer).
- **`createPost` response** — returns `{ id }`; confirm the mobile create-post
  screen reads `resp.id` (not `resp.post`).
- **Notification preference gating** — verify `push.ts` consults
  `user_settings.notif_*` before delivery.
- **Legacy cleanup** — remove the `/conversations` + `/messages` legacy model
  and the `archives` table after confirming no mobile references (§18).

---

## 20. Migrations (already applied)

- ✅ `chat_rooms`, `chat_room_members`, `chat_room_messages` tables.
- ✅ `comment_rooms` table (id === post id).
- ✅ `user_settings` privacy/notification columns.
- ⚠️ `transactions.reference` unique index — **not yet** (see §19).
- ✅ TOTP columns on `users` (`totp_secret`, `totp_enabled`).

---

## 21. Final Mobile ↔ Backend Contract Check (by feature)

For each feature the chain must hold end-to-end:

```
mobile service → route → auth → validation → DB → business logic → response
→ mobile normalize → local persistence → UI
```

| Feature | Status |
|---|---|
| Register → verify email → login | ✅ (`user_id` returned; 2FA challenge gate) |
| Session persist + refresh | ✅ |
| Profile get/update | ✅ |
| Settings (privacy/notifications/app) | ✅ |
| Home feed / bookmarks | ✅ |
| Post create/edit/delete/like/bookmark/report/view | ✅ |
| Videos / shorts feeds | ✅ |
| Albums (list/detail/create/purchase) | ✅ (atomic purchase) |
| Explore / search / categories | ✅ |
| Subscribe / messaging rules | ✅ |
| Wallet deposit/verify | ✅ (idempotent verify — §23) |
| Creator dashboard / subscribers / settings | ✅ |
| Creator wallet / bank / withdrawals | ✅ |
| Messaging (chat rooms) | ✅ |
| Comments (comment rooms) | ✅ |
| Notifications / push | ✅ |
| Sharing / deep links | ✅ |
| Media upload | ✅ |

---

## 22. Current State (2026-08-14)

The backend now matches the mobile contract end-to-end. The remaining items
are the production-hardening steps in §19 (Paystack webhook, reference
idempotency index, legacy cleanup). No subsystem is missing.

---

## 23. 2026 End-to-End Audit — Fixes Applied

A full-stack audit traced every critical chain (auth/session, wallet/payments,
subscriptions, content visibility, messaging/SQLite, notifications). Fixes
made:

1. **Wallet double-credit race** — `POST /payments/verify-paystack` transitioned
   the transaction to `success` with an *unconditional* update before crediting,
   so two concurrent verify calls could both credit. Now the transition is
   conditional (`WHERE status != 'success'` + `returning()`) and only the winning
   request credits; the wallet increment is atomic (`balance + amount`).
2. **Avatar data loss** — the pending registration avatar was removed from
   AsyncStorage *before* the post-login upload, so a failed/offline upload
   discarded it permanently. Now it is peeked, uploaded, and cleared only after
   the server confirms the PATCH (retried next login otherwise).
3. **Owner-locked content** — `buildVideoRow`/`buildShortRow` hardcoded
   `isOwner: false`, so a creator saw their own `subscriber`/`subscriber_plus`
   videos/shorts as locked. `isOwner` is now threaded through the detail and
   creator-list routes.
4. **Cross-account chat-cache leak** — the shared chat SQLite cache was only
   wiped on logout, not on session-expiry or a fresh login, so a second account
   could inherit the first account's cached rooms/messages. It is now wiped on
   every session-dropping path.
5. **Non-subscriber content visibility** — `creators/:id/videos` and
   `/shorts` listed locked content (title/thumbnail) to non-subscribers, and
   `/posts` ignored the tier gate. Added `visibleContentCondition()` (mirrors
   `canViewContent`) so non-subscribers only ever receive free content.
