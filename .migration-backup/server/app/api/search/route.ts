import { NextRequest } from "next/server";
import { like, eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, posts, recent_searches } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseQuery } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { z } from "zod";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(["all", "users", "creators", "posts"]).default("all"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

export async function GET(req: NextRequest) {
  const auth = await optionalAuth(req);
  const parsed = parseQuery(req.nextUrl.searchParams, schema);
  if (!parsed.success) return parsed.response;
  const q = parsed.data.q;
  const type = parsed.data.type ?? "all";
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;
  const pattern = `%${q}%`;

  const result: Record<string, unknown> = {};

  if (type === "all" || type === "users" || type === "creators") {
    const isCreatorOnly = type === "creators";
    const userRows = await db
      .select({
        id: users.id,
        username: users.username,
        full_name: users.full_name,
        is_creator: users.is_creator,
        display_name: profiles.display_name,
        avatar_url: profiles.avatar_url,
        is_verified: profiles.is_verified_creator,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.user_id, users.id))
      .where(
        and(
          like(users.username, pattern),
          isCreatorOnly ? eq(users.is_creator, true) : undefined
        )
      )
      .limit(limit)
      .offset(offset);

    result.users = userRows;
  }

  if (type === "all" || type === "posts") {
    const postRows = await db
      .select({
        id: posts.id,
        caption: posts.caption,
        view_count: posts.view_count,
        like_count: posts.like_count,
        published_at: posts.published_at,
        creator_id: posts.creator_id,
      })
      .from(posts)
      .where(
        and(
          like(posts.caption, pattern),
          eq(posts.status, "published")
        )
      )
      .orderBy(desc(posts.published_at))
      .limit(limit)
      .offset(offset);

    result.posts = postRows;
  }

  // Save recent search
  if (auth) {
    await db.insert(recent_searches).values({
      id: generateId(),
      user_id: auth.userId,
      query: q,
    });
  }

  return ok(result);
}
