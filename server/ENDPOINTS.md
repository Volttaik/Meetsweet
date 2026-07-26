# MeetSweet API — Endpoint Reference

**Base URL:** `https://<your-domain>/api`  
**Auth header:** `Authorization: Bearer <access_token>`  
**Content-Type:** `application/json`

**Response envelope:**
```json
{ "ok": true,  "data": {...}, "message": "..." }
{ "ok": false, "error": "...", "code": "ERROR_CODE" }
```

---

## Auth
> The server owns identity. These endpoints create accounts, verify email, and issue/rotate JWT tokens. The access token (15 min) and refresh token (30 days) returned by login and refresh are what all other authenticated endpoints require.

---

### POST /api/auth/register
Register a new user. Sends a 6-digit email verification code via Resend.

**Auth required:** No

**Request body:**
```json
{
  "full_name": "string (2–100 chars)",
  "username": "string (3–30 chars, letters/numbers/underscore)",
  "email": "string (valid email)",
  "password": "string (min 8 chars)",
  "confirm_password": "string",
  "phone": "string? (optional)"
}
```

**Response `201`:**
```json
{ "user_id": "uuid" }
```

**Errors:** `409` email or username already taken | `422` validation

---

### POST /api/auth/login
Login with email and password.

**Auth required:** No

**Request body:**
```json
{
  "email": "string",
  "password": "string",
  "device_id": "string? (optional)"
}
```

**Response `200`:**
```json
{
  "access_token": "string (JWT, 15 min)",
  "refresh_token": "string (JWT, 30 days)",
  "user": {
    "id": "uuid",
    "full_name": "string",
    "username": "string",
    "email": "string",
    "role": "user | creator | admin",
    "is_creator": "boolean",
    "avatar_url": "string | null"
  }
}
```

**Errors:** `401` invalid credentials | `403` email not verified / account deactivated

---

### POST /api/auth/logout
Revokes the provided refresh token for this device.

**Auth required:** Yes

**Request body:**
```json
{ "refresh_token": "string?" }
```

**Response `200`:** `null`

---

### POST /api/auth/refresh
Rotate the access + refresh token pair. The old refresh token is revoked.

**Auth required:** No (but requires a valid refresh token in the body)

**Request body:**
```json
{ "refresh_token": "string" }
```

**Response `200`:**
```json
{
  "access_token": "string",
  "refresh_token": "string"
}
```

**Errors:** `401` invalid, expired, or revoked refresh token

---

### POST /api/auth/verify-email
Verify email with the 6-digit code sent during registration.

**Auth required:** No

**Request body:**
```json
{ "email": "string", "code": "string (6 digits)" }
```

**Response `200`:** `null`

**Errors:** `400` invalid or expired code

---

### POST /api/auth/resend-verification
Re-send the email verification code.

**Auth required:** No

**Request body:**
```json
{ "email": "string" }
```

**Response `200`:** `null` (always succeeds to prevent email enumeration)

---

### POST /api/auth/forgot-password
Send a 6-digit password reset code to the user's email.

**Auth required:** No

**Request body:**
```json
{ "email": "string" }
```

**Response `200`:** `null` (always succeeds to prevent email enumeration)

---

### POST /api/auth/reset-password
Reset password using the code from the forgot-password email.

**Auth required:** No

**Request body:**
```json
{
  "email": "string",
  "code": "string (6 digits)",
  "password": "string (min 8 chars)",
  "confirm_password": "string"
}
```

**Response `200`:** `null`

**Errors:** `400` invalid or expired code

---

### POST /api/auth/update-password
Change password for the currently authenticated user.

**Auth required:** Yes

**Request body:**
```json
{
  "current_password": "string",
  "new_password": "string (min 8 chars)",
  "confirm_password": "string"
}
```

**Response `200`:** `null`

**Errors:** `400` current password incorrect

---

### PATCH /api/auth/update-email
Change the account email (requires password confirmation).

**Auth required:** Yes

**Request body:**
```json
{ "email": "string", "password": "string" }
```

**Response `200`:** `null`

---

### GET /api/auth/username-availability
Check whether a username is taken.

**Auth required:** No

**Query params:** `?username=<string>`

**Response `200`:**
```json
{ "available": true }
```

---

### DELETE /api/auth/delete-account
Soft-delete the authenticated user's account (requires password confirmation).

**Auth required:** Yes

**Request body:**
```json
{ "password": "string" }
```

**Response `200`:** `null`

---

## Credentials
> These are the broker endpoints. The server uses its own secrets internally and hands the client only what it needs — a short-lived presigned URL, a Paystack reference, or safe public config. Raw API keys never leave the server.

---

