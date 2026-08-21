# Meetsweet Server — Architecture

How the backend is structured and how the pieces interact. Read
`README.md` first for the repo map and quickstart.

## Stack

- **Next.js App Router** (TypeScript) — every endpoint is a
  `route.ts` under `server/app/api/**`. No pages; the server is API-only.
- **Drizzle ORM + libsql** (`@libsql/client`) — SQLite-compatible database
  (Turso in production, local file for dev). Schema lives in
  `lib/db/schema.ts` (40 tables, see `db-schema.json`).
- **jose (JWT)** — HS256 access + refresh tokens.
- **zod** — request body/query validation.
- **@aws-sdk/client-s3 + s3-request-presigner** — Cloudflare R2 (S3-compatible).
- **Resend** — transactional email.
- **Optional:** Cloudflare Stream (HLS transcoding), Paystack (payments).

## Request lifecycle

```
mobile client
   │  fetch(EXPO_PUBLIC_API_URL + "/api/...", { Authorization: Bearer <access> })
   ▼
Next.js route handler (server/app/api/**/route.ts)
   │  1. (if authed) middleware/auth.ts validates the JWT
   │     → attaches userId / role to the request (req.user)
   │  2. lib/api/validate.ts: zod-parses body / query → 422 on mismatch
   │  3. lib/services/*.ts: domain logic + DB reads/writes
   │  4. lib/api/response.ts: JSON envelope
   ▼
{ ok: true, data, message? }   |   { ok: false, error, code? }  (HTTP 400/401/403/404/409/413/422/500/503)
```

### Authentication (`lib/auth/` + `middleware/auth.ts`)

- `jwt.ts` — `signAccessToken` (15 min), `signRefreshToken` (30 d, unique `jti`),
  `verifyToken`, plus 2FA challenge tokens (5 min, `purpose: "two_fa_login"`).
- `session.ts` — session rows (devices), refresh-token rotation & revocation.
  A used refresh token is invalidated and replaced; revoked/expired refresh
  tokens return 401 and force re-login.
- `password.ts` — password hashing/verification.
- `codes.ts` — 6-digit verification codes (email verify, 2FA, password reset)
  with expiry.
- Routes: `POST /api/auth/login|register|refresh|logout|logout-all|forgot-password|
  reset-password|verify-email|resend-verification|change-password|delete-account`,
  `GET/POST /api/auth/2fa/{setup,status,enable,disable,verify}`,
  `POST /api/auth/biometric`, `GET /api/auth/username-availability`.
- Login with 2FA enabled returns a short-lived challenge token instead of
  access tokens; the client completes `POST /api/auth/2fa/verify` with the
  email code to receive real tokens.

### Rate limiting (`lib/security/rate-limiter.ts`)

Per-IP in-memory sliding window. Login is capped (10 / 15 min), other
sensitive routes have their own buckets. It is in-memory only — restarts
reset it. Heavy automated testing from one IP can exhaust a bucket; wait or
restart the server.

### Database (`lib/db/`)

