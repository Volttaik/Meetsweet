import { NextRequest } from "next/server";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, posts } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);
  const offset = (page - 1) * limit;

  // Return public posts for the explore feed
  const postRows = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: users.is_verified,
      caption: posts.caption,
      visibility: posts.visibility,
      unlock_price: posts.unlock_price,
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
      ),
    )
    .orderBy(desc(posts.published_at))
    .limit(limit)
    .offset(offset);

  // Return featured creators (is_creator=true)
  const creatorRows = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      avatar_url: profiles.avatar_url,
      bio: profiles.bio,
      is_verified: users.is_verified,
      is_creator: users.is_creator,
      is_verified_creator: profiles.is_verified_creator,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.is_creator, true))
    .limit(limit)
    .offset(offset);

  return ok({
    posts: postRows,
    users: creatorRows.map((u) => ({
      id: u.id,
      name: u.full_name,
      full_name: u.full_name,
      username: u.username,
      avatar_url: u.avatar_url,
      avatarUrl: u.avatar_url,
      bio: u.bio,
      is_verified: u.is_verified,
      isVerified: u.is_verified,
      is_creator: u.is_creator,
      is_verified_creator: u.is_verified_creator,
    })),
  });
}
