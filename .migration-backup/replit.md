# MeetSweet

MeetSweet is a creator-focused social app with an Expo mobile client and a standalone Next.js API backend.

## Run & Operate

- `pnpm --dir mobile run dev` — run the Expo mobile app
- `pnpm --dir server run dev` — run the Next.js backend locally
- `pnpm run typecheck` — check mobile and server TypeScript
- `pnpm run build` — check both apps and build the backend
- `pnpm --dir server run db:push` — push the Turso schema in development
- Required server env: `DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PAYSTACK_SECRET_KEY`, `JWT_SECRET` or `SESSION_SECRET`, `APP_URL`, `CLIENT_APP_ID`, and `CRON_SECRET`
- Required mobile env: `EXPO_PUBLIC_API_URL`

## Stack

- pnpm workspace with two packages: `mobile/` and `server/`
- Mobile: Expo Router, React Native, Uniwind, React Query
- Backend: Next.js App Router, Turso LibSQL, Drizzle ORM, Vercel Blob, Resend, Paystack, JWT, Argon2, and Zod

## Where things live

- `mobile/` — Expo application, screens, services, theme, and local generated API client
- `server/app/api/` — backend route handlers
- `server/lib/db/` — Turso/Drizzle client and schema
- `server/lib/auth/` — JWT, password hashing, and code generation
- `server/lib/services/` — email and Vercel Blob services
- `server/.env.example` — backend environment variable template

## Architecture decisions

- The backend is a standalone Next.js project intended for Vercel deployment.
- The mobile app calls the backend through `EXPO_PUBLIC_API_URL` and appends `/api`.
- The mobile API client is kept locally under `mobile/lib/api-client-react` so the app does not depend on a shared workspace library.
- Database initialization is lazy so Vercel route collection does not require production-only database variables.

## Product

MeetSweet provides onboarding and authentication, a creator marketplace, posts and comments, profiles, messaging, notifications, subscriptions, wallet and payment flows, media uploads, and creator tools.

## User preferences

Keep the project focused on the two application directories: `mobile/` and `server/`.

## Gotchas

- The server expects Turso/LibSQL `DATABASE_URL`, not a PostgreSQL connection string.
- Configure provider secrets in the deployment environment; never commit them.
- The Expo app should be pointed at the deployed backend URL before testing authenticated flows.

## Pointers

- See `server/README.md` for the backend API and Vercel deployment notes.
