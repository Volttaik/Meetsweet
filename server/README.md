# MeetSweet Server

Next.js App Router serverless backend for the MeetSweet mobile app. Deploy to Vercel.

## Stack

| Concern    | Tech                   |
|------------|------------------------|
| Framework  | Next.js 15 App Router  |
| Database   | Turso (LibSQL) + Drizzle ORM |
| Media      | Vercel Blob            |
| Email      | Resend                 |
| Payments   | Paystack               |
| Auth       | JWT (jose) + Argon2    |
| Validation | Zod                    |

## Local Development

```bash
cd server
cp .env.example .env.local       # fill in your values
npm install
npm run dev
```

The dev server starts at http://localhost:3000.

## Environment Variables

| Variable              | Description                           |
|-----------------------|---------------------------------------|
| `DATABASE_URL`        | Turso database URL (libsql://...)     |
| `TURSO_AUTH_TOKEN`    | Turso auth token                      |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token                   |
| `RESEND_API_KEY`      | Resend API key                        |
| `RESEND_FROM_EMAIL`   | Sender email address                  |
| `PAYSTACK_SECRET_KEY` | Paystack secret key                   |
| `JWT_SECRET`          | JWT signing secret (min 32 chars)     |
| `APP_URL`             | Your Vercel deployment URL            |
| `CLIENT_APP_ID`       | Client app identifier                 |
| `CRON_SECRET`         | Secret for Vercel Cron authorization  |

## Deploy to Vercel

1. Push the `/server` directory (or the whole repo — configure root directory to `server` in Vercel)
2. Add all environment variables in Vercel project settings
3. Cron jobs run automatically per `vercel.json`

## Database Setup

```bash
npm run db:push    # push schema to Turso (dev)
npm run db:generate  # generate migration files
```

## API Routes

### Auth
- `POST /api/auth/register` — register new user
- `POST /api/auth/login` — login
- `POST /api/auth/logout` — logout (revokes refresh token)
- `POST /api/auth/refresh` — rotate access/refresh tokens
- `POST /api/auth/verify-email` — verify email with code
- `POST /api/auth/forgot-password` — request reset code
- `POST /api/auth/reset-password` — reset password with code
- `POST /api/auth/update-password` — change password (authenticated)
- `POST /api/auth/update-email` — change email (authenticated)
- `POST /api/auth/resend-verification` — resend verification email
- `GET  /api/auth/username-availability?username=` — check username
- `DELETE /api/auth/delete-account` — soft-delete account

### Users / Profiles
- `GET  /api/users/me` — current user
- `GET  /api/profiles/:userId` — get profile
- `PATCH /api/profiles/:userId` — update profile
- `PUT  /api/profiles/:userId/avatar` — upload avatar
- `DELETE /api/profiles/:userId/avatar` — remove avatar
- `PUT  /api/profiles/:userId/banner` — upload banner
- `DELETE /api/profiles/:userId/banner` — remove banner
- `GET/PUT /api/profiles/:userId/creator-settings` — creator settings
- `POST /api/users/block` — block a user
- `DELETE /api/users/block` — unblock
- `POST /api/users/mute` — mute a user
- `DELETE /api/users/mute` — unmute

### Posts
- `GET  /api/posts` — feed
- `POST /api/posts` — create post (draft or published)
- `GET  /api/posts/:postId` — get post
- `PATCH /api/posts/:postId` — update post
- `DELETE /api/posts/:postId` — soft delete post
- `POST /api/posts/:postId/publish` — publish draft
- `POST /api/posts/:postId/restore` — restore deleted post
- `POST/DELETE /api/posts/:postId/like` — like/unlike
- `POST/DELETE /api/posts/:postId/save` — save/unsave
- `POST/DELETE /api/posts/:postId/pin` — pin/unpin
- `POST/DELETE /api/posts/:postId/archive` — archive/restore from archive
- `POST /api/posts/:postId/hide` — hide post from feed
- `POST /api/posts/:postId/report` — report post
- `GET/POST /api/posts/:postId/comments` — list/create comments

### Comments
- `PATCH/DELETE /api/comments/:commentId` — edit/delete
- `POST/DELETE /api/comments/:commentId/like` — like/unlike
- `POST/DELETE /api/comments/:commentId/pin` — pin/unpin (creator)
- `GET/POST /api/comments/:commentId/replies` — list/create replies

### Messages
- `GET/POST /api/messages/conversations` — list/create conversations
- `GET/DELETE /api/messages/conversations/:id` — get/leave conversation
- `GET/POST /api/messages/conversations/:id/messages` — paginated messages / send
- `POST /api/messages/conversations/:id/read` — mark read
- `POST/DELETE /api/messages/conversations/:id/mute` — mute/unmute
- `POST/DELETE /api/messages/conversations/:id/pin` — pin/unpin
- `PATCH/DELETE /api/messages/:messageId` — edit/delete message
- `POST /api/messages/:messageId/recall` — recall message
- `POST/DELETE /api/messages/:messageId/react` — add/remove reaction

### Uploads
- `POST /api/uploads` — upload media file → returns `{ id, url, type }`

### Search
- `GET /api/search?q=&type=all|users|creators|posts` — search
- `GET/DELETE /api/search/recent` — recent searches

### Subscriptions
- `GET/POST /api/subscriptions` — list / subscribe
- `POST /api/subscriptions/:id/cancel` — cancel

### Wallet & Payments
- `GET /api/wallet` — balance + transaction history
- `POST /api/payments/initialize` — initialize Paystack payment
- `GET  /api/payments/verify?reference=` — verify payment
- `POST /api/payments/webhook` — Paystack webhook (HMAC-verified)

### Notifications
- `GET /api/notifications` — list + unread count
- `POST /api/notifications/read-all` — mark all read
- `PATCH/DELETE /api/notifications/:id` — read/delete

### Archive
- `GET /api/archive` — creator's archive

### Creator
- `POST /api/creator/become` — activate creator account
- `GET /api/creator/analytics` — analytics
- `POST /api/creator/verification` — request verification

### Cron (Vercel Cron — requires `Authorization: Bearer <CRON_SECRET>`)
- `GET /api/cron/expire-posts` — archive expired posts
- `GET /api/cron/expire-subscriptions` — expire lapsed subscriptions

### Health
- `GET /api/healthz` — health check
