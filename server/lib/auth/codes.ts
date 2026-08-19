import { randomInt } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { verification_codes } from "@/lib/db/schema";

export function generateVerificationCode(): string {
  return String(randomInt(100000, 999999));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function expiresAt(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export type VerificationCodeType =
  | "email_verify"
  | "password_reset"
  | "phone_verify"
  | "two_fa";

/**
 * Issue a fresh 6-digit code for a user + purpose. Any previous unused codes
 * of the same type are invalidated so only the newest one works — the same
 * behaviour the resend route already uses for email verification.
 */
export async function issueEmailCode(
  userId: string,
  type: VerificationCodeType,
  minutes = 15,
): Promise<string> {
  const code = generateVerificationCode();
  const now = new Date().toISOString();

  await db
    .update(verification_codes)
    .set({ used_at: now })
    .where(
      and(
        eq(verification_codes.user_id, userId),
        eq(verification_codes.type, type),
        isNull(verification_codes.used_at),
      ),
    );

  await db.insert(verification_codes).values({
    id: generateId(),
    user_id: userId,
    code,
    type,
    expires_at: expiresAt(minutes),
  });

  return code;
}

/**
 * Validate an unused, unexpired code for a user + purpose and mark it used.
 * Returns true only when the code is correct, fresh, and single-use.
 */
export async function consumeEmailCode(
  userId: string,
  type: VerificationCodeType,
  code: string,
): Promise<boolean> {
  if (!code || code.length !== 6) return false;
  const now = new Date().toISOString();

  const [row] = await db
    .select({ id: verification_codes.id })
    .from(verification_codes)
    .where(
      and(
        eq(verification_codes.user_id, userId),
        eq(verification_codes.code, code),
        eq(verification_codes.type, type),
        gt(verification_codes.expires_at, now),
        isNull(verification_codes.used_at),
      ),
    )
    .limit(1);

  if (!row) return false;
  await db.update(verification_codes).set({ used_at: now }).where(eq(verification_codes.id, row.id));
  return true;
}
