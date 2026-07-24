import { lt, or, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { verification_codes } from "@/lib/db/schema";

export interface CleanupVerificationCodesResult {
  deleted: number;
}

/**
 * Delete verification codes that have either expired or already been used.
 */
export async function cleanupVerificationCodes(): Promise<CleanupVerificationCodesResult> {
  const now = new Date().toISOString();

  const result = await db
    .delete(verification_codes)
    .where(
      or(
        lt(verification_codes.expires_at, now),
        isNotNull(verification_codes.used_at)
      )
    )
    .returning({ id: verification_codes.id });

  return { deleted: result.length };
}
