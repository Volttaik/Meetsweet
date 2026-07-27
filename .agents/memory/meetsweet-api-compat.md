---
name: MeetSweet API compatibility audit
description: What was built and key decisions made when aligning the backend to the mobile app's API contract
---

# MeetSweet API compatibility

## Context
Mobile app (React Native/Expo, `/tmp/mobile/`) is the source of truth. Backend is Next.js 15 App Router + Drizzle/Turso at `server/app/api/`.

All API calls go through `apiFetch()` which unwraps `{ ok: true, data: … }` envelopes, so route handlers use `ok()` / `created()` from `@/lib/api/response`.

## Key architectural patterns
- `requireAuth(req)` / `optionalAuth(req)` — returns `{ user: { userId } }` or `{ response: Response }`
- `parseBody(req, zodSchema)` — returns `{ success, data }` or `{ success: false, response }`
- `ok()`, `created()`, `err()`, `notFound()` from `@/lib/api/response`
- `generateId()` from `@/lib/auth/codes`
- `db` from `@/lib/db`; tables from `@/lib/db/schema`

## Response shape decisions

**Why:** Mobile normalizers check camelCase fields only (e.g. `raw.otherUser`, `raw.isOwn`). We return both camelCase and snake_case for maximum compat.

- `GET /api/users/me` — returns user fields at top level (not `{ user: … }`), with `follower_count`, `following_count`, `post_count`
- `GET /api/wallet` — returns `{ balance, currency }` at top level
- `GET /api/settings` — returns settings fields at top level, NOT `{ settings: … }`
- `GET /api/creator/settings` — returns `{ subscription_price, allow_dms, allow_comments, welcome_message }` at top level
- `GET /api/creator/statistics` — returns `{ period_stats, active_subscribers, total_posts, total_revenue }` (not raw db rows)
- `GET /api/notifications` — includes `title`, `data { post_id, actor_id, actor_name, … }`, `unread_count`
- `POST /api/posts` — returns `{ id }` not `{ post }`. Supports both `media_ids: string[]` and inline `media: [{}]`
- `POST /api/conversations` — accepts `userId` (camelCase) OR `user_id`; returns `{ conversationId, created }`
- `GET /api/conversations` — returns `otherUser` (camelCase), `unreadCount`, `lastMessageBody`
- `GET /api/conversations/[id]/messages` — returns `isOwn`, `mediaType`, `isDeleted` (camelCase + snake_case)

## New routes created (24 total)
- `GET /api/users/[username]/posts`
- `POST /api/users/[username]/report`
- `POST /api/posts/[id]/publish`
- `POST /api/posts/[id]/archive`
- `POST /api/posts/[id]/restore`
- `GET|POST /api/comments/[commentId]/replies`
- `POST /api/comments/[commentId]/report`
- `POST /api/messages/conversations/[conversationId]/read`
- `DELETE /api/notifications/[id]`
- `POST /api/subscriptions/[id]/cancel`
- `GET /api/payments/verify?reference=…`
- `GET /api/search`
- `GET|DELETE /api/search/recent`
- `GET /api/explore`
- `POST /api/creator/become`
- `POST /api/creator/verification`
- `POST /api/creator/withdraw`
- `POST /api/auth/change-password`
- `PATCH /api/auth/biometric`
- `DELETE /api/auth/delete-account`
- `POST /api/auth/logout-all`
- `GET /api/auth/username-availability`

**Why:** All discovered via mobile service files in `/tmp/mobile/services/`. TypeScript compiled clean after all additions.