- `index.ts` — libsql client from `config.turso` (never `DATABASE_URL`; that
  var is the Replit built-in PostgreSQL URL which libsql can't parse).
- `schema.ts` — Drizzle schema; all tables listed in `db-schema.json`.
- `scripts/migrate.ts` — idempotent migrator (`pnpm migrate`); safe to run
  repeatedly. **Run it after any schema change.**

### Media uploads (direct-to-R2, no server body size limit)

The 413 problem is solved structurally: media bytes never cross a route
handler's request body.

```
client → POST /api/uploads                  (auth required) → upload_sessions row + R2 presigned URLs
client → PUT <presigned R2 URL>             (small file)  → bytes straight to R2
   or   POST /api/uploads/:id/parts/:n      (multipart, >20 MiB, per-part presigned URLs + ETag tracking)
client → POST /api/uploads/:id/complete     → server verifies bytes in R2, creates `media` row
client → media row id attached to post/album/short
```

- `lib/services/uploads.ts` — session lifecycle, multipart orchestration.
- `lib/services/r2.ts` — S3-compatible client, presigning, immutable CacheControl.
- `POST /api/media` completes/registers media; `GET /api/media/:id` serves
  metadata (URLs are served from `R2_PUBLIC_BASE_URL`).
- Legacy `POST /api/upload` returns 410 Gone.
- Media rows store `mediaType`, dimensions, duration; videos may also carry
  `qualities` (Cloudflare Stream HLS) — see `lib/services/stream.ts`.

### Email (`lib/services/email.ts`)

Resend-based, branded **MeetSweet** (company **MeetSweet Industries**), sender
`MeetSweet Industries <noreply@meetsweet.space>` (from `VERIFIED_SENDER_EMAIL`).
Five templates, all with the MeetSweet silhouette SVG inlined:
1. Email verification (`verify-email` flow)
2. Sign-in / 2FA code
3. Password reset
4. Wallet top-up confirmation
5. Withdrawal request confirmation

All codes are 6 digits, shown prominently, with a 15-minute expiry and
security instructions. Rendering is tested via the Resend capture harness
(see `AGENT_MEMORY.md`).

### Payments / wallet (`lib/services/paystack.ts` + routes)

- Wallet ledger: `wallets` (balance) + `transactions` (ledger rows) +
  `subscriptions`/`album_unlocks` purchases.
- Funding: `POST /api/payments/initiate-paystack` (virtual account),
  `POST /api/payments/paystack-webhook` (confirm), `POST /api/payments/verify-paystack`.
- Withdrawals: `POST /api/payments/withdraw` (+`/finalize`),
  `GET /api/payments/withdrawal-history`.
- Config-gated: without `PAYSTACK_SECRET_KEY` the funding endpoints return
  clean 503s so the app can never half-fund a wallet.

### Sharing / deep links (`lib/services/content.ts` + share routes)

`POST /api/share/create` mints a `shares` row with a short token →
`POST /api/share/resolve/:token` (or `GET /api/shares/:token`) returns the
target type + id. The mobile client deep-links to
`meetsweet://s/<token>` / `https://meetsweet.space/s/<token>` and resolves it
in `app/s/[token].tsx`.

### Real-time-ish sync (poll-based, no websockets)

There is no socket layer. Chat and comment rooms expose lightweight
`changes` endpoints (`GET /api/chat-rooms/:id/changes`,
`GET /api/comment-rooms/:id/comments/changes`) that the client polls.
Mutation endpoints (`like`, `comment`, `subscribe`, `unlock`, wallet ops)
return authoritative state; the client applies it immediately (optimistic
updates are reconciled server-side — see mobile `data-flows.md`).

## How the parts interact (dependency graph)

```
route.ts (app/api/**)
   ├── middleware/auth.ts ──────► lib/auth/{jwt,session,password,codes}.ts
   ├── lib/api/{validate,response}.ts
   └── lib/services/*
        ├── content.ts / albums.ts / pricing.ts / views.ts ──► lib/db
        ├── chat-rooms.ts / comment-rooms.ts ────────────────► lib/db
        ├── email.ts ──► Resend
        ├── uploads.ts / r2.ts / stream.ts ──► Cloudflare R2 / Stream
        ├── paystack.ts ──► Paystack API
        └── push.ts ──► push notifications
   └── lib/security/rate-limiter.ts (wraps sensitive routes)
```

- **Route handlers are thin.** All nontrivial logic lives in
  `lib/services/*` so it is testable and shared.
- **Never trust the client for state.** Per-viewer fields
  (`subscribed_to_creator`, `subscription_tier`, `isUnlockedByMe`, prices,
  `unlocked`) are always resolved from live DB rows on the server.
- **Server-enforced visibility.** Locked album items return null URLs;
  paid posts gate content; hidden/muted/blocked users are excluded server-side.