### GET /api/credentials/upload-url
Get a presigned Cloudflare R2 PUT URL. The client uploads the file directly to R2 using this URL — no bytes pass through this server.

**Auth required:** Yes

**Query params:**

| Param        | Required | Description                                                     |
|--------------|----------|-----------------------------------------------------------------|
| `mime_type`  | ✅        | MIME type of the file (see allowed types below)                 |
| `folder`     | —         | Logical prefix, e.g. `avatars`, `posts`, `banners` (default: `uploads`) |
| `size_bytes` | —         | Declared file size in bytes — validated against the limit       |

**Allowed MIME types:**
- Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Video: `video/mp4`, `video/quicktime`, `video/webm`
- Audio: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/mp4`, `audio/webm`

**Response `200`:**
```json
{
  "upload_url": "https://...",
  "object_key": "avatars/<user_id>/<uuid>.jpg",
  "expires_in": 900,
  "max_bytes": 10485760
}
```

**How to use:**
```
1. Call GET /api/credentials/upload-url?mime_type=image/jpeg&folder=avatars
2. PUT the file binary to upload_url (set Content-Type header to your mime_type)
3. Store object_key in your app — it's the permanent identifier for this file
4. Call GET /api/credentials/download-url?key=<object_key> to get a readable URL
```

**Errors:** `422` unsupported mime type | `413` size_bytes exceeds limit

---

### GET /api/credentials/download-url
Get a presigned R2 GET URL valid for 7 days. Call this when you need a readable URL for a stored file.

**Auth required:** Yes

**Query params:** `?key=<object_key>`

**Response `200`:**
```json
{
  "url": "https://...",
  "expires_in": 604800
}
```

**Errors:** `400` key missing or is a raw URL (pass the object_key, not a URL)

---

### GET /api/credentials/config
Returns public-safe runtime configuration. Fetch this once on app startup and cache it.

**Auth required:** Yes (prevents unauthenticated scraping)

**Response `200`:**
```json
{
  "paystack_public_key": "pk_live_... | null",
  "r2_public_base_url": "https://cdn.example.com | null",
  "app_id": "meetsweet-mobile",
  "upload_limits": {
    "image": 10485760,
    "video": 524288000,
    "audio": 52428800
  },
  "allowed_mime_types": {
    "image": ["image/jpeg", "image/png", "image/webp", "image/gif"],
    "video": ["video/mp4", "video/quicktime", "video/webm"],
    "audio": ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/webm"]
  }
}
```

---

### POST /api/credentials/payment
Initialize a Paystack transaction server-side. The secret key stays on the server. The client receives a reference and authorization URL to open in a WebView.

**Auth required:** Yes

**Request body:**
```json
{
  "amount": 100000,
  "email": "user@example.com",
  "metadata": { "plan": "creator_monthly" },
  "callback_url": "https://..."
}
```

> `amount` is in kobo (NGN smallest unit). ₦1,000 = `100000`.

**Response `200`:**
```json
{
  "authorization_url": "https://checkout.paystack.com/...",
  "reference": "abc123xyz",
  "access_code": "..."
}
```

**How to use:**
```
1. Call POST /api/credentials/payment with amount + email
2. Open authorization_url in a WebView or browser
3. User completes payment on Paystack's hosted page
4. Call POST /api/credentials/payment/verify with the reference to confirm
```

**Errors:** `503` Paystack not configured | `502` Paystack API error

---

### POST /api/credentials/payment/verify
Verify a Paystack transaction by reference. Always verify server-side — never trust the client to self-report payment success.

**Auth required:** Yes

**Request body:**
```json
{ "reference": "abc123xyz" }
```

**Response `200`:**
```json
{
  "status": "success | failed | abandoned | pending",
  "amount": 100000,
  "currency": "NGN",
  "paid_at": "2025-01-01T12:00:00.000Z | null",
  "metadata": {}
}
```

**Errors:** `403` reference belongs to a different user | `502` Paystack API error

---

## System

### GET /api/healthz
Minimal liveness probe.

**Auth required:** No

**Response `200`:** `{ "ok": true }`

---

### GET /api/diagnostic
Full health check — tests DB connectivity, R2 bucket access, JWT secret validity, and env var presence.

**Auth required:** No

**Response `200 | 503`:**
```json
{
  "ok": true,
  "timestamp": "2025-01-01T12:00:00.000Z",
  "services": {
    "database": { "ok": true, "latencyMs": 12 },
    "r2_storage": { "ok": true },
    "jwt":        { "ok": true }
  },
  "env": [
    { "key": "TURSO_DATABASE_URL", "label": "...", "critical": true, "set": true }
  ]
}
```
