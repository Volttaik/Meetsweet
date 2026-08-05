import { NextRequest } from "next/server";
import { eq, like, or, and, ne, isNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, posts, media } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { recent_searches } from "@/lib/db/schema";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const type = req.nextUrl.searchParams.get("type") ?? "all"; // all | users | creators | posts
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);
  const offset = (page - 1) * limit;

  if (q.length < 1) return err("Query must be at least 1 character", 400);

  const currentUser = await optionalAuth(req);
  const pattern = `%${q}%`;

  let userResults: unknown[] = [];
  let postResults: unknown[] = [];

  // Search users / creators
  if (type === "all" || type === "users" || type === "creators") {
    const baseWhere = or(
      like(users.username, pattern),
      like(users.full_name, pattern),
    );

    const where = type === "creators"
      ? and(baseWhere, eq(users.is_creator, true))
      : baseWhere;

    const rows = await db
      .select({
        id: users.id,
        full_name: users.full_name,
        username: users.username,
        avatar_url: profiles.avatar_url,
        is_verified: users.is_verified,
        is_creator: users.is_creator,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.user_id, users.id))
      .where(where)
      .limit(limit)
      .offset(offset);

    userResults = rows.map((u) => ({
      id: u.id,
      name: u.full_name,
      full_name: u.full_name,
      username: u.username,
      avatar_url: u.avatar_url,
      avatarUrl: u.avatar_url,
      is_verified: u.is_verified,
      isVerified: u.is_verified,
      is_creator: u.is_creator,
    }));
  }

  // Search posts
  if (type === "all" || type === "posts") {
    const rows = await db
      .select({
        id: posts.id,
        creator_id: posts.creator_id,
        creator_username: users.username,
        creator_display_name: profiles.display_name,
        creator_avatar: profiles.avatar_url,
        creator_is_verified: users.is_verified,
        caption: posts.caption,
        visibility: posts.visibility,
        like_count: posts.like_count,
        comment_count: posts.comment_count,
        save_count: posts.save_count,
        created_at: posts.created_at,
        published_at: posts.published_at,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.creator_id))
      .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
      .where(
        and(
          isNull(posts.deleted_at),
          eq(posts.status, "published"),
          eq(posts.visibility, "public"),
          eq(posts.content_type, "post"),
          like(posts.caption, pattern),
        ),
      )
      .orderBy(desc(posts.published_at))
      .limit(limit)
      .offset(offset);

    postResults = rows;
  }

  // Save to recent searches if authenticated
  if (currentUser && q.length >= 2) {
    await db.insert(recent_searches).values({
      id: generateId(),
      user_id: currentUser.userId,
      query: q,
    }).catch(() => {}); // ignore errors
  }

  return ok({ users: userResults, posts: postResults });
}
