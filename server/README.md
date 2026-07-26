# MeetSweet Server

Credential-broker backend for the MeetSweet mobile app.  
Built with Next.js 15 App Router. Deploy to Vercel.

## Architecture

This server uses the **credential broker** pattern — it never sends raw secrets to
the client. Instead, it:

1. **Owns identity** — registers users, verifies email, issues and rotates JWT tokens.
2. **Brokers access** — after authenticating the caller, it generates short-lived,
   scoped credentials (presigned R2 URLs, Paystack transaction references) so the
   mobile app can talk to external services directly without ever seeing the underlying
   API secrets.

```
Mobile App  ──►  POST /api/auth/login          ──►  Server verifies, returns JWT
            ──►  GET  /api/credentials/upload-url  ──►  Server signs R2 PUT URL (15 min)
            ──►  PUT  <presigned-url>           ──►  R2 directly (server never proxies bytes)
            ──►  POST /api/credentials/payment  ──►  Server calls Paystack, returns ref + auth_url
```

## Stack

| Concern    | Tech                          |
|------------|-------------------------------|
| Framework  | Next.js 15 App Router         |
| Database   | Turso (LibSQL) + Drizzle ORM  |
| Storage    | Cloudflare R2 (presigned URLs)|
| Email      | Resend                        |
| Payments   | Paystack                      |
| Auth       | JWT (jose) + Argon2           |
| Validation | Zod                           |

## Local Development

```bash
cd server
cp .env.example .env.local   # fill in your values
pnpm install
pnpm dev                     # starts at http://localhost:3000
```

## Environment Variables

| Variable               | Required | Description                                    |
|------------------------|----------|------------------------------------------------|
| `TURSO_DATABASE_URL`   | ✅        | Turso database URL (`libsql://...`)            |
| `TURSO_AUTH_TOKEN`     | ✅        | Turso auth token                               |
| `R2_ACCOUNT_ID`        | ✅        | Cloudflare R2 account ID                       |
| `R2_ACCESS_KEY_ID`     | ✅        | R2 API access key ID                           |
| `R2_SECRET_ACCESS_KEY` | ✅        | R2 API secret access key                       |
| `R2_BUCKET_NAME`       | ✅        | R2 bucket name                                 |
| `JWT_SECRET`           | ✅*       | JWT signing secret (min 32 chars)              |
| `SESSION_SECRET`       | ✅*       | Fallback if `JWT_SECRET` is not set            |
| `RESEND_API_KEY`       | ⚠️        | Resend API key (email delivery)                |
| `RESEND_FROM_EMAIL`    | ⚠️        | Sender email (e.g. `noreply@meetsweet.app`)    |
| `PAYSTACK_SECRET_KEY`  | ⚠️        | Paystack secret key (server-side only)         |
| `PAYSTACK_PUBLIC_KEY`  | ⚠️        | Paystack public key (returned via /config)     |
| `R2_PUBLIC_BASE_URL`   | —         | CDN base URL if bucket has public access       |
| `APP_URL`              | —         | Public URL of this server                      |
| `CLIENT_APP_ID`        | —         | Client identifier (default: `meetsweet-mobile`)|

*JWT_SECRET or SESSION_SECRET — at least one must be set (min 32 chars).

## Run Commands

```bash
pnpm dev           # development server
pnpm build         # production build
pnpm start         # production server
pnpm db:push       # push schema to Turso
pnpm db:generate   # generate Drizzle migration files
pnpm db:studio     # open Drizzle Studio
```

## Diagnostic

- **Dashboard:** `GET /` — visual health check (env vars, DB ping, R2 connectivity)
- **API:**       `GET /api/diagnostic` — JSON health check
- **Ping:**      `GET /api/healthz` — minimal liveness probe

## Deploy

Push the repo and set root directory to `server` in Vercel project settings.
Add all environment variables in Vercel → Settings → Environment Variables.
