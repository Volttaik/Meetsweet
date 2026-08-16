import { NextRequest } from "next/server";
import { verifyToken, type TokenPayload } from "@/lib/auth/jwt";
import { unauthorized } from "@/lib/api/response";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export type AuthedRequest = NextRequest & { user: TokenPayload };

/**
 * Re-check the user's live account state. The JWT itself can outlive a
 * deletion/deactivation by up to its expiry window, so every authed request
 * verifies the account is still active and not soft-deleted. This is what
 * makes a deleted account's data immediately inaccessible — the token stops
 * working the moment the account is deleted.
 */
async function isAccountLive(userId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ is_active: users.is_active, deleted_at: users.deleted_at })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return false;
    return row.is_active === true && row.deleted_at === null;
  } catch {
    // On DB errors, fail closed — never let an unverifiable account through.
    return false;
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
    const user = await verifyToken(token);
    if (!(await isAccountLive(user.userId))) {
      return { response: unauthorized("Account no longer active") };
    }
    return { user };
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
    const user = await verifyToken(header.slice(7));
    if (!(await isAccountLive(user.userId))) return null;
    return user;
  } catch {
    return null;
  }
}
