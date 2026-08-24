import { test } from "node:test";
import assert from "node:assert/strict";
import { deterministicDmRoomId } from "../lib/services/chat-rooms";

/**
 * The deterministic DM room id is a pure function of the two user ids. The
 * mobile client derives the SAME id locally (deriveRoomId in
 * services/room-service.ts, via expo-crypto sha256 hex of the sorted ":"-joined
 * pair sliced to 32 chars) so opening a chat needs zero network round-trips.
 * These tests hardcode the expected hash so any drift on either side fails
 * loudly instead of silently splitting a conversation.
 */
test("deterministicDmRoomId is stable and matches the mobile contract", () => {
  assert.equal(deterministicDmRoomId("user_a", "user_b"), "dm_81bc0e276744111cde00cc913ec44ad3");
  assert.equal(deterministicDmRoomId("user_a", "user_c"), "dm_1b878efa9b1667703a8bb710d1335007");
});

test("deterministicDmRoomId is order-independent (A+B == B+A)", () => {
  assert.equal(deterministicDmRoomId("user_a", "user_b"), deterministicDmRoomId("user_b", "user_a"));
});

test("deterministicDmRoomId is prefixed and 35 chars", () => {
  const id = deterministicDmRoomId("user_a", "user_b");
  assert.match(id, /^dm_[0-9a-f]{32}$/);
  assert.equal(id.length, 35);
});

test("deterministicDmRoomId differs across pairs", () => {
  assert.notEqual(
    deterministicDmRoomId("user_a", "user_b"),
    deterministicDmRoomId("user_a", "user_c"),
  );
});
