import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationTitle, extractUsernames } from "../lib/services/notifications";

// ─── notificationTitle ───────────────────────────────────────────────────────

test("notificationTitle maps known event types to display titles", () => {
  assert.equal(notificationTitle("like"), "New Like");
  assert.equal(notificationTitle("comment"), "New Comment");
  assert.equal(notificationTitle("reply"), "New Reply");
  assert.equal(notificationTitle("subscribe"), "New Subscriber");
  assert.equal(notificationTitle("new_post"), "New Post");
  assert.equal(notificationTitle("mention"), "You were mentioned");
  assert.equal(notificationTitle("payment"), "Payment Received");
  assert.equal(notificationTitle("private_message"), "New Private Message");
  assert.equal(notificationTitle("private_message_reply"), "Private Message Reply");
  assert.equal(notificationTitle("referral_reward"), "Referral Reward");
  assert.equal(notificationTitle("subscription_renewed"), "Subscription Renewed");
  assert.equal(notificationTitle("subscription_renewal_failed"), "Subscription Expired");
});

test("notificationTitle falls back to a generic title for unknown types", () => {
  assert.equal(notificationTitle("alien_event_42"), "Notification");
  assert.equal(notificationTitle(""), "Notification");
});

// ─── extractUsernames (moved from the old mentions service) ─────────────────

test("extractUsernames returns unique @mentions, deduped and lowercased", () => {
  const result = extractUsernames("hey @Amara check @amara and @Chisom");
  assert.deepEqual(result, ["amara", "chisom"]);
});

test("extractUsernames ignores emails and mid-word @ symbols", () => {
  const result = extractUsernames("mail me at user@example.com and hello@x world");
  assert.deepEqual(result, []);
});

test("extractUsernames caps at MAX_MENTIONS (10)", () => {
  const text = Array.from({ length: 15 }, (_, i) => `@user_${i}`).join(" ");
  const result = extractUsernames(text);
  assert.equal(result.length, 10);
});

test("extractUsernames handles null/empty input", () => {
  assert.deepEqual(extractUsernames(null), []);
  assert.deepEqual(extractUsernames(undefined), []);
  assert.deepEqual(extractUsernames(""), []);
});

test("extractUsernames requires valid username shape (3–30 chars)", () => {
  assert.deepEqual(extractUsernames("@ab"), []);
  assert.deepEqual(extractUsernames("@valid_name"), ["valid_name"]);
});
