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

## 4. Push notification events

The server sends Expo push notifications and stores matching in-app notifications for:

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

The server removes stale Expo tokens when Expo returns `DeviceNotRegistered`. The current mobile notification tap handler already routes messages and content IDs; update it to treat `new_post` as a content notification and use `content_type` to choose the correct screen.

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
| `GET /api/notifications` | Ready | In-app list and unread count |
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
- Push-token registration, in-app notification listing/read routes, Expo delivery, stale
  token cleanup, and like/comment/subscription/message/new-post event wiring are present
  on the server.
- The server passes TypeScript checking and the Next.js production build.

### Mobile repository availability

The imported archive available alongside this server contains only a server project; it
does not contain the Expo/mobile files named above. Before the Android release, apply and
verify the mobile changes in the actual mobile repository:

1. Confirm the API fallback is `https://meetsweet.space/api`.
2. Confirm the share route resolves `post`, `video`, `short`, `album`, and `creator` to
   the correct native screens.
3. Register the Expo token after login and whenever the token refreshes.
4. Route `new_post` notification taps using `content_type`.
5. Replace the Android SHA-256 and iOS Team ID placeholders in the association files
   before production release.