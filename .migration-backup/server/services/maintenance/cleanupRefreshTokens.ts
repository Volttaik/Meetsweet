import { lt, or, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { refresh_tokens } from "@/lib/db/schema";

export interface CleanupRefreshTokensResult {
  deleted: number;
}

/**
 * Delete refresh tokens that have either expired or been revoked.
 */
export async function cleanupRefreshTokens(): Promise<CleanupRefreshTokensResult> {
  const now = new Date().toISOString();

  const result = await db
    .delete(refresh_tokens)
    .where(
      or(
        lt(refresh_tokens.expires_at, now),
        isNotNull(refresh_tokens.revoked_at)
      )
    )
    .returning({ id: refresh_tokens.id });

  return { deleted: result.length };
}
