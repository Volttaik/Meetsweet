import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationDataBlock } from "../lib/services/push";

test("post notification routes to the post screen (content_type + post_id)", () => {
  const block = notificationDataBlock({
    entity_type: "post",
    entity_id: "post_123",
    actor_id: "usr_9",
    actor_name: "Amara",
    actor_username: "amara",
  });
  assert.equal(block.content_type, "post");
  assert.equal(block.entity_type, "post");
  assert.equal(block.entity_id, "post_123");
  assert.equal(block.post_id, "post_123");
  assert.equal(block.private_message_id, null);
  assert.equal(block.actor_id, "usr_9");
  assert.equal(block.actor_name, "Amara");
  assert.equal(block.actor_username, "amara");
});

test("video / short / album notifications carry their own content aliases", () => {
  const video = notificationDataBlock({ entity_type: "video", entity_id: "vid_1" });
  assert.equal(video.content_type, "video");
  assert.equal(video.video_id, "vid_1");
  assert.equal(video.post_id, null);

  const short = notificationDataBlock({ entity_type: "short", entity_id: "sh_2" });
  assert.equal(short.content_type, "short");
  assert.equal(short.short_id, "sh_2");

  const album = notificationDataBlock({ entity_type: "album", entity_id: "alb_3" });
  assert.equal(album.content_type, "album");
  assert.equal(album.album_id, "alb_3");
});

test("comment notifications route to the parent post screen", () => {
  const block = notificationDataBlock({ entity_type: "comment", entity_id: "c_5" });
  assert.equal(block.content_type, "post");
  assert.equal(block.comment_id, "c_5");
  assert.equal(block.post_id, null);
});

test("private-message notifications route to the message thread", () => {
  const block = notificationDataBlock({ entity_type: "private_message", entity_id: "pm_7" });
  assert.equal(block.content_type, null);
  assert.equal(block.private_message_id, "pm_7");
  assert.equal(block.entity_id, "pm_7");
});

test("wallet/other notifications have no content target (null content_type)", () => {
  const block = notificationDataBlock({ entity_type: "wallet", entity_id: "txn_8" });
  assert.equal(block.content_type, null);
  assert.equal(block.post_id, null);
  assert.equal(block.private_message_id, null);
});

test("missing/null fields degrade to nulls (never undefined)", () => {
  const block = notificationDataBlock({});
  assert.equal(block.content_type, null);
  assert.equal(block.entity_type, null);
  assert.equal(block.entity_id, null);
  assert.equal(block.actor_id, null);
  assert.equal(block.actor_name, null);
  assert.equal(block.actor_username, null);
  assert.equal(block.actor_avatar, null);
});
