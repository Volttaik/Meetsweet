# MeetSweet API Endpoints

All responses use:

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": "message", "code": "ERROR_CODE" }
```

Protected routes require `Authorization: Bearer <access_token>`.

---

## Health & Diagnostics

- `GET /api/healthz` — liveness only
- `GET /api/diagnostic` — safe status values; never returns secrets

---

## Authentication

- `POST /api/auth/register` — create account (returns tokens + user)
- `POST /api/auth/login` — email + password login (returns tokens + user)
- `POST /api/auth/refresh` — rotate refresh token
- `POST /api/auth/logout` — revoke refresh token (auth required)
- `POST /api/auth/verify-email` — verify email with 6-digit code
- `POST /api/auth/forgot-password` — send password reset code to email
- `POST /api/auth/reset-password` — reset password with code

---

## Users

- `GET  /api/users/me` — get own profile (auth required)
- `PATCH /api/users/me` — update own profile: `full_name`, `display_name`, `bio`, `avatar_url`, `banner_url`, `website`, `location` (auth required)
- `GET  /api/users/search?q=` — search users by name/username (auth required, min 2 chars)
- `GET  /api/users/:username` — public profile + follower/following counts
- `POST   /api/users/:username/follow` — follow a user (auth required)
- `DELETE /api/users/:username/follow` — unfollow a user (auth required)
- `POST   /api/users/:username/block` — block a user (auth required)
- `DELETE /api/users/:username/block` — unblock a user (auth required)

---

## Posts

- `GET  /api/posts` — paginated public feed
  - `?bookmarked=true` — only the authenticated user's saved posts (auth required)
  - `?creator_id=<id>` — filter by creator
  - `?limit=20&cursor=<iso_ts>` — pagination
- `POST /api/posts` — create a post with optional `media[]` (auth required)
- `GET    /api/posts/:id` — single post with media, liked_by_me, bookmarked_by_me
- `PATCH  /api/posts/:id` — update caption, visibility, is_pinned (owner only)
- `DELETE /api/posts/:id` — soft-delete (owner or admin)
- `POST   /api/posts/:id/like` — like a post (auth required)
- `DELETE /api/posts/:id/like` — unlike a post (auth required)
- `POST   /api/posts/:id/bookmark` — save/bookmark a post (auth required)
- `DELETE /api/posts/:id/bookmark` — unsave a post (auth required)
- `POST   /api/posts/:id/hide` — hide a post from feed (auth required)
- `DELETE /api/posts/:id/hide` — unhide a post (auth required)
- `POST   /api/posts/:id/report` — report a post (auth required)
- `POST   /api/posts/:id/view` — record a view (auth optional)

---

## Comments

- `GET  /api/posts/:id/comments` — list comments on a post
- `POST /api/posts/:id/comments` — add a comment (auth required)
- `PATCH  /api/posts/:id/comments/:commentId` — edit comment body (owner only)
- `DELETE /api/posts/:id/comments/:commentId` — soft-delete comment (owner or admin)
- `POST   /api/posts/:id/comments/:commentId/like` — like a comment (auth required)
- `DELETE /api/posts/:id/comments/:commentId/like` — unlike a comment (auth required)
- `GET  /api/posts/:id/comments/:commentId/replies` — list replies on a comment
- `POST /api/posts/:id/comments/:commentId/replies` — add a reply (auth required)

---

## Media

- `POST /api/media` — register media metadata after direct-to-R2 upload (auth required)
  - Body: `url`, `blob_path`, `type` (image|video), `post_id?`, `mime_type?`, `size_bytes?`, `width?`, `height?`, `duration_seconds?`

---

## Conversations & Messaging

- `GET  /api/conversations` — list user's conversations (auth required)
  - `?tab=all|archived` — filter by archive status
- `POST /api/conversations` — create or return existing direct conversation (auth required)
  - Body: `{ "user_id": "<target_user_id>" }`
- `GET  /api/conversations/:id/messages` — paginated messages, newest first (auth required)
  - `?before=<ISO>&limit=20`
- `POST /api/conversations/:id/messages` — send a message (auth required)
  - Body: `body?`, `media_url?`, `media_type?`, `reply_to_id?`
- `PUT  /api/conversations/:id/archive` — archive or unarchive (auth required)
  - Body: `{ "archived": true|false }`
- `DELETE /api/messages/:id` — recall/delete own message (auth required)

---

## Notifications

- `GET  /api/notifications` — list notifications for authenticated user
- `POST /api/notifications/read-all` — mark all as read (auth required)
- `PUT  /api/notifications/:id/read` — mark single notification as read (auth required)

---

## Categories

- `GET /api/categories` — list all content categories

---

## Wallet & Transactions

- `GET /api/wallet` — get authenticated user's wallet balance (auth required)
- `GET /api/transactions` — list authenticated user's transactions (auth required)
  - `?limit=20`

---

## Subscriptions

- `GET  /api/subscriptions` — list subscriptions (auth required)
  - `?type=subscribed` — creators I'm subscribed to (default)
  - `?type=subscribers` — users subscribed to me (creator)
- `POST /api/subscriptions` — subscribe to a creator (auth required)
  - Body: `{ "creator_id": "<id>" }`

---

## Creator

- `GET   /api/creator/settings` — get creator settings, auto-creates if missing (auth required)
- `PATCH /api/creator/settings` — update `subscription_price`, `allow_dms`, `allow_comments`, `welcome_message` (auth required)
- `GET   /api/creator/statistics` — get creator statistics by period (auth required)
  - `?period=<period_string>`

---

## App Settings

- `GET   /api/settings` — get authenticated user's app settings (auth required)
- `PATCH /api/settings` — update `push_notifications`, `email_notifications`, `dark_mode`, `data_saver`, `autoplay_media`, `biometric_login` (auth required)

---

## Credential Broker

The broker routes never expose permanent cloud credentials to the mobile app.

- `GET  /api/credentials/config` — public-safe client limits and MIME types
- `POST /api/credentials/token` — issue a short-lived scoped credential (auth required)
  - Body: `{ "scopes": ["r2:upload"|"r2:download"], "ttl_seconds": 60–900 }`
- `POST /api/credentials/refresh` — revoke and replace a scoped credential (auth required)
- `POST /api/credentials/revoke` — revoke a scoped credential (auth required)
- `GET  /api/credentials/upload-url` — issue a 15-min direct-to-R2 PUT URL (auth required)
- `GET  /api/credentials/download-url` — issue a signed R2 GET URL for an owned key (auth required)
- `POST /api/credentials/database` — run a named read-only query against Turso (auth required)
  - Allowed queries: `get_profile`, `get_settings`, `get_account`
- `POST /api/credentials/email` — send a transactional email via Resend (auth required)
- `POST /api/credentials/payment` — initialize a Paystack payment (auth required)
