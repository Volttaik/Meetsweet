import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseQuery } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { resolveUrl } from "@/lib/services/r2";
import { z } from "zod";

const schema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["active", "cancelled", "expired"]).default("active"),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  if (auth.user.role === "user") return err("Creator access required", 403);

  const parsed = parseQuery(req.nextUrl.searchParams, schema);
  if (!parsed.success) return parsed.response;
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const status = parsed.data.status ?? "active";
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      amount: subscriptions.amount,
      started_at: subscriptions.started_at,
      expires_at: subscriptions.expires_at,
      created_at: subscriptions.created_at,
      subscriber_id: subscriptions.subscriber_id,
      subscriber_username: users.username,
      subscriber_display_name: profiles.display_name,
      subscriber_avatar: profiles.avatar_url,
    })
    .from(subscriptions)
    .leftJoin(users, eq(users.id, subscriptions.subscriber_id))
    .leftJoin(profiles, eq(profiles.user_id, subscriptions.subscriber_id))
    .where(
      and(
        eq(subscriptions.creator_id, auth.user.userId),
        eq(subscriptions.status, status as "active" | "cancelled" | "expired")
      )
    )
    .orderBy(desc(subscriptions.created_at))
    .limit(limit as number)
    .offset(offset);

  const signed = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      subscriber_avatar: await resolveUrl(r.subscriber_avatar),
    }))
  );

  return ok({ subscribers: signed, page, limit });
}
