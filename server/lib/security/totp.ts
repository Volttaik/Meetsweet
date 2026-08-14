/**
 * TOTP (RFC 6238) helpers + at-rest encryption for 2FA secrets.
 *
 * Secrets are base32-encoded per the otpauth standard and, before being stored
 * in the database, encrypted with AES-256-GCM using a key derived from the
 * existing JWT secret. Secrets are never returned in any API response after the
 * one-time setup call (which returns the plaintext secret so the user can add
 * it to their authenticator app).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { config } from "@/lib/config";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a fresh base32 TOTP secret (default 20 bytes → 32 base32 chars). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Build the otpauth:// URI the user scans with their authenticator app. */
export function totpUri(secret: string, account: string, issuer = "MeetSweet"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(
    issuer,
  )}&algorithm=SHA1&digits=6&period=30`;
}

/** Generate a 6-digit TOTP code for a secret at a given timestamp. */
export function generateTotpCode(
  secret: string,
  timestamp = Date.now(),
  digits = 6,
  period = 30,
): string {
  const counter = Math.floor(timestamp / 1000 / period);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Verify a 6-digit code against a secret, allowing ±window time steps. */
export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  const normalized = String(code ?? "").trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const expected = Buffer.from(normalized);
  const nowSec = Math.floor(Date.now() / 1000);
  for (let i = -window; i <= window; i++) {
    const candidate = generateTotpCode(secret, (nowSec + i * 30) * 1000);
    if (
      candidate.length === expected.length &&
      timingSafeEqual(Buffer.from(candidate), expected)
    ) {
      return true;
    }
  }
  return false;
}

// ─── At-rest encryption ────────────────────────────────────────────────────────

function encryptionKey(): Buffer {
  const secret = config.auth.jwtSecret();
  if (!secret) throw new Error("JWT_SECRET is required to encrypt 2FA secrets");
  return createHash("sha256").update(`meetsweet:2fa:${secret}`).digest();
}

/** Encrypt a TOTP secret for storage. Returns a JSON string {v, iv, tag, data}. */
export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

/** Decrypt a stored TOTP secret. Returns null on any failure. */
export function decryptTotpSecret(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { iv: string; tag: string; data: string };
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(parsed.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
