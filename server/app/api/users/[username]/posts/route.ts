import { NextRequest } from "next/server";
import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, users, profiles, media } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { parseQuery } from "@/lib/api/validate";
import { ok, notFound } from "@/lib/api/response";
import { signPostRows } from "@/lib/api/media";
import { z } from "zod";

const schema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(30).default(20),
  status: z.enum(["published", "archived"]).default("published"),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const auth = await optionalAuth(req);

  const parsed = parseQuery(req.nextUrl.searchParams, schema);
  if (!parsed.success) return parsed.response;
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const status = parsed.data.status ?? "published";
  const offset = (page - 1) * limit;

  const [creator] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), eq(users.is_active, true)))
    .limit(1);

  if (!creator) return notFound("User not found");

  // Own posts include drafts; public only sees published
  const isOwner = auth?.userId === creator.id;
  const statusFilter = (isOwner ? status : "published") as "draft" | "published" | "archived" | "deleted";

  const rows = await db
    .select({
      id: posts.id,
      caption: posts.caption,
      visibility: posts.visibility,
      status: posts.status,
      is_pinned: posts.is_pinned,
      unlock_price: posts.unlock_price,
      view_count: posts.view_count,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      save_count: posts.save_count,
      published_at: posts.published_at,
      created_at: posts.created_at,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: profiles.is_verified_creator,
    })
    .from(posts)
    .leftJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(
      and(
        eq(posts.creator_id, creator.id),
        eq(posts.status, statusFilter),
        isNull(posts.deleted_at)
      )
    )
    .orderBy(desc(posts.is_pinned), desc(posts.published_at))
    .limit(limit as number)
    .offset(offset);

  const signed = await signPostRows(rows);
  return ok({ posts: signed, page, limit });
}
