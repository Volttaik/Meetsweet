# Meetsweet Server — Agent Workspace

This `.agent/` folder is the canonical knowledge base for AI agents working on
the **MeetSweet backend** (this repo). Read `README.md` first, then dive into
whatever is relevant to your task.

## Repo layout

```
Meetsweet/
├── .agent/                  ← you are here
│   ├── README.md            ← this file (start here)
│   ├── AGENT_MEMORY.md      ← session memory: recent work, gotchas, status
│   ├── ARCHITECTURE.md      ← how the server is built and how parts interact
│   ├── BACKEND-SPEC.md      ← the full mobile↔backend wire contract (API spec)
│   ├── CONVENTIONS.md       ← coding conventions & error envelope
│   ├── components.json      ← machine-readable map of routes / services / modules
│   ├── db-schema.json       ← every table, its purpose and relations
│   └── env.json             ← every environment variable and its role
├── server/
│   ├── app/api/             ← Next.js App Router API routes (route.ts per endpoint)
│   ├── lib/
│   │   ├── api/             ← response envelope + zod validation helpers
│   │   ├── auth/            ← JWT, sessions, password hashing, verification codes
│   │   ├── db/              ← libsql client + Drizzle schema (40 tables)
│   │   ├── security/        ← per-IP rate limiter
│   │   └── services/        ← domain services: email, r2, uploads, paystack, ...
│   ├── middleware/auth.ts   ← bearer-token authentication for API routes
│   ├── scripts/
│   │   ├── migrate.ts       ← schema migrations (`pnpm migrate`)
│   │   └── audit.ts         ← data audit utility (`pnpm audit:data`)
│   └── package.json
└── (root files: .replit, .gitignore, pnpm-workspace.yaml, …)
```

## Quickstart

```bash
cd server
pnpm install
# copy .env.example → .env and fill in credentials (see env.json)
pnpm migrate          # applies schema idempotently (scripts/migrate.ts)
pnpm dev              # Next.js dev server, default :3000
```

Health check: `GET /api/health` and `GET /api/healthz` return 200 when the
server is up. `GET /api/diagnostic` reports which external services
(Turso / R2 / Resend / auth secret) are configured.

## External services (all config-gated)

| Service | Purpose | Required? |
|---|---|---|
| **Turso (libsql)** | primary database | required |
| **Cloudflare R2** | media object storage + presigned uploads | required for media |
| **Resend** | transactional email (verify / 2FA / reset / wallet) | required for email |
| **JWT secret** | access/refresh token signing (≥32 chars) | required |
| **Cloudflare Stream** | multi-quality HLS transcoding (optional; falls back to MP4) | optional |
| **Paystack** | wallet funding via virtual accounts + withdrawals | optional (503 without keys) |

If an optional service is unconfigured its endpoints fail cleanly
(503/410 with a clear message) instead of crashing.

## Key files to read first

1. `lib/config.ts` — every env var, with production-name fallbacks.
2. `lib/api/response.ts` — the `{ ok, data | error, code }` envelope every route uses.
3. `middleware/auth.ts` — how authenticated routes resolve the current user.
4. `lib/db/schema.ts` — the 40 tables (also summarized in `db-schema.json`).
5. `BACKEND-SPEC.md` — the contract the mobile client depends on. **Do not break it.**

## Deploy notes

- The server deploys to Vercel (`next build` / `next start`). Body-size limits
  are why media uploads use direct-to-R2 presigned sessions, never multipart
  through a route handler (see `ARCHITECTURE.md` → Media uploads).
- After schema changes run `pnpm migrate` locally **and** on the live DB before
  deploying the new code.
- The mobile client reads several per-viewer fields (`subscribed_to_creator`,
  `subscription_tier`, `isUnlockedByMe`, album prices) from live responses.
  Never return client-supplied values for these.

## House rules

- `.agents/` (with an `s`) at the repo root is platform-managed metadata —
  do not edit it. This `.agent/` folder is the documentation.
- QA/verification scripts are intentionally not committed; reproduce checks via
  the API contract in `BACKEND-SPEC.md` or ad-hoc scripts under `/tmp`.
