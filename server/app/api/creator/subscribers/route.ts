import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50), 200);
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      created_at: subscriptions.created_at,
      subscriber_id: users.id,
      subscriber_name: users.full_name,
      subscriber_username: users.username,
      subscriber_display_name: profiles.display_name,
      subscriber_avatar: profiles.avatar_url,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.subscriber_id))
    .leftJoin(profiles, eq(profiles.user_id, subscriptions.subscriber_id))
    .where(eq(subscriptions.creator_id, auth.user.userId))
    .orderBy(desc(subscriptions.created_at))
    .limit(limit)
    .offset(offset);

  const subscribers = rows.map((r) => ({
    id: r.subscriber_id,
    username: r.subscriber_username,
    display_name: r.subscriber_display_name ?? r.subscriber_name ?? null,
    avatar_url: r.subscriber_avatar ?? null,
    subscribed_at: r.created_at,
  }));

  return ok({ subscribers });
}
