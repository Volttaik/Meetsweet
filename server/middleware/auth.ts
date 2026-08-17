import { NextRequest } from "next/server";
import { verifyToken, type TokenPayload } from "@/lib/auth/jwt";
import { unauthorized } from "@/lib/api/response";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export type AuthedRequest = NextRequest & { user: TokenPayload };

/**
 * Re-check the user's live account state AND current role. The JWT itself can
 * outlive a deletion/deactivation by up to its expiry window, and the role
 * claim goes stale when a user becomes a creator (or is demoted) after login.
 * Every authed request therefore re-reads the account from the DB and uses the
 * LIVE role — creator-only endpoints (album creation, uploads) gate on the
 * database role, not the token claim. This is what makes a deleted account's
 * data immediately inaccessible and a new creator role immediately effective.
 */
async function fetchLiveAccount(userId: string): Promise<{
  isActive: boolean;
  role: string | null;
} | null> {
  try {
    const [row] = await db
      .select({ is_active: users.is_active, deleted_at: users.deleted_at, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return null;
    const live =
      row.is_active === true && row.deleted_at === null;
    return { isActive: live, role: live ? row.role : null };
  } catch {
    // On DB errors, fail closed — never let an unverifiable account through.
    return null;
  }
}

export async function requireAuth(
  req: NextRequest
): Promise<{ user: TokenPayload } | { response: NextResponse }> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { response: unauthorized("Missing authorization header") };
  }

  const token = header.slice(7);
  try {
    const tokenUser = await verifyToken(token);
    const live = await fetchLiveAccount(tokenUser.userId);
    if (!live || !live.isActive || !live.role) {
      return { response: unauthorized("Account no longer active") };
    }
    // Authoritative role comes from the DB, never the (possibly stale) JWT claim.
    return { user: { ...tokenUser, role: live.role } };
  } catch {
    return { response: unauthorized("Invalid or expired token") };
  }
}

export async function optionalAuth(
  req: NextRequest
): Promise<TokenPayload | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const tokenUser = await verifyToken(header.slice(7));
    const live = await fetchLiveAccount(tokenUser.userId);
    if (!live || !live.isActive || !live.role) return null;
    return { ...tokenUser, role: live.role };
  } catch {
    return null;
  }
}
