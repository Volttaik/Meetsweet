import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProvisionalChatMessage } from "../lib/services/sweet-socket-chat";

test("provisional voice-note message carries the full audio metadata", () => {
  const msg = buildProvisionalChatMessage({
    clientMessageId: "msg_temp_1",
    roomId: "room_1",
    userId: "user_1",
    payload: {
      body: null,
      mediaUrl: "https://cdn.example/voice.m4a",
      mediaType: "audio",
      audioDuration: 12,
      isVoiceNote: true,
      fileType: "m4a",
      mimeType: "audio/m4a",
    },
    createdAt: "2026-08-23T00:00:00.000Z",
  });

  // The recipient renders the provisional bubble immediately — it must already
  // know this is a voice note, not a file card (regression: missing metadata
  // made voice notes flash as file bubbles until the persisted event arrived).
  assert.equal(msg.id, "msg_temp_1");
  assert.equal(msg.chatRoomId, "room_1");
  assert.equal(msg.mediaType, "audio");
  assert.equal(msg.isVoiceNote, true);
  assert.equal(msg.audioDuration, 12);
  assert.equal(msg.fileType, "m4a");
  assert.equal(msg.mimeType, "audio/m4a");
  assert.equal(msg.mediaUrl, "https://cdn.example/voice.m4a");
  assert.equal(msg.pending, true);
  assert.equal((msg.sender as { id?: string })?.id, "user_1");
});

test("provisional image message carries media metadata", () => {
  const msg = buildProvisionalChatMessage({
    clientMessageId: "msg_temp_2",
    roomId: "room_1",
    userId: "user_1",
    payload: {
      body: null,
      mediaUrl: "https://cdn.example/photo.jpg",
      mediaType: "image",
      fileName: "photo.jpg",
      fileSize: 204800,
      mimeType: "image/jpeg",
      fileType: "jpg",
      caption: "look at this",
    },
  });

  assert.equal(msg.mediaType, "image");
  assert.equal(msg.fileName, "photo.jpg");
  assert.equal(msg.fileSize, 204800);
  assert.equal(msg.mimeType, "image/jpeg");
  assert.equal(msg.fileType, "jpg");
  assert.equal(msg.caption, "look at this");
  assert.equal(msg.isVoiceNote, null);
});

test("provisional document message carries file metadata", () => {
  const msg = buildProvisionalChatMessage({
    clientMessageId: "msg_temp_3",
    roomId: "room_1",
    userId: "user_1",
    payload: {
      body: null,
      mediaUrl: "https://cdn.example/doc.pdf",
      mediaType: "document",
      fileName: "contract.pdf",
      fileSize: 1048576,
      mimeType: "application/pdf",
      fileType: "pdf",
    },
  });

  assert.equal(msg.mediaType, "document");
  assert.equal(msg.fileName, "contract.pdf");
  assert.equal(msg.fileSize, 1048576);
  assert.equal(msg.mimeType, "application/pdf");
  assert.equal(msg.fileType, "pdf");
});

test("provisional text message is media-free but carries reply context", () => {
  const msg = buildProvisionalChatMessage({
    clientMessageId: "msg_temp_4",
    roomId: "room_1",
    userId: "user_1",
    payload: { body: "hello", replyToId: "msg_prev" },
  });

  assert.equal(msg.body, "hello");
  assert.equal(msg.mediaUrl, null);
  assert.equal(msg.mediaType, null);
  assert.equal(msg.replyToId, "msg_prev");
});

test("provisional link message carries the link preview payload", () => {
  const msg = buildProvisionalChatMessage({
    clientMessageId: "msg_temp_5",
    roomId: "room_1",
    userId: "user_1",
    payload: {
      body: "check this https://example.com/article",
      linkPreview: {
        url: "https://example.com/article",
        kind: "external",
        domain: "example.com",
        title: "Example Article",
        description: "A great read",
        imageUrl: "https://example.com/cover.jpg",
      },
    },
  });

  assert.equal(msg.body, "check this https://example.com/article");
  assert.deepEqual(msg.linkPreview, {
    url: "https://example.com/article",
    kind: "external",
    domain: "example.com",
    title: "Example Article",
    description: "A great read",
    imageUrl: "https://example.com/cover.jpg",
  });
});

test("provisional message without a URL carries null link preview", () => {
  const msg = buildProvisionalChatMessage({
    clientMessageId: "msg_temp_6",
    roomId: "room_1",
    userId: "user_1",
    payload: { body: "just text", replyToId: null },
  });

  assert.equal(msg.linkPreview, null);
});

test("findFirstUrl extracts a URL but ignores trailing punctuation", () => {
  const { findFirstUrl } = require("../lib/services/link-preview");
  assert.equal(findFirstUrl("check https://example.com/article, thanks"), "https://example.com/article");
  assert.equal(findFirstUrl("no url here"), null);
  assert.equal(findFirstUrl(null), null);
});
