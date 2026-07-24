import { randomInt } from "crypto";

export function generateVerificationCode(): string {
  return String(randomInt(100000, 999999));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function expiresAt(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}
