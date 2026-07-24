---
name: MeetSweet Registration Email
description: Email sending on register is non-fatal; missing RESEND keys must not block account creation.
---

# MeetSweet Registration Email

## Rule
`emailService.sendWelcomeEmail` and `sendVerificationEmail` are called in `artifacts/api-server/src/routes/auth.ts` during registration. They throw if `RESEND_API_KEY` or `RESEND_FROM_EMAIL` is missing. These calls must be fire-and-forget (`.catch` only, no `await`) so registration succeeds even without email credentials.

**Why:** Without this, any user trying to register when email is not configured gets a 500 "Registration failed" response — the account is never created.

**How to apply:** Wrap the `Promise.all([sendWelcome, sendVerification])` in a `.catch()` with a `console.warn`, not an `await`. The verification code is already saved to `email_verifications` before the send attempt, so re-sending later is possible.

## Current state
- RESEND_API_KEY and RESEND_FROM_EMAIL are set as Replit Secrets.
- The non-fatal pattern is in place in auth.ts (registration route).
