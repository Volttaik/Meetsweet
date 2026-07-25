import { NextRequest } from "next/server";
import { eq, and, like, or, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { resolveUrl } from "@/lib/services/r2";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.length < 2) return err("Query must be at least 2 characters", 400);

  const pattern = `%${q}%`;

  const rows = await db
    .select({
      id: users.id,
      name: users.full_name,
      username: users.username,
      avatarUrl: profiles.avatar_url,
      isVerified: profiles.is_verified_creator,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(
      and(
        eq(users.is_active, true),
        ne(users.id, auth.user.userId),
        or(like(users.full_name, pattern), like(users.username, pattern))
      )
    )
    .limit(20);

  const signed = await Promise.all(
    rows.map(async (u) => ({ ...u, avatarUrl: await resolveUrl(u.avatarUrl) }))
  );

  return ok({ users: signed });
}
