# MeetSweet Mobile — Backend Update Brief

**Date:** August 2026  
**For:** Mobile app developer  
**Summary:** The backend has moved to a new domain and gained push notifications + share link support. This document lists every change the mobile app needs to make.

---

## 1. New API Base URL

| Before | After |
|--------|-------|
| `https://api.meetsweet.space/api` | `https://meetsweet.space/api` |

**What to change in the mobile app:**

In `services/api.ts`, update `getApiBase()`:

```ts
// Before
return 'https://api.meetsweet.space/api';

// After
return 'https://meetsweet.space/api';
```

Or set the environment variable:
```
EXPO_PUBLIC_API_URL=https://meetsweet.space
```

---

## 2. Share Links Now Point to `meetsweet.space`

Share links are already generated correctly by the backend. No mobile change needed — `POST /api/shares` already returns:

```json
{
  "ok": true,
  "data": {
    "token": "abc12xyz",
    "url": "https://meetsweet.space/s/abc12xyz",
    "expires_at": "..."
  }
}
```

The `/s/:token` page is live on `meetsweet.space`. It shows a branded preview with deep links for users who have the app, and a download prompt for those who don't.

---

## 3. Push Notification Token Registration (NEW)

The backend now stores device push tokens. Register the token after login and whenever the Expo push token refreshes.

**Endpoint:** `POST /api/notifications/push-token`  
**Auth:** Bearer token required

**Request body:**
```json
{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "ios" | "android" | "web",
  "device_name": "iPhone 15 Pro"   // optional
}
```

**Response:**
```json
{ "ok": true, "data": {} }
```

**Suggested integration in the mobile app:**

```ts
import * as Notifications from 'expo-notifications';
import { apiFetch } from '@/services/api';

export async function registerPushToken() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  await apiFetch('/notifications/push-token', {
    method: 'POST',
    body: JSON.stringify({
      token: tokenData.data,
      platform: Platform.OS,
    }),
  });
}
```

Call `registerPushToken()` after a successful login and on app startup when the user is already logged in.

---

## 4. Push Notifications Are Now Sent on These Events

The backend fires Expo push notifications automatically on:

| Event | Title | Body |
|-------|-------|------|
| Someone likes your post | `New Like ❤️` | `@username liked your post` |
| Someone comments on your post | `New Comment 💬` | `@username: comment preview…` |
| Someone subscribes to you | `New Subscriber 🎉` | `@username just subscribed to you` |
| You receive a DM | `New Message 💬` | `@username: message preview…` |
| A creator you subscribe to posts | `New Post 🆕` | `Creator posted: title` |

The `data` payload in each notification contains `type`, `post_id`/`conversation_id`/`actor_id`/`actor_username`/`content_type` for in-app navigation on tap.

**Make sure the app handles notification taps** by reading `notification.request.content.data.type` and navigating accordingly.

---

## 5. Deep Linking for Share Links (`meetsweet://s/:token`)

When a user taps a `meetsweet.space/s/:token` link on their phone:

- **If the app is installed:** iOS Universal Links / Android App Links open the app directly at `app/s/[token].tsx`, which already resolves the token and navigates to the correct screen. ✅ No mobile change needed — the screen is already implemented.
- **If the app is not installed:** The browser shows the MeetSweet download page.

**iOS — Universal Links setup (one-time):**

The file `/.well-known/apple-app-site-association` is now served at `meetsweet.space/.well-known/apple-app-site-association`. To activate it:

1. In `app.json`, ensure the bundle ID is `com.meetsweet.app`
2. Add your Apple Team ID to the `apple-app-site-association` file on the server (replace `<APPLE_TEAM_ID>`)
3. In `app.json` / `app.config.ts`, add:
   ```json
   {
     "ios": {
       "associatedDomains": ["applinks:meetsweet.space"]
     }
   }
   ```
4. Rebuild with EAS: `eas build --platform ios`

**Android — App Links setup (one-time):**

The file `/.well-known/assetlinks.json` is served at `meetsweet.space/.well-known/assetlinks.json`. To activate it:

1. After your first EAS production build, run `eas credentials` to get the SHA-256 fingerprint
2. Replace `<SHA256_FINGERPRINT>` in the server's `server/public/.well-known/assetlinks.json`
3. In `app.json`, ensure `scheme` is `meetsweet`
4. Rebuild with EAS: `eas build --platform android`

---

## 6. Vercel Domain Update (for the server-side)

On the Vercel project that hosts this backend:

1. Go to **Project Settings → Domains**
2. Remove `api.meetsweet.space` (or keep it as a redirect if you want backwards compat)
3. Add `meetsweet.space` as the primary domain
4. In the DNS registrar (Vercel Domains), point `meetsweet.space` → the Vercel project

**After the domain switch**, `APP_URL` environment variable in Vercel should be updated to:
```
APP_URL=https://meetsweet.space
```

---

## 7. New / Changed Endpoints Summary

| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/notifications/push-token` | **NEW** | Register Expo push token |
| `GET /api/shares/:token` | Existing | Now also serves `meetsweet.space/s/:token` web page |
| `POST /api/shares` | Existing | Returns `meetsweet.space/s/{token}` URL |
| `/.well-known/apple-app-site-association` | **NEW** | iOS Universal Links |
| `/.well-known/assetlinks.json` | **NEW** | Android App Links |

All other endpoints are unchanged.
