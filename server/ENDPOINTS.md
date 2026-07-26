# MeetSweet Credential Broker

All responses use:

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": "message", "code": "ERROR_CODE" }
```

## Liveness and diagnostics

- `GET /api/healthz` — liveness only.
- `GET /api/diagnostic` — safe status values only; never returns secrets.

## Authentication

The `/api/auth/*` routes own registration, email verification, login, refresh,
logout, password recovery, session management, and account security. Access
tokens are short-lived JWTs. Refresh tokens are stored hashed and rotated.

## Credential broker

- `GET /api/credentials/config` — public-safe client limits and MIME types.
- `POST /api/credentials/token` — issue a credential for approved scopes.
- `POST /api/credentials/refresh` — revoke and replace a scoped credential.
- `POST /api/credentials/revoke` — revoke a scoped credential.
- `GET /api/credentials/upload-url` — issue a 15-minute direct-to-R2 PUT URL.
- `GET /api/credentials/download-url` — issue a signed R2 GET URL for an owned key.

Approved scopes are `r2:upload` and `r2:download`. The backend never proxies
application data and never exposes permanent cloud credentials.