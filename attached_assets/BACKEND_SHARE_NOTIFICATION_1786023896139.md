# Backend Requirements — Share Links & Push Notifications

**App domain:** `meetsweet.space`
**API domain:** `api.meetsweet.space` (all routes under `/api/...`)
**Mobile app bundle ID:** `com.meetsweet.app`
**Push provider:** Expo Push Notifications (`https://exp.host/--/api/v2/push/send`)

---

## 1. Push Notification System

### 1a. Store device push tokens

**`POST /api/notifications/push-token`** — requires Bearer auth

Request body:
```json
{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "ios" | "android" | "web"
}
```

The `devices` table already exists in the schema:
```
devices (id, user_id, push_token, platform, device_name, last_seen_at, created_at)
```

Logic:
- If a row with this `push_token` already exists → update `last_seen_at = now()`
- Otherwise → insert new row with `user_id` from the auth token
- Return `{ ok: true, data: {} }`

---

### 1b. Send push notifications on events

Whenever any of these events happen, look up all push tokens for the **target user** from the `devices` table and POST to the Expo Push API:

```
POST https://exp.host/--/api/v2/push/send
Content-Type: application/json
```

#### Event → notification mapping

| Event | Title | Body | `data` fields |
|---|---|---|---|
| Someone **likes** your post | `"New Like ❤️"` | `"@{actor} liked your post"` | `type: "like"`, `post_id`, `actor_id` |
| Someone **comments** on your post | `"New Comment 💬"` | `"@{actor}: {comment preview}"` | `type: "comment"`, `post_id`, `actor_id` |
| Someone **subscribes** to you | `"New Subscriber 🎉"` | `"@{actor} just subscribed to you"` | `type: "subscribe"`, `actor_id` |
| You receive a **DM** | `"New Message 💬"` | `"@{actor}: {message preview}"` | `type: "message"`, `conversation_id`, `actor_id` |
| A creator you subscribe to makes a **new post** | `"New Post 🆕"` | `"{creator} just posted: {title}"` | `type: "new_post"`, `post_id`, `content_type` (`post`/`video`/`short`/`album`) |

#### Expo push payload format

```json
{
  "to": "ExponentPushToken[xxx]",
  "title": "New Like ❤️",
  "body": "@username liked your post",
  "sound": "default",
  "badge": 1,
  "data": {
    "type": "like",
    "post_id": "abc123",
    "actor_id": "user456",
    "actor_username": "jane",
    "content_type": "post"
  }
}
```

**Important:** The `data` object is what the mobile app uses to navigate on tap. Always include:
- `type` — one of: `like`, `comment`, `subscribe`, `message`, `new_post`
- `post_id` — for like / comment / new_post events
- `conversation_id` — for message events
- `actor_id` + `actor_username` — for all events
- `content_type` — for new_post (`post`, `video`, `short`, `album`) so the app routes to the right screen

You can batch multiple tokens in one Expo API call (array of payloads). Handle `DeviceNotRegistered` errors by deleting the stale token from `devices`.

---

## 2. Share Link System

### 2a. Create a share link

**`POST /api/shares`** — requires Bearer auth

Request body:
```json
{
  "content_type": "post" | "video" | "short" | "album" | "creator",
  "content_id": "<uuid>"
}
```

Logic:
- Validate that the content exists
- Generate a short unique token (e.g. nanoid, 8–12 chars)
- Insert into `shares` table: `(id, token, content_type, content_id, creator_id, share_count, expires_at, created_at)`
- For `post`, `video`, `short` content types — increment the post's `share_count`
- `expires_at` = 30 days from now
- **Return the share URL as `meetsweet.space/s/{token}`** (not the API domain)

Response:
```json
{
  "ok": true,
  "data": {
    "token": "abc12xyz",
    "url": "https://meetsweet.space/s/abc12xyz",
    "expires_at": "2026-09-05T12:00:00Z"
  }
}
```

---

### 2b. Resolve a share token

**`GET /api/shares/:token`** — public (no auth required)

Logic:
- Look up the token in `shares`
- If not found or expired → 404
- Return the content type and ID

Response:
```json
{
  "ok": true,
  "data": {
    "content_type": "post",
    "content_id": "abc123"
  }
}
```

The mobile app uses this to navigate: post → `/post/:id`, video → `/videos/:id`, short → `/shorts?startId=:id`, album → `/album/:id`, creator → `/creator/:id`.

---

### 2c. Deep link association files

For share links at `meetsweet.space/s/*` to open directly in the installed app (instead of a browser), serve these two files as **static files** on the `meetsweet.space` domain (not the API domain).

**`/.well-known/apple-app-site-association`** — no file extension, served as `application/json`:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<APPLE_TEAM_ID>.com.meetsweet.app",
        "paths": ["/s/*"]
      }
    ]
  }
}
```

Replace `<APPLE_TEAM_ID>` with the 10-character Apple Team ID from the Apple Developer portal.

**`/.well-known/assetlinks.json`**:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.meetsweet.app",
    "sha256_cert_fingerprints": ["<SHA256_FINGERPRINT>"]
  }
}]
```

The SHA-256 fingerprint comes from the release keystore. After the first EAS production build run `eas credentials` to get it.

> **Note:** The `meetsweet.space/s/:token` path should either proxy to `api.meetsweet.space/api/shares/:token` server-side and redirect, or serve a web page that handles the redirect for users who don't have the app installed.

---

## Summary checklist

- [ ] `POST /api/notifications/push-token` — upsert device token
- [ ] Trigger Expo push on: like, comment, subscribe, DM, new post from subscribed creator
- [ ] Handle `DeviceNotRegistered` Expo errors (delete stale tokens)
- [ ] `POST /api/shares` — create share link, return `https://meetsweet.space/s/{token}`
- [ ] `GET /api/shares/:token` — resolve token → `{ content_type, content_id }`
- [ ] Serve `/.well-known/apple-app-site-association` on `meetsweet.space`
- [ ] Serve `/.well-known/assetlinks.json` on `meetsweet.space`
- [ ] Redirect/proxy `meetsweet.space/s/:token` for browser fallback (users without the app)
