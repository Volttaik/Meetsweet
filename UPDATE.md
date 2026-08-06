# MeetSweet Mobile — Backend & Domain Update

**Date:** August 2026  
**For:** MeetSweet Android/mobile developer
**Release focus:** Android first

## Overview

The MeetSweet server, landing page, public share links, and API now use one canonical host:

```text
https://meetsweet.space
```

The server remains backend-only. It does not expose a React Native website or a public database-connected frontend. The public web surface is limited to:

- the app download landing page at `/`
- share previews at `/s/:token`
- Android/iOS deep-link association files under `/.well-known/`
- the API under `/api/...`

## 1. Required mobile API change

Update all mobile API clients from:

```text
https://api.meetsweet.space/api
```

to:

```text
https://meetsweet.space/api
```

Update both:

- `services/api.ts`
- `services/credentials/index.ts`

The fallback in `services/api.ts` should be:

```ts
export function getApiBase(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (url) return `${url.replace(/\/+$/, '')}/api`;
  return 'https://meetsweet.space/api';
}
```

The simplest build configuration is:

```text
EXPO_PUBLIC_API_URL=https://meetsweet.space
```

Do not include `/api` in that environment variable because the helper appends it.

### Required request headers

The backend expects the mobile client identifier on requests that do not
already include a Bearer token. Add this header to the shared API client:

```http
X-Client-App-Id: meetsweet-mobile
```

The recommended authenticated request headers are:

```http
Authorization: Bearer <access_token>
X-Client-App-Id: meetsweet-mobile
Content-Type: application/json
```

Send `X-Client-App-Id` on every API request, including login, registration,
token refresh, forgot-password, and public configuration requests. The server
currently permits requests with a valid Bearer token without the app-id header,
but sending both headers keeps all clients consistent and avoids failures when
an access token is absent or expired.

`OPTIONS` preflight requests are supported. The server allows
`Content-Type`, `Authorization`, and `X-Client-App-Id`.

### Response envelope and error handling

All successful API responses use:

```json
{
  "ok": true,
  "data": {},
  "message": "optional message"
}
```

All errors use:

```json
{
  "ok": false,
  "error": "Human-readable error",
  "code": "OPTIONAL_MACHINE_CODE"
}
```

The shared mobile request helper must:

1. Check the HTTP status and the JSON `ok` field.
2. Return or unwrap `response.data` for successful responses.
3. Preserve `error` and `code` for user-facing and auth-specific handling.
4. Treat `401` as an expired/invalid session and run the existing refresh or
   logout flow.
5. Treat `403` as an app-id or authorization failure, not as an empty result.
6. Handle `201` responses as successful; create endpoints use `201`.

Do not assume a successful endpoint returns its payload at the top level. For
example, the share response is `response.data.token`, not `response.token`.

The imported mobile repository currently still contains the old fallback in both helpers. This is the main required client migration.

## 2. Share links

`POST /api/shares` requires Bearer auth and accepts:

```json
{
  "content_type": "post",
  "content_id": "<id>"
}
```

Supported content types are `post`, `video`, `short`, `album`, and `creator`.

The server:

- validates that the content exists
- increments `share_count` for post/video/short content
- creates a unique token valid for 30 days
- returns the canonical URL `https://meetsweet.space/s/{token}`
- rejects expired tokens from `GET /api/shares/:token`

Example response:

```json
{
  "ok": true,
  "data": {
    "token": "abc12xyz",
    "url": "https://meetsweet.space/s/abc12xyz",
    "expires_at": "2026-09-05T12:00:00.000Z"
  }
}
```

`GET /api/shares/:token` is public and returns:

```json
{
  "ok": true,
  "data": {
    "content_type": "post",
    "content_id": "abc123",
    "token": "abc12xyz",
    "expires_at": "2026-09-05T12:00:00.000Z"
  }
}
```

The existing mobile route `app/s/[token].tsx` maps content as follows:

| `content_type` | Mobile destination |
|---|---|
| `post` | `/post/:id` |
| `video` | `/videos/:id` |
| `short` | `/shorts?startId=:id` |
| `album` | `/album/:id` |
| `creator` | `/creator/:id` |

Do not use `api.meetsweet.space` in share UI or fallback URLs.

When creating a share, read the URL from `data.url` (or the compatible
`data.share_url` alias) and share that HTTPS URL. Do not construct a share URL
from the API base URL on the client.

## 3. Push-token registration

`POST /api/notifications/push-token` requires a Bearer token.

Request:

```json
{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "android",
  "device_name": "optional device name"
}
```

The server updates an existing token’s user/platform/device metadata and `last_seen_at`, or creates a device row when the token is new. Register after login and when the Expo token refreshes.

The current app already has the Expo registration flow in `contexts/NotificationsContext.tsx`.

