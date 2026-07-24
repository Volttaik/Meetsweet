# MeetSweet

Backend API server for the MeetSweet mobile app, built with Next.js 15 App Router. Includes a diagnostic dashboard to verify environment, database, and service health.

## Run & Operate

- Start server: `cd server && pnpm install && pnpm dev`
- DB push: `cd server && pnpm db:push`
- DB studio: `cd server && pnpm db:studio`

## Stack

- Next.js 15 App Router (API routes + diagnostic page)
- Turso (LibSQL) + Drizzle ORM
- Vercel Blob (media uploads)
- Resend (email)
- Paystack (payments)
- JWT (jose) + Argon2 (auth)
- Zod (validation)

## Required Environment Variables

| Variable               | Description                            |
|------------------------|----------------------------------------|
| `DATABASE_URL`         | Turso database URL (libsql://...)      |
| `TURSO_AUTH_TOKEN`     | Turso auth token                       |
| `JWT_SECRET`           | JWT signing secret (min 32 chars)      |
| `BLOB_READ_WRITE_TOKEN`| Vercel Blob token                      |
| `RESEND_API_KEY`       | Resend API key                         |
| `RESEND_FROM_EMAIL`    | Sender email address                   |
| `PAYSTACK_SECRET_KEY`  | Paystack secret key                    |
| `APP_URL`              | Public URL of this server              |
| `CLIENT_APP_ID`        | Client app identifier (e.g. meetsweet-mobile) |
| `CRON_SECRET`          | Secret for cron job route              |

SESSION_SECRET is already configured. JWT_SECRET falls back to SESSION_SECRET if not set.

## Where things live

- `server/app/api/` — all API routes (auth, posts, messages, etc.)
- `server/lib/db/schema.ts` — database schema (Drizzle)
- `server/lib/auth/` — JWT + password helpers
- `server/middleware.ts` — CORS + security headers
- `server/app/page.tsx` — diagnostic dashboard (homepage)
- `server/app/api/diagnostic/route.ts` — health check API

## User preferences

- Keep mobile and server as separate projects
- Server is backend-only (API + diagnostic page, no full frontend)
