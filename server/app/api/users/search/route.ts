import { NextRequest } from "next/server";
import { eq, like, or, and, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, recent_searches } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return err("Query must be at least 2 characters", 400);

  const pattern = `%${q}%`;

  const results = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      display_name: profiles.display_name,
      avatar_url: profiles.avatar_url,
      is_verified: users.is_verified,
      is_creator: users.is_creator,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(
      and(
        ne(users.id, auth.user.userId),
        eq(users.is_active, true),
        or(
          like(users.username, pattern),
          like(users.full_name, pattern),
          like(profiles.display_name, pattern),
        ),
      ),
    )
    .limit(20);

  // Save to recent searches (fire-and-forget, don't block response)
  db.insert(recent_searches).values({
    id: generateId(),
    user_id: auth.user.userId,
    query: q,
  }).catch(() => {});

  return ok({
    users: results.map((u) => ({
      id: u.id,
      // Prefer display_name over full_name so the search list matches chat list
      name: u.display_name ?? u.full_name,
      display_name: u.display_name ?? u.full_name,
      displayName: u.display_name ?? u.full_name,
      username: u.username,
      avatarUrl: u.avatar_url,
      avatar_url: u.avatar_url,
      isVerified: u.is_verified,
      is_verified: u.is_verified,
      isCreator: u.is_creator,
      is_creator: u.is_creator,
    })),
  });
}