The request must include the authenticated access token and the shared
`X-Client-App-Id` header. The successful response is:

```json
{
  "ok": true,
  "data": {}
}
```

If the same Expo token is later used by another signed-in user, the backend
transfers that installation to the new user instead of creating a duplicate
device row. Do not assume the server creates a new row for every login.

## 4. Push notification events

The server sends Expo push notifications for:

| Event | Title | Body |
|---|---|---|
| Someone likes your post | `New Like` | `@username liked your post` |
| Someone comments on your post | `New Comment` | `@username: comment preview...` |
| Someone subscribes to you | `New Subscriber` | `@username just subscribed to you` |
| You receive a DM | `New Message` | `@username: message preview...` |
| A subscribed creator publishes content | `New Post` | `@creator just posted: title` |

Push data for mobile navigation:

| `type` | Data |
|---|---|
| `like` | `post_id`, `actor_id`, `actor_username`, `content_type` |
| `comment` | `post_id`, `actor_id`, `actor_username`, `content_type` |
| `subscribe` | `actor_id`, `actor_username` |
| `message` | `conversation_id`, `actor_id`, `actor_username` |
| `new_post` | `post_id`, `content_id`, `actor_id`, `actor_username`, `content_type` |

For `new_post`, `content_type` is `post`, `video`, `short`, or `album`.

The current mobile notification tap handler must:

1. Route `message` to the conversation identified by `conversation_id`.
2. Route `like` and `comment` to the content identified by `post_id`;
   `content_type` determines whether that is a post, video, or short.
3. Route `subscribe` to the actor/creator profile using `actor_id`.
4. Treat `new_post` as a content notification and use `content_type` to choose
   the correct screen. For an album, use `content_id` or `album_id`; for a
   post/video/short, use `content_id` or `post_id`.
5. Tolerate missing optional actor fields and avoid navigating when the
   required ID is absent.

The server removes stale Expo tokens when Expo returns
`DeviceNotRegistered`. This cleanup is server-side; the mobile app should still
handle notification permission denial, token refresh, and invalid local token
state without crashing.

### In-app notification API

In-app notifications are separate from push delivery. The mobile app must
implement these authenticated calls:

```text
GET    /api/notifications?page=1&limit=20
PUT    /api/notifications/:id/read
POST   /api/notifications/read-all
DELETE /api/notifications/:id
```

`GET /api/notifications` returns:

```json
{
  "ok": true,
  "data": {
    "notifications": [
      {
        "id": "notification-id",
        "type": "like",
        "title": "New Like",
        "body": "liked your post",
        "is_read": false,
        "created_at": "2026-08-06T12:00:00.000Z",
        "data": {
          "content_type": "post",
          "entity_type": "post",
          "entity_id": "content-id",
          "post_id": "content-id",
          "video_id": null,
          "short_id": null,
          "album_id": null,
          "comment_id": null,
          "actor_id": "actor-id",
          "actor_name": "Display Name",
          "actor_username": "username",
          "actor_avatar": null
        }
      }
    ],
    "unread_count": 1
  }
}
```

The read and delete endpoints return the normal success envelope. A single
notification can only be marked or deleted by its owner; `403` and `404` must
not be treated as successful local updates.

Important current-backend behavior:

- Like and comment notifications are stored as in-app notification rows.
- Subscribe notifications are stored as in-app notification rows.
- New-post notifications are stored as in-app notification rows for each
  subscribed recipient.
- Message sends currently send push notifications but do **not** create rows in
  the in-app `notifications` table. Do not promise message entries in the
  in-app notification center unless the backend is changed.
- In-app `data.content_type` is derived from `entity_type`. For like/comment
  rows, the current backend may report `post` even when the underlying post row
  represents a video or short. For push taps, trust push `data.content_type`;
  for in-app rows, use the available IDs and response fields.

## 5. Android App Links

The current app configuration already has the required Android identity:

```json
{
  "android": {
    "package": "com.meetsweet.app"
  },
  "scheme": "meetsweet"
}
```

Keep the Android intent filter configured with:

- scheme: `https`
- host: `meetsweet.space`
- path prefix: `/s`
- `autoVerify: true`

When the user taps `https://meetsweet.space/s/:token`:

- installed app: Android App Links opens `app/s/[token].tsx`
- no installed app: browser shows the share preview and download prompt

Before the production Android release:

1. Create the signed Android build with EAS.
2. Get the production release certificate SHA-256 fingerprint from EAS credentials.
3. Replace `<SHA256_FINGERPRINT>` in `server/public/.well-known/assetlinks.json`.
4. Confirm it is live at `https://meetsweet.space/.well-known/assetlinks.json`.
5. Rebuild/reinstall the production Android app.

