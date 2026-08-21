# Meetsweet Server — Conventions

Rules to follow when editing this backend. The wire contract (exact field
names the mobile client depends on) is in `BACKEND-SPEC.md` — never break it.

## API envelope

Every response is JSON with this exact shape (from `lib/api/response.ts`):

```jsonc
// success
{ "ok": true, "data": { ... }, "message": "optional" }

// error
{ "ok": false, "error": "human message", "code": "MACHINE_CODE" }
```

Use the helpers — never hand-roll responses:

| Helper | HTTP | code |
|---|---|---|
| `ok(data, message?)` | 200 | — |
| `created(data)` | 201 | — |
| `err(msg, status, code?)` | custom | custom |
| `unauthorized()` | 401 | UNAUTHORIZED |
| `forbidden()` | 403 | FORBIDDEN |
| `notFound()` | 404 | NOT_FOUND |
| `serverError()` | 500 | INTERNAL_ERROR |

Special codes the client switches on: `INSUFFICIENT_BALANCE` (402, album
unlock / subscribe), 422 validation (field errors from
`lib/api/validate.ts`), 413 (never — uploads bypass route bodies), 503
(config-gated services like Paystack), 410 (legacy `/api/upload`).

## Route handler shape

```ts
import { ok, err } from "@/lib/api/response";
import { parseBody } from "@/lib/api/validate";
import { requireAuth } from "@/middleware/auth";
import { z } from "zod";

const schema = z.object({ /* ... */ });

export async function POST(req: Request) {
  const user = requireAuth(req);            // 401 if no/expired token
  const body = await parseBody(req, schema); // 422 on mismatch
  if (!body.success) return body.response;
  // domain logic → lib/services/*
  return ok(result);
}
```

- **Thin routes.** All nontrivial logic goes in `lib/services/*` (or a new
  service file) so it is testable and reusable across routes.
- **zod everywhere.** Every body and query is validated; errors surface field
  names (e.g. `email: Invalid email`).

## Database

- Schema lives in `lib/db/schema.ts` (Drizzle). Tables are documented in
  `.agent/db-schema.json`.
- **Migrate after schema changes:** `cd server && pnpm migrate`
  (idempotent, `scripts/migrate.ts`). Run locally and on the live DB before
  deploying new code.
- Monetary values are integers (naira, ₦) in `wallets.balance` and
  `transactions.amount`.
- Transactions (`db.transaction`) for anything that moves money: album unlock,
  subscribe, withdraw — debit + credit + ledger must commit atomically.
- Per-viewer state (`subscribed_to_creator`, `subscription_tier`,
  `isUnlockedByMe`) is **always** computed from live DB rows for the
  authenticated user. Never accept these from the client.

## Auth

- Access token: 15 min, signed in `lib/auth/jwt.ts` (jose HS256).
- Refresh token: 30 d, **must have a unique `jti`** — two tokens created in
  the same second would otherwise hash- collide on the unique
  `refresh_tokens.token_hash` index and 500.
- Use `requireAuth(req)` from `middleware/auth.ts` for protected routes;
  it attaches `userId`/`role` and returns 401 otherwise.
- 2FA challenge tokens are single-purpose (`purpose: "two_fa_login"`, 5 min)
  and can never be used as access tokens.

## Config / secrets

- Add env vars to `lib/config.ts` with the production name first and a
  fallback alias second (see `env.json`). Secrets are never exported.
- New optional integrations must be **config-gated**: check
  `serviceConfigured(...)` and return a clean 503 with a clear message when
  unconfigured — never crash and never half-work.

## Naming & style

- Route files: `server/app/api/<domain>/[param]/route.ts`, one exported
  handler per HTTP method.
- Services: `lib/services/<domain>.ts`, exported functions, no classes
  unless there is real state to encapsulate.
- Error `code` values are `UPPER_SNAKE` and stable — the client matches on
  them, so renaming one is a breaking change.
- Keep the mobile contract in `BACKEND-SPEC.md` in sync with any response
  shape change.

## What NOT to do

- Do not reintroduce server-buffered media uploads (413). Media bytes go
  direct to R2 via `uploads/*` sessions.
- Do not trust client-supplied prices, tiers, or unlock flags.
- Do not send raw secrets in responses (config never exposes them).
- Do not break the `{ ok, data | error, code }` envelope.
