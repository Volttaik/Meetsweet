import { test } from "node:test";
import assert from "node:assert/strict";
import { toThreadMessageView, type PrivateMessageView } from "../lib/services/private-inbox";

/**
 * Regression test for the production "Converting circular structure to JSON"
 * crash on GET /api/private-messages/[id].
 *
 * The old builder set `rootView.thread = [rootView, ...descendantViews]` — the
 * same object that is returned as the top-level `message`, so index 0 of the
 * thread array pointed back at the message itself. JSON serialization walked
 * message → thread[0] → message → thread[0] → … forever.
 *
 * This test first proves that shape DOES throw (so the bug is real), then
 * proves that the new DTO produced by `toThreadMessageView` encodes the same
 * logical thread as an acyclic structure that stringifies cleanly.
 */

const later = new Date(Date.UTC(2026, 0, 2)).toISOString();
const earlier = new Date(Date.UTC(2026, 0, 1)).toISOString();

function messageView(part: Partial<PrivateMessageView> & Pick<PrivateMessageView, "id">): PrivateMessageView {
  return {
    sender_id: "sender",
    recipient_id: "recipient",
    parent_message_id: null,
    body: "hello",
    status: "replied",
    price_paid: 200,
    created_at: earlier,
    read_at: later,
    replied_at: null,
    sender_name: "Sender",
    sender_username: "sender",
    sender_avatar: null,
    recipient_name: "Recipient",
    recipient_username: "recipient",
    recipient_avatar: null,
    attachments: [],
    reply_count: 0,
    reply: null,
    ...part,
  };
}

test("reproduces the production bug: a thread[0] pointing at the root message throws on JSON.stringify", () => {
  const root = messageView({ id: "root" });
  const reply = messageView({ id: "reply-1", parent_message_id: "root", body: "a reply" });
  // This is exactly what `buildViews` used to produce for the detail route:
  root.thread = [root, reply]; // index 0 is the SAME object as the returned message
  let threw = false;
  try {
    JSON.stringify(root);
  } catch (e) {
    threw = true;
    assert.match(
      (e as Error).message,
      /circular/i,
      "this is the exact production error (Converting circular structure to JSON)",
    );
  }
  assert.equal(threw, true, "the old shape must reproduce the production circular-structure crash");
});

test("new DTO: the detail response is acyclic and stringifies cleanly with the full thread preserved", () => {
  const root = messageView({ id: "root" });
  const reply1 = messageView({ id: "reply-1", parent_message_id: "root", body: "a reply" });
  const reply2 = messageView({ id: "reply-2", parent_message_id: "reply-1", body: "a nested reply" });
  root.reply_count = 2;
  root.reply = reply2;
  root.thread = [root, reply1, reply2]; // simulate the builder's populated shape

  const dto = toThreadMessageView(root);

  // It must not throw.
  let json = "";
  assert.doesNotThrow(() => {
    json = JSON.stringify(dto);
  });
  assert.ok(json.length > 0, "response serializes to non-empty JSON");

  // Index 0 of the thread must NOT be the same object as the top-level message
  // (that was the cycle). It should be an independent copy with the same id.
  assert.notStrictEqual(dto.thread![0], dto, "thread[0] must not be the root message object");
  assert.equal(dto.thread![0].id, "root", "thread[0] is still the original message, oldest first");

  // Reply linkage is by id only — never a nested parent object.
  const byId = new Map(dto.thread!.map((m) => [m.id, m]));
  assert.equal(byId.get("root")!.parent_message_id, null);
  assert.equal(byId.get("reply-1")!.parent_message_id, "root");
  assert.equal(byId.get("reply-2")!.parent_message_id, "reply-1");

  // Every thread element is an independent snapshot with NO embedded thread and
  // no reply preview attached (nothing left to recurse into).
  for (const m of dto.thread!) {
    assert.equal(m.thread, undefined, "thread elements must not embed a thread array");
    assert.equal(m.reply, null, "thread elements must not embed a reply preview");
    // There is no cycle: walking each element's own fields cannot loop back.
    assert.deepEqual(m.attachments, []);
  }
  assert.equal(dto.id, "root");
  assert.equal(dto.body, "hello");
});

test("new DTO for a message with NO replies stays acyclic (single-element thread)", () => {
  const solo = messageView({ id: "solo", status: "sent" });
  const dto = toThreadMessageView(solo);
  assert.doesNotThrow(() => JSON.stringify(dto));
  assert.equal(dto.thread!.length, 1);
  assert.equal(dto.thread![0].id, "solo");
  assert.equal(dto.thread![0].parent_message_id, null);
});

test("new DTO preserves attachments and metadata for media / paid media", () => {
  const freeMedia = {
    id: "att-free",
    media_id: "med-1",
    media_type: "image" as const,
    media_url: "https://cdn/r1.jpg",
    thumbnail_url: "https://cdn/r1_t.jpg",
    price: 0,
    is_locked: false,
    purchased_by_me: false,
  };
  const paidLocked = {
    id: "att-paid",
    media_id: "med-2",
    media_type: "video" as const,
    media_url: null,
    thumbnail_url: null,
    price: 500,
    is_locked: true,
    purchased_by_me: false,
  };
  const root = messageView({
    id: "root",
    attachments: [freeMedia, paidLocked],
  });
  const dto = toThreadMessageView(root);
  const serialized = JSON.parse(JSON.stringify(dto));
  assert.deepEqual(serialized.attachments, [
    freeMedia,
    paidLocked,
  ]);
  assert.equal(serialized.thread[0].attachments.length, 2);
});