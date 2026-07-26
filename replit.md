# MeetSweet

Credential Broker for MeetSweet, built with Next.js 15 App Router. It handles authentication, security, diagnostics, and short-lived scoped cloud credentials. It is not a feature API.

## Run & Operate

- Start server: `cd server && pnpm install && pnpm dev`
- DB push: `cd server && pnpm db:push`

## Stack

- Next.js 15 App Router (API routes + diagnostic page)
- Turso (LibSQL) + Drizzle ORM
- Cloudflare R2 (direct signed uploads/downloads)
- Resend (email)
- JWT (jose) + Argon2 (auth)
- Zod (validation)

## Required Environment Variables

| Variable               | Description                            |
|------------------------|----------------------------------------|
| `TURSO_DATABASE_URL`   | Turso database URL (libsql://...)      |
| `TURSO_AUTH_TOKEN`     | Turso auth token                       |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID                 |
| `R2_ACCESS_KEY_ID`     | R2 access key                         |
| `R2_SECRET_ACCESS_KEY` | R2 secret key                         |
| `R2_BUCKET_NAME`       | R2 bucket name                         |
| `JWT_SECRET`           | JWT signing secret (min 32 chars)      |
| `RESEND_API_KEY`       | Resend API key                         |
| `VERIFIED_SENDER_EMAIL`| Verified sender email                  |
| `APP_URL`              | Public URL of this server              |
| `CLIENT_APP_ID`        | Client app identifier (e.g. meetsweet-mobile) |

SESSION_SECRET is already configured. JWT_SECRET falls back to SESSION_SECRET if not set.

## Where things live

- `server/app/api/auth/` — authentication and session routes
- `server/app/api/credentials/` — scoped credential and signed URL routes
- `server/lib/db/schema.ts` — broker/auth schema (Drizzle)
- `server/lib/auth/` — JWT + password helpers
- `server/middleware.ts` — CORS + security headers
- `server/app/page.tsx` — safe broker status panel
- `server/app/api/diagnostic/route.ts` — health check API

## User preferences

- Server is backend-only (API + diagnostic page, no full frontend)
