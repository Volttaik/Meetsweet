import { test } from "node:test";
import assert from "node:assert/strict";
import { logoAttachment, crystalHeader } from "../lib/services/email";
import { MEETSWEET_EMAIL_LOGO_B64 } from "../lib/services/email-logo";

const PNG_MAGIC = "89504e470d0a1a0a";

test("logo attachment is a small inline PNG with the correct content id", () => {
  const att = logoAttachment();

  // The HTML references the image as cid:meetsweet-logo; the attachment must
  // carry the SAME content id so the inline image resolves.
  assert.equal(att.inlineContentId, "meetsweet-logo");
  assert.equal(att.filename, "meetsweet-logo.png");
  assert.equal(att.contentType, "image/png");

  // content is base64 — decode and confirm it is a real PNG.
  const buf = Buffer.from(att.content, "base64");
  assert.equal(buf.subarray(0, 8).toString("hex"), PNG_MAGIC, "attachment content must decode to a PNG");
  assert.ok(buf.length > 500, "logo PNG should not be empty");
  assert.ok(buf.length < 30 * 1024, "logo should stay small for email (inline images inflate size)");
});

test("embedded logo base64 matches the attachment content", () => {
  assert.equal(logoAttachment().content, MEETSWEET_EMAIL_LOGO_B64);
  const buf = Buffer.from(MEETSWEET_EMAIL_LOGO_B64, "base64");
  assert.equal(buf.subarray(0, 8).toString("hex"), PNG_MAGIC);
});

test("email header renders the logo via cid with explicit dimensions and alt text", () => {
  const html = crystalHeader("Account verification");

  assert.ok(html.includes('src="cid:meetsweet-logo"'), "HTML must reference cid:meetsweet-logo");
  assert.ok(html.includes('alt="MeetSweet"'), "logo must have alt text");
  assert.ok(html.includes('width="72"') && html.includes('height="72"'), "logo must have explicit dimensions");
  assert.ok(html.includes("Meet<span"), "wordmark must remain as text (readable with images blocked)");
});

test("no hosted or local filesystem image URLs in the header", () => {
  const html = crystalHeader("Account verification");
  assert.ok(!html.includes('src="/'), "must not use a server-relative image path");
  assert.ok(!html.includes("file://"), "must not use a filesystem path");
  assert.ok(!html.includes('src="http'), "must not hotlink a remote image");
  assert.ok(!html.includes("url('http"), "must not hotlink a remote background");
});
