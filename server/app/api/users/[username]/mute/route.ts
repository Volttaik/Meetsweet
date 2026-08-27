import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, muted_users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

/**
 * POST /api/users/:username/mute — hide a creator from the viewer's feeds.
 *
 * Idempotent: inserting an existing (muter, muted) pair is a no-op. Feeds
 * exclude muted creators server-side, so the preference persists across
 * refreshes and new sessions.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { username } = await params;

  // Deleted / deactivated accounts cannot be hidden — they are not resolvable
  // by username and their content is already gone from every feed.
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), eq(users.is_active, true), isNull(users.deleted_at)))
    .limit(1);

  if (!target) return err("User not found", 404);
  if (target.id === auth.user.userId) return err("You cannot hide yourself", 400);

  const [existing] = await db
    .select({ id: muted_users.id })
    .from(muted_users)
    .where(and(eq(muted_users.muter_id, auth.user.userId), eq(muted_users.muted_id, target.id)))
    .limit(1);

  if (!existing) {
    await db.insert(muted_users).values({
      id: generateId(),
      muter_id: auth.user.userId,
      muted_id: target.id,
    });
  }

  return ok({ muted: true });
}