Do not use a debug fingerprint for the production association file.

## 6. iOS association file

iOS is not the first launch target, but the server file is already present at:

```text
https://meetsweet.space/.well-known/apple-app-site-association
```

Before an iOS build, replace `<APPLE_TEAM_ID>` with the real Apple Team ID and keep:

```json
{
  "ios": {
    "bundleIdentifier": "com.meetsweet.app",
    "associatedDomains": ["applinks:meetsweet.space"]
  }
}
```

## 7. Android download landing page

The homepage at `https://meetsweet.space/` is a static-style server-rendered download page. It does not connect a browser to the database.

The intended APK path is:

```text
https://meetsweet.space/meetsweet.apk
```

The APK is intentionally not included yet. When it is ready, upload it as:

```text
server/public/meetsweet.apk
```

No code change is required if that path is used. If the APK is hosted elsewhere, update the download link in `server/app/page.tsx`.

## 8. Domain/deployment checklist

On the deployment that serves this Next.js app:

1. Add `meetsweet.space` as the primary domain.
2. Keep `api.meetsweet.space` only as an optional backwards-compatible alias/redirect.
3. Set:

```text
APP_URL=https://meetsweet.space
PUBLIC_APP_URL=https://meetsweet.space
```

`PUBLIC_APP_URL` is the canonical origin used to generate share URLs, so an old API host cannot leak into new links.

## 9. Endpoint summary

| Endpoint | Status | Notes |
|---|---|---|
| `POST /api/notifications/push-token` | Ready | Register/update Expo push token |
| `GET /api/notifications` | Ready | In-app list, pagination, and unread count |
| `PUT /api/notifications/:id/read` | Ready | Mark one notification read |
| `POST /api/notifications/read-all` | Ready | Mark all of the user’s notifications read |
| `DELETE /api/notifications/:id` | Ready | Delete one notification owned by the user |
| `POST /api/shares` | Ready | Returns `https://meetsweet.space/s/{token}` |
| `GET /api/shares/:token` | Ready | Public resolution; expired tokens return 404 |
| `GET /s/:token` | Ready | Browser share preview and app/download CTAs |
| `/.well-known/apple-app-site-association` | Placeholder | Requires Apple Team ID for iOS |
| `/.well-known/assetlinks.json` | Placeholder | Requires production Android SHA-256 fingerprint |

The old `api.meetsweet.space` host should not be used by new mobile builds.

## 10. Server verification and public preview implementation

The current server project has now been checked and updated:

- `POST /api/shares` creates canonical `https://meetsweet.space/s/{token}` links.
- `GET /api/shares/:token` rejects expired links.
- `/s/:token` is a public server-rendered fallback page. It shows the shared content type,
  post/album/creator title and description when available, the creator name, and the
  first available image or thumbnail for posts, videos, shorts, albums, and creators.
- The page provides both an app CTA (`meetsweet://s/{token}`) and an Android download CTA.
  Installed Android builds should open from the HTTPS link through Android App Links;
  browsers without the app remain on the preview page.
- The homepage and share preview use the black-and-white MeetSweet logo at
  `/meetsweet-logo.png`, and public links no longer show the browser's default blue tap
  highlight. Keyboard users still receive a visible focus ring.
- Push-token registration, in-app notification listing/read/delete routes, Expo
  delivery, stale token cleanup, and like/comment/subscription/message/new-post
  event wiring are present on the server. Message event wiring currently covers
  Expo push delivery, not persisted in-app notification rows.
- The server passes TypeScript checking and the Next.js production build.

### Mobile repository availability

The imported archive available alongside this server contains only a server project; it
does not contain the Expo/mobile files named above. Before the Android release, apply and
verify the mobile changes in the actual mobile repository:

1. Confirm the API fallback is `https://meetsweet.space/api`.
2. Confirm every API request sends `X-Client-App-Id: meetsweet-mobile` and that the
   shared helper unwraps the `{ ok, data }` response envelope.
3. Confirm `401`, `403`, `404`, and `201` responses are handled according to
   Section 1.
4. Confirm the share route resolves `post`, `video`, `short`, `album`, and `creator`
   to the correct native screens.
5. Confirm share creation uses `data.url` and never constructs a link from
   `api.meetsweet.space`.
6. Register the Expo token after login and whenever the token refreshes.
7. Confirm push notification taps route `like`, `comment`, `subscribe`, `message`,
   and `new_post` using the payload tables above.
8. Confirm the in-app notification center unwraps `data.notifications`, displays
   `data.unread_count`, and uses the read-all, single-read, and delete endpoints.
9. Confirm the client does not expect message pushes to appear in the in-app
   notification list unless the backend is updated.
10. Replace the Android SHA-256 and iOS Team ID placeholders in the association
    files before production release.