---
name: Backend Migration Rules
description: Master execution rules and checkpoint state for the serverless backend migration to Next.js/Vercel.
---

# Backend Migration — Execution Rules

## Agent Rules (HIGHEST PRIORITY)
- DO NOT use sub-agents
- DO NOT use Code Review Agent
- DO NOT analyse the whole repository
- DO NOT spend credits understanding the architecture
- DO NOT repeatedly search the same folders
- DO NOT create implementation plans
- DO NOT repeatedly inspect files
- Think minimally. Work directly. Implement immediately.
- Search ONLY files required for the current task
- Modify ONLY the requested section

## Checkpoint Protocol
If approaching context/execution limit:
1. STOP creating new code
2. Save checkpoint to this file immediately
3. Checkpoint must include: completed, remaining, files modified/created, DB changes, routes completed/remaining, env vars, blockers, exact next task

## Architecture
- `/server` — standalone Next.js App Router project (Vercel deployment)
- `/mobile` — Expo React Native mobile app (connects only to the new backend)
- The deprecated API sandbox and shared workspace libraries were removed; the mobile API client now lives under `/mobile/lib/api-client-react`

## Tech Stack
- Framework: Next.js App Router + TypeScript
- Database: Turso (LibSQL) + Drizzle ORM
- Media: Vercel Blob
- Email: Resend
- Payments: Paystack
- Validation: Zod
- Auth: JWT + Argon2 password hashing
- Deployment: Vercel

## Required Environment Variables
- DATABASE_URL (Turso URL: libsql://...)
- TURSO_AUTH_TOKEN
- BLOB_READ_WRITE_TOKEN
- RESEND_API_KEY
- RESEND_FROM_EMAIL
- PAYSTACK_SECRET_KEY
- JWT_SECRET
- APP_URL
- CLIENT_APP_ID

## DB Tables (28)
users, profiles, sessions, verification_codes, refresh_tokens, devices, posts, media, archives,
comments, comment_replies, comment_likes, saved_posts, blocked_users, muted_users,
subscriptions, wallets, transactions, notifications, conversations, conversation_members,
messages, message_reads, creator_settings, creator_statistics, reports, recent_searches

## Mobile App API URL Convention
- `EXPO_PUBLIC_API_URL` = bare Vercel URL, e.g. `https://meetsweet-server.vercel.app`
- `getApiBase()` in `mobile/services/api.ts` appends `/api` automatically
- Service files use paths like `/posts`, `/auth/login` — these resolve to `/api/posts`, etc. on Vercel

## Server Folder Map
- `server/app/api/auth/` — all auth routes
- `server/app/api/profiles/[userId]/` — profile + avatar/banner/creator-settings
- `server/app/api/posts/` — posts CRUD + like/save/pin/archive/hide/report/publish/restore
- `server/app/api/comments/` — comments + replies + like/pin
- `server/app/api/messages/` — conversations + messages + read/mute/pin/react/recall
- `server/app/api/uploads/` — Vercel Blob media upload
- `server/app/api/subscriptions/` — subscribe/cancel
- `server/app/api/wallet/` — balance + history
- `server/app/api/payments/` — Paystack init/verify/webhook
- `server/app/api/notifications/` — list/read/delete
- `server/app/api/search/` — search + recent history
- `server/app/api/users/` — me + block/mute
- `server/app/api/archive/` — creator archive
- `server/app/api/creator/` — become creator, analytics, verification
- `server/app/api/cron/` — expire-posts, expire-subscriptions
- `server/lib/db/` — Turso/Drizzle client + schema (all 28 tables)
- `server/lib/auth/` — JWT (jose), Argon2, code generation
- `server/lib/services/` — email (Resend), blob (Vercel Blob)
- `server/middleware.ts` — CORS + security headers
- `server/middleware/auth.ts` — requireAuth / optionalAuth helpers
- `server/schemas/` — Zod schemas
- `server/vercel.json` — cron schedule

## Current Project Status — COMPLETE
Migration is done. The server is deployed-ready. Mobile app updated to use EXPO_PUBLIC_API_URL.

## Validation checkpoint — July 24, 2026
- `npm install` completed successfully in `/server`.
- `npm run build` completed successfully; all 62 App Router API routes compile and are dynamic.
- `npx tsc --noEmit` completed with zero TypeScript errors.
- Built server started successfully and `GET /api/healthz` returned `{ ok: true }`.
- Database initialization is lazy in `server/lib/db/index.ts`, so Vercel builds do not require runtime Turso variables during route collection.
- JWT accepts `JWT_SECRET` with `SESSION_SECRET` fallback; no signing secret is stored in tracked config.
- Required Vercel variables remain provider-owned: `DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PAYSTACK_SECRET_KEY`, `JWT_SECRET` or `SESSION_SECRET`, `APP_URL`, `CLIENT_APP_ID`, and `CRON_SECRET`.
- Remaining deployment prerequisite: configure the listed provider variables in the Vercel project before exercising database, storage, email, payment, or cron routes.
- The root application layout intentionally contains only `mobile/` and `server/`; Replit-managed hidden directories such as `.cache/`, `.config/`, `.local/`, and `.agents/` remain outside the application layout.
