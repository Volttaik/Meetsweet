---
name: Cron architecture
description: Single consolidated daily cron for Vercel Hobby compatibility; maintenance service locations and env vars.
---

# Cron architecture

## Rule
The server exposes exactly ONE cron endpoint: `GET /api/cron/daily`.
Vercel Hobby plan allows only one scheduled cron job — never add a second entry to `server/vercel.json`.

**Why:** Multiple cron entries cause Vercel Hobby deployment failures. All maintenance work is consolidated here.

**How to apply:** Add any new scheduled maintenance as a new service module in `server/services/maintenance/` and import + call it inside the existing handler in `server/app/api/cron/daily/route.ts`.

## Master cron
- Route: `server/app/api/cron/daily/route.ts`
- Schedule: `0 0 * * *` (daily at midnight UTC)
- Auth: `Authorization: Bearer <CRON_SECRET>` header — verified against `process.env.CRON_SECRET`

## Maintenance service modules
All live in `server/services/maintenance/`:
- `expirePosts.ts` — marks expired published posts as archived; inserts into `archives` table
- `expireSubscriptions.ts` — marks active subscriptions as expired past their `expires_at`
- `cleanupVerificationCodes.ts` — deletes expired or used verification codes
- `cleanupSessions.ts` — deletes sessions past their `expires_at`
- `cleanupRefreshTokens.ts` — deletes expired or revoked refresh tokens

## Response shape
```json
{
  "success": true,
  "tasksCompleted": ["expirePosts (archived: 3)", ...],
  "tasksFailed": [],
  "executionTime": 412
}
```
Each task has its own try/catch — one failure does not stop the rest.

## Required environment variable
- `CRON_SECRET` — must be set in Vercel project settings; also documented in `server/.env.example`

## Removed routes
- `server/app/api/cron/expire-posts/` — deleted; logic moved to `expirePosts.ts`
- `server/app/api/cron/expire-subscriptions/` — deleted; logic moved to `expireSubscriptions.ts`
