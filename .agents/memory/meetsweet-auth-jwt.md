---
name: MeetSweet Auth JWT
description: JWT signing secret config and what NOT to do with .replit.
---

# MeetSweet Auth JWT

## Rule
JWT signing uses `process.env.JWT_ACCESS_SECRET ?? process.env.SESSION_SECRET` (see `artifacts/api-server/src/lib/auth.ts`). SESSION_SECRET is already a Replit Secret and serves as a valid fallback.

**Why:** `setEnvVars()` in CodeExecution writes values to `[userenv.shared]` in `.replit`, which is tracked by git. Storing a signing secret there exposes it in version history.

**How to apply:** Use `requestSecrets({ keys: ["JWT_ACCESS_SECRET"] })` if a dedicated key is needed. Never call `setEnvVars` for any secret/signing material. The SESSION_SECRET fallback means a separate JWT secret is optional.

## Runtime-managed vars (do NOT set manually)
DATABASE_URL, PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE — Replit injects these automatically.
