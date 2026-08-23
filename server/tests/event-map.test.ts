import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWEETSOCKET_EVENT,
  SWEETSOCKET_EVENT_META,
  SWEETSOCKET_ERROR,
  isCanonicalEvent,
} from "../lib/realtime/sweet-socket/event-map";
import { canonicalEventType } from "../lib/realtime/sweet-socket/event-emitter";

test("canonical event names are stable and unique per key", () => {
  const values = Object.values(SWEETSOCKET_EVENT);
  assert.ok(values.length > 30, "event map should cover the full domain");
  // Each event must have metadata.
  for (const name of values) {
    assert.ok(SWEETSOCKET_EVENT_META[name], `missing meta for ${name}`);
    assert.ok(SWEETSOCKET_EVENT_META[name].durable !== undefined, `missing durability for ${name}`);
    assert.ok(SWEETSOCKET_EVENT_META[name].auth, `missing auth for ${name}`);
  }
});

test("message events map to canonical names", () => {
  assert.equal(canonicalEventType("message.new"), "messages:upsert");
  assert.equal(canonicalEventType("message.created"), "messages:upsert");
  assert.equal(canonicalEventType("chat.message.created"), "messages:upsert");
  assert.equal(canonicalEventType("message.updated"), "messages:update");
  assert.equal(canonicalEventType("chat.message.deleted"), "messages:delete");
  assert.equal(canonicalEventType("chat.reaction.updated"), "messages:reaction");
  assert.equal(canonicalEventType("reaction:updated"), "messages:reaction");
  assert.equal(canonicalEventType("message.ack"), "message:receipt");
  assert.equal(canonicalEventType("message.acknowledged"), "message:receipt");
});

test("social/wallet/notification events map to canonical names", () => {
  assert.equal(canonicalEventType("post.comment.created"), "comment:created");
  assert.equal(canonicalEventType("notification.created"), "notification:new");
  assert.equal(canonicalEventType("notification.new"), "notification:new");
  assert.equal(canonicalEventType("wallet.updated"), "wallet:updated");
  assert.equal(canonicalEventType("subscription.count_updated"), "subscription:updated");
  assert.equal(canonicalEventType("purchase.completed"), "album:purchased");
});

test("canonical names are recognized; legacy names are not canonical wire names", () => {
  assert.ok(isCanonicalEvent("messages:upsert"));
  assert.ok(isCanonicalEvent("chats:upsert"));
  assert.ok(isCanonicalEvent("typing:start"));
  assert.ok(isCanonicalEvent("notification:new"));
  assert.ok(!isCanonicalEvent("message.new"));
});

test("durable vs ephemeral classification", () => {
  // Durable: messages, chat-list, notifications (reconnect replay).
  assert.equal(SWEETSOCKET_EVENT_META["messages:upsert"].durable, true);
  assert.equal(SWEETSOCKET_EVENT_META["messages:delete"].durable, true);
  assert.equal(SWEETSOCKET_EVENT_META["chats:upsert"].durable, true);
  assert.equal(SWEETSOCKET_EVENT_META["chat:clear"].durable, true);
  assert.equal(SWEETSOCKET_EVENT_META["notification:new"].durable, true);
  // Ephemeral: typing, presence, read receipts, history (never persisted).
  assert.equal(SWEETSOCKET_EVENT_META["typing:start"].durable, false);
  assert.equal(SWEETSOCKET_EVENT_META["presence:updated"].durable, false);
  assert.equal(SWEETSOCKET_EVENT_META["message:read"].durable, false);
  assert.equal(SWEETSOCKET_EVENT_META["history:set"].durable, false);
});

test("channel derivation for chat-list fanout targets the user channel", () => {
  const meta = SWEETSOCKET_EVENT_META["chats:upsert"];
  const channel = meta.channel({ userId: "user_1" });
  assert.equal(channel, "user:user_1");
  assert.equal(meta.auth, "self");
});

test("structured error codes are namespaced", () => {
  assert.equal(SWEETSOCKET_ERROR.auth, "error:auth");
  assert.equal(SWEETSOCKET_ERROR.permission, "error:permission");
  assert.equal(SWEETSOCKET_ERROR.validation, "error:validation");
  assert.equal(SWEETSOCKET_ERROR.rateLimit, "error:rate-limit");
  assert.equal(SWEETSOCKET_ERROR.server, "error:server");
});

test("SWEETSOCKET_EVENT legacy aliases resolve to canonical values", () => {
  assert.equal(SWEETSOCKET_EVENT.messageCreated, "messages:upsert");
  assert.equal(SWEETSOCKET_EVENT.messageUpdated, "messages:update");
  assert.equal(SWEETSOCKET_EVENT.messageDeleted, "messages:delete");
  assert.equal(SWEETSOCKET_EVENT.messageAck, "message:receipt");
  assert.equal(SWEETSOCKET_EVENT.reactionUpdated, "messages:reaction");
});
