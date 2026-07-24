# MeetSweet

MeetSweet is an Expo mobile app for connecting creators with their communities through exclusive content, messaging, and subscriptions.

## Run & Operate

- `pnpm --filter @workspace/meetsweet run dev` — run the Expo app
- `pnpm --filter @workspace/api-server run dev` — run the API server (managed service port 8080)
- `pnpm --filter @workspace/mockup-sandbox run dev` — run the component preview server
- `pnpm --filter @workspace/meetsweet run typecheck` — typecheck the mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env for database-backed API routes: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/meetsweet/app/` — Expo Router screens and authenticated tab routes
- `artifacts/meetsweet/components/` — shared mobile UI components and loading states
- `artifacts/meetsweet/constants/theme.ts` — MeetSweet dark theme tokens and typography
- `artifacts/api-server/src/` — Express API server
- `artifacts/mockup-sandbox/` — isolated component preview app

## Architecture decisions

- Expo Router owns navigation; the root stack contains auth, onboarding, tab, and push routes.
- HeroUI Native is the shared source for buttons, inputs, spinners, skeletons, and provider behavior.
- The app uses a dark-first token set in `constants/theme.ts`, with Poppins loaded before rendering.
- Server state is reserved for React Query; the current Section 2 screens use local/static presentation data.

## Product

- Onboarding and registration flows
- Authenticated home feed, explore, messages, profile, notifications, and settings screens
- Creator onboarding and dashboard entry points

## User preferences

- Preserve the existing Expo, pnpm workspace, HeroUI Native, and dark-first architecture when extending the app.

## Gotchas

- Use the managed artifact workflows for Expo, the API server, and the mockup sandbox; they provide the required Replit environment.
- The Expo preview can show a blank frame during the timed splash transition; `/welcome` is a stable route for visual checks.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
