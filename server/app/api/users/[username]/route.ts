import { NextRequest } from "next/server";
import { eq, count, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, follows, posts } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, notFound } from "@/lib/api/response";
import { resolveUrl } from "@/lib/services/r2";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const auth = await optionalAuth(req);

  const [row] = await db
    .select({
      id: users.id,
      name: users.full_name,
      username: users.username,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      is_verified: profiles.is_verified_creator,
      is_creator: users.is_creator,
      created_at: users.created_at,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(and(eq(users.username, username), eq(users.is_active, true)))
    .limit(1);

  if (!row) return notFound("User not found");

  const [followerResult] = await db
    .select({ count: count() })
    .from(follows)
    .where(eq(follows.following_id, row.id));

  const [followingResult] = await db
    .select({ count: count() })
    .from(follows)
    .where(eq(follows.follower_id, row.id));

  const [postResult] = await db
    .select({ count: count() })
    .from(posts)
    .where(and(eq(posts.creator_id, row.id), eq(posts.status, "published")));

  let isFollowing = false;
  if (auth) {
    const [followRow] = await db
      .select({ id: follows.id })
      .from(follows)
      .where(and(eq(follows.follower_id, auth.userId), eq(follows.following_id, row.id)))
      .limit(1);
    isFollowing = !!followRow;
  }

  return ok({
    user: {
      ...row,
      avatar_url: await resolveUrl(row.avatar_url),
      banner_url: await resolveUrl(row.banner_url),
      follower_count: followerResult?.count ?? 0,
      following_count: followingResult?.count ?? 0,
      post_count: postResult?.count ?? 0,
    },
    isFollowing,
  });
}
