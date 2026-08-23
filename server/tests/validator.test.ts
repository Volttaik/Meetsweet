import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrame, validRelayType } from "../lib/realtime/sweet-socket/validator";

test("valid subscribe frame parses with channel list", () => {
  const msg = parseFrame(JSON.stringify({ type: "subscribe", channels: ["chat:room_1", "user:u1"] }));
  assert.deepEqual(msg, { type: "subscribe", channels: ["chat:room_1", "user:u1"] });
});

test("subscribe rejects non-string channels and oversized lists", () => {
  assert.equal(parseFrame(JSON.stringify({ type: "subscribe", channels: ["ok", 42] })), null);
  const many = { type: "subscribe", channels: Array.from({ length: 101 }, (_, i) => `c${i}`) };
  assert.equal(parseFrame(JSON.stringify(many)), null);
});

test("ping and sync frames parse", () => {
  assert.deepEqual(parseFrame(JSON.stringify({ type: "ping" })), { type: "ping" });
  assert.deepEqual(parseFrame(JSON.stringify({ type: "sync", since: 42 })), { type: "sync", since: 42 });
  assert.deepEqual(parseFrame(JSON.stringify({ type: "sync" })), { type: "sync", since: null });
});

test("command frame parses with requestId and payload", () => {
  const msg = parseFrame(JSON.stringify({
    type: "command",
    requestId: "r1",
    command: "chat.history",
    channel: "chat:room_1",
    payload: { before: "2026-01-01T00:00:00.000Z", limit: 30 },
  }));
  assert.ok(msg && msg.type === "command");
  assert.equal(msg.command, "chat.history");
  assert.equal(msg.channel, "chat:room_1");
  assert.deepEqual(msg.payload, { before: "2026-01-01T00:00:00.000Z", limit: 30 });
});

test("command frame rejects invalid command names and oversized frames", () => {
  assert.equal(parseFrame(JSON.stringify({ type: "command", requestId: "r", command: "Bad Name" })), null);
  assert.equal(parseFrame(JSON.stringify({ type: "command", requestId: "r", command: "" })), null);
  const big = { type: "command", requestId: "r", command: "x", payload: { pad: "a".repeat(70 * 1024) } };
  assert.equal(parseFrame(JSON.stringify(big)), null);
});

test("relay frame validates structure (type gate is the router's validRelayType)", () => {
  const msg = parseFrame(JSON.stringify({
    type: "relay",
    channel: "chat:room_1",
    eventType: "typing:start",
    payload: { userId: "u1" },
  }));
  assert.ok(msg && msg.type === "relay");
  assert.equal(msg.eventType, "typing:start");
  // Structural parse accepts any well-formed eventType name; the router then
  // rejects non-ephemeral types via validRelayType (asserted separately).
  const other = parseFrame(JSON.stringify({ type: "relay", channel: "chat:room_1", eventType: "message.send" }));
  assert.ok(other && other.type === "relay");
  assert.ok(!validRelayType("message.send"));
});

test("garbage and malformed frames are rejected", () => {
  assert.equal(parseFrame("not json"), null);
  assert.equal(parseFrame(JSON.stringify({})), null);
  assert.equal(parseFrame(JSON.stringify({ type: 42 })), null);
});

test("relay types: canonical + legacy ephemeral events allowed, mutations rejected", () => {
  for (const t of ["typing:start", "typing:stop", "voice:start", "voice:stop", "presence:updated", "chat:open", "chat:close", "chat.typing.started", "chat.presence.updated"]) {
    assert.ok(validRelayType(t), `expected ${t} to be a valid relay`);
  }
  for (const t of ["message.send", "messages:upsert", "chat.history", "notification:new", "typing:boom"]) {
    assert.ok(!validRelayType(t), `expected ${t} to be rejected`);
  }
});
