import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeCommandRateLimit,
  consumeRelayRateLimit,
  resetRateLimitsForTest,
} from "../lib/realtime/sweet-socket/rate-limit";

test.beforeEach(() => resetRateLimitsForTest());

test("command budget allows 40 commands then blocks", () => {
  let allowed = 0;
  for (let i = 0; i < 50; i++) {
    if (consumeCommandRateLimit("user_1")) allowed++;
  }
  assert.equal(allowed, 40);
  // A different user has an independent budget.
  assert.ok(consumeCommandRateLimit("user_2"));
});

test("typing relay has a per-user+channel cooldown", () => {
  assert.ok(consumeRelayRateLimit("user_1", "chat:room_1", "typing:start"));
  // Immediate repeat within the 800ms cooldown is dropped.
  assert.ok(!consumeRelayRateLimit("user_1", "chat:room_1", "typing:start"));
  // Different channel → allowed.
  assert.ok(consumeRelayRateLimit("user_1", "chat:room_2", "typing:start"));
  // Different user → allowed.
  assert.ok(consumeRelayRateLimit("user_2", "chat:room_1", "typing:start"));
});

test("relay budget allows 30 relays per window then blocks", () => {
  let allowed = 0;
  for (let i = 0; i < 40; i++) {
    // Use distinct channels/events so only the global budget binds.
    if (consumeRelayRateLimit("user_1", `chat:r${i}`, "presence:updated")) allowed++;
  }
  assert.equal(allowed, 30);
});

test("typing cooldown does not consume the global relay budget on drop", () => {
  // First typing:start is allowed and consumes budget.
  assert.ok(consumeRelayRateLimit("u", "chat:r", "typing:start"));
  // Cooldown drop must NOT consume budget.
  assert.ok(!consumeRelayRateLimit("u", "chat:r", "typing:start"));
  // Two distinct typing events + 28 more relays → the 30-budget should still
  // admit 28 more (typing consumed 1; the dropped one consumed 0).
  let allowed = 1;
  for (let i = 0; i < 40; i++) {
    if (consumeRelayRateLimit("u", `chat:x${i}`, "typing:start")) allowed++;
  }
  assert.equal(allowed, 30);
});
