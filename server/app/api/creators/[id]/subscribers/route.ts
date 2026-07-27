import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, subscriptions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const condition = id.includes("-") && id.length > 20 ? eq(users.id, id) : eq(users.username, id);
  const [creator] = await db.select({ id: users.id }).from(users)
    .where(and(condition, eq(users.is_creator, true))).limit(1);
  if (!creator) return err("Creator not found", 404);

  // Only the creator themselves (or admin) can list their subscribers
  if (creator.id !== auth.user.userId && auth.user.role !== "admin") {
    return err("Forbidden", 403);
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20)), 50);

  const rows = await db
    .select({
      id: subscriptions.id,
      subscriber_id: subscriptions.subscriber_id,
      status: subscriptions.status,
      started_at: subscriptions.started_at,
      expires_at: subscriptions.expires_at,
      created_at: subscriptions.created_at,
      username: users.username,
      display_name: profiles.display_name,
      avatar_url: profiles.avatar_url,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.subscriber_id))
    .leftJoin(profiles, eq(profiles.user_id, subscriptions.subscriber_id))
    .where(and(eq(subscriptions.creator_id, creator.id), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.started_at))
    .limit(limit)
    .offset((page - 1) * limit);

  return ok({
    subscribers: rows.map((r) => ({
      id: r.id,
      user_id: r.subscriber_id,
      subscriber_id: r.subscriber_id,
      username: r.username,
      display_name: r.display_name ?? null,
      avatar_url: r.avatar_url ?? null,
      subscribed_at: r.started_at ?? r.created_at,
      expires_at: r.expires_at ?? "",
      status: r.status,
    })),
    page,
  });
}
