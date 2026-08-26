import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "zlib";
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

test("logo corners are baked to the header background (no artifacts), head is opaque RGB", () => {
  // The email logo is intentionally decoded here to guard against regression:
  // corners must be painted with the header background so the rounded squircle
  // blends onto the header in every client — no transparent/garbage corners.
  const buf = Buffer.from(MEETSWEET_EMAIL_LOGO_B64, "base64");
  // Skip 8-byte signature + IHDR (25 bytes); parse width/height/colorType.
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25];
  assert.equal(colorType, 2, "must be an opaque RGB PNG (color type 2)");
  assert.ok(width >= 140 && height >= 140, "should be a reasonably sized square logo");
  assert.equal(width, height, "logo should be square");

  // Header background is #160F1E → rgb(22,15,30).
  const headerBg = [22, 15, 30];

  // Decompress the raw scanlines (filter 0 chosen at encode time is not
  // guaranteed, so reconstruct all filters) and sample the 4 corners.
  let idx = 8;
  let idat = Buffer.alloc(0);
  while (idx < buf.length) {
    const len = buf.readUInt32BE(idx);
    const type = buf.subarray(idx + 4, idx + 8).toString();
    const data = buf.subarray(idx + 8, idx + 8 + len);
    if (type === "IDAT") idat = Buffer.concat([idat, data]);
    idx += 12 + len;
  }
  const raw = inflateSync(idat);
  const stride = width * 3;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let r = 0; r < height; r++) {
    const f = raw[r * (stride + 1)];
    const row = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      let a = row[i];
      const up = prev[i];
      const left = out[r * stride + i - 3] ?? 0;
      if (f === 1) a = (a + left) & 255;
      else if (f === 2) a = (a + up) & 255;
      else if (f === 3) a = (a + ((left + up) >> 1)) & 255;
      out[r * stride + i] = a;
    }
    prev = out.subarray(r * stride, (r + 1) * stride);
  }
  const px = (x: number, y: number) =>
    [out[(y * width + x) * 3], out[(y * width + x) * 3 + 1], out[(y * width + x) * 3 + 2]];
  const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
  for (const c of corners) {
    assert.deepEqual(c, headerBg, "logo corners must match the header background");
  }
  // Center should be a white heart pixel, not left as background.
  const center = px(Math.floor(width / 2), Math.floor(height / 2));
  assert.ok(center[0] > 245 && center[1] > 245 && center[2] > 245, "logo center should be part of the white heart");
});
