# Meetsweet Server — Agent Memory

Cumulative knowledge for AI agents. Updated after each working session.
Dates are 2026-08. Read `README.md` → `ARCHITECTURE.md` → this file when
starting new work.

## Project

MeetSweet is a creator platform (subscriptions, paid posts/albums, wallet,
DM rooms, short + long-form video). The **mobile app** lives in the sibling
repo `MeetSweet-mobile`; this repo is the API-only backend
(Next.js App Router + Drizzle + Turso + R2 + Resend).

## Recent work (most recent first)

| Commit | Change |
|---|---|
| `c5cea91` | Document the direct-to-R2 media upload flow |
| `3036775` | Replace large-body media uploads with direct-to-R2 sessions (`uploads/*` routes, `upload_sessions` table, presigned PUT + multipart) |
| `92f1750` | Fix login 500 by applying missing `users.two_fa_enabled` schema |
| `33ac324` | Email-code 2FA, MeetSweet-branded emails, multi-quality HLS via Cloudflare Stream |
| `7cc3020` | In-app bank-transfer wallet funding via Paystack dedicated virtual accounts |
| (earlier) | Creator pricing authoritative; catalog returns per-viewer subscription state; ranked discovery/search; album access rules; account-deletion identity reuse |

## Verified working (live QA, 2026-08-21)

A full regression pass ran the server + real Expo web app through headless
Chromium. All of the following passed end-to-end:

- **Auth:** login, register → verify email → auto-login, logout (token
  revocation), refresh rotation, expired-refresh → 401 → forced re-login.
- **Email (5 templates):** verification, sign-in/2FA, password reset, wallet
  top-up, withdrawal. Brand **MeetSweet** (company **MeetSweet Industries**),
  sender `MeetSweet Industries <noreply@meetsweet.space>`, 6-digit codes
  prominent, 15-minute expiry stated, security instructions present, inline
  MeetSweet silhouette SVG in every template.
- **API E2E:** 53/53 checks (auth, sessions, creator flows, password, 2FA,
  social, wallet, albums, content, messaging, comments, shares).
- **Sharing/deep links:** 17/17 (post/album/creator token create + resolve).
- **Upload flow:** correctly config-gated — 401 unauthenticated, 500 without
  R2 keys (with a clear message), legacy `/api/upload` → 410.
- **Paystack:** cleanly config-gated → 503 without keys; never half-funds.
- **Album purchase:** `POST /albums/:id/unlock` atomic — wallet debit +
  creator credit + `transactions` + `album_unlocks`; 402
  `INSUFFICIENT_BALANCE`; `{ purchased, already_unlocked }` on success.
- **Messaging:** room create (idempotent), send, cross-user read-back,
  replies, reactions.
- **Wallet sync:** server-side balance change propagates to the app's wallet
  screen + header badge without restart.

## Gotchas (learned the hard way)

1. **Rate limiter** (`lib/security/rate-limiter.ts`) is per-IP, in-memory.
   Login is 10/15min per IP. Automated suites hammering `127.0.0.1` exhaust
   the bucket → 429s that look like app bugs. Restart the server (or wait)
   to clear it. If the app ever shows mysterious 429s in production behind a
   proxy, the proxy IP becomes the limiter key — plan accordingly.
2. **`DATABASE_URL` trap:** in Replit, `DATABASE_URL` is the built-in
   PostgreSQL URL. libsql cannot parse it. `lib/config.ts` only reads
   `TURSO_DATABASE_URL` and strips query params. Never "fix" config to read
   `DATABASE_URL`.
3. **Refresh-token jti collision:** two refresh tokens issued within the same
   second were byte-identical (second-granularity `iat`) and collided on the
   unique `refresh_tokens.token_hash` index → login 500. Fixed by adding a
   random `jti` in `signRefreshToken`. Preserve it.
4. **`users.two_fa_enabled` missing** caused login 500 (route selected a
   column that didn't exist in the live DB). Symptom: schema drift between
   `lib/db/schema.ts` and the deployed DB. Always `pnpm migrate` the live DB
   when schema changes.
5. **Branding:** earlier work shipped "MeetSuite" branding in emails; all
   templates were corrected to **MeetSweet** / **MeetSweet Industries**.
   Watch for regressions back to MeetSuite in copy or sender names.
6. **Media URLs:** media rows reference `R2_PUBLIC_BASE_URL`; a stale/absent
   value produces broken media URLs. The mobile client also caches video
   URLs locally — server must keep `CacheControl` immutable so cached URLs
   stay valid.
7. **Per-viewer fields must stay server-computed.** If a route starts echoing
   client-supplied `subscribed_to_creator` / `isUnlockedByMe`, the app shows
   stale subscribe/purchase state. Contract in `BACKEND-SPEC.md`.

## Deploy checklist

1. `cd server && pnpm migrate` on the live DB (Turso).
2. Push main → Vercel auto-deploys.
3. Verify `/api/diagnostic` shows Turso + R2 + Resend + auth configured.
4. Spot-check: login, one email template, one upload session, one unlock.

## Open items / environment limits

- No live R2/Paystack/Resend credentials in the dev sandbox — those paths
  were verified as config-gated failures, and the email templates were
  rendered + inspected via a Resend capture harness rather than delivered to
  a real inbox.
- `report.md` (now `.agent/BACKEND-SPEC.md`) historically documented
  "remaining backend items" — those have since been implemented; treat the
  spec as the contract, not as a to-do list.
- QA scripts are intentionally not committed. To re-verify, drive the API
  against `BACKEND-SPEC.md` with ad-hoc scripts under `/tmp`.
