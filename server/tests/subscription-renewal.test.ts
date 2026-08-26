import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUBSCRIPTION_PERIOD_MS,
  resolveRenewalDecision,
  processDueSubscriptions,
  renewForUser,
  renewExpiredSubscription,
} from "../lib/services/subscription-renewal";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 15, 0, 0, 0);

test("renewal period is exactly 30 days", () => {
  assert.equal(SUBSCRIPTION_PERIOD_MS, 30 * DAY);
});

test("decision: a not-yet-due subscription is skipped (no charge, no change)", () => {
  const d = resolveRenewalDecision({
    price: 500,
    balance: 1000,
    nowMs: now,
    expiresMs: now + 5 * DAY, // not expired yet
  });
  assert.equal(d.action, "skip");
  assert.equal(d.newExpiresMs, undefined);
});

test("decision: sufficient balance renews and extends exactly one period", () => {
  const d = resolveRenewalDecision({
    price: 500,
    balance: 1000,
    nowMs: now,
    expiresMs: now - 1, // just then expired
  });
  assert.equal(d.action, "renew");
  assert.equal(d.newExpiresMs, now + SUBSCRIPTION_PERIOD_MS);
});

test("decision: exact balance is enough to renew", () => {
  const d = resolveRenewalDecision({
    price: 500,
    balance: 500,
    nowMs: now,
    expiresMs: now - DAY,
  });
  assert.equal(d.action, "renew");
});

test("decision: insufficient balance expires the subscription (no renewal)", () => {
  const d = resolveRenewalDecision({
    price: 500,
    balance: 499,
    nowMs: now,
    expiresMs: now - DAY,
  });
  assert.equal(d.action, "expire");
  assert.equal(d.newExpiresMs, undefined);
});

test("decision: no wallet row means a priced subscription expires", () => {
  const d = resolveRenewalDecision({
    price: 200,
    balance: null,
    nowMs: now,
    expiresMs: now - DAY,
  });
  assert.equal(d.action, "expire");
});

test("decision: a free subscription (price <= 0) renews even with an empty wallet", () => {
  const d = resolveRenewalDecision({
    price: 0,
    balance: 0,
    nowMs: now,
    expiresMs: now - DAY,
  });
  assert.equal(d.action, "renew");
  assert.equal(d.newExpiresMs, now + SUBSCRIPTION_PERIOD_MS);
});

test("decision: a just-renewed row (back in the future) is skipped — prevents double charge", () => {
  // Simulate the idempotency guard: after a renewal the expires_at is pushed
  // 30 days out, so a second pass sees expires in the future and skips.
  const d1 = resolveRenewalDecision({ price: 300, balance: 900, nowMs: now, expiresMs: now - DAY });
  assert.equal(d1.action, "renew");
  const d2 = resolveRenewalDecision({ price: 300, balance: 900, nowMs: now, expiresMs: d1.newExpiresMs! });
  assert.equal(d2.action, "skip");
});

test("decision: exact boundary — expires exactly now counts as due (renews)", () => {
  const d = resolveRenewalDecision({ price: 100, balance: 100, nowMs: now, expiresMs: now });
  assert.equal(d.action, "renew");
});

test("service entry points reflect the off/on read-path and cron surface", () => {
  assert.equal(typeof processDueSubscriptions, "function"); // cron + batch
  assert.equal(typeof renewForUser, "function");            // lazy re-sync on read
  assert.equal(typeof renewExpiredSubscription, "function"); // single, idempotent renewal
});