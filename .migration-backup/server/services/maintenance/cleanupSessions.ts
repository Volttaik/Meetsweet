import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";

export interface CleanupSessionsResult {
  deleted: number;
}

/**
 * Delete sessions whose `expires_at` is in the past.
 */
export async function cleanupSessions(): Promise<CleanupSessionsResult> {
  const now = new Date().toISOString();

  const result = await db
    .delete(sessions)
    .where(lt(sessions.expires_at, now))
    .returning({ id: sessions.id });

  return { deleted: result.length };
}
