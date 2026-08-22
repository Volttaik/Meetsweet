import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, user_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { z } from "zod";

/**
 * Named queries the mobile app may request.
 * Only these are executed — no raw SQL ever reaches this endpoint.
 */
const NAMED_QUERIES = [
  "get_profile",
  "get_settings",
  "get_account",
] as const;

type NamedQuery = (typeof NAMED_QUERIES)[number];

const schema = z.object({
  query: z.enum(NAMED_QUERIES),
});

/**
 * POST /api/credentials/database
 *
 * Turso database broker — credentials never leave this server.
 *
 * The mobile app requests a named query by name; the server runs it against
 * Turso scoped to the authenticated user and returns the result.
 * No raw SQL is accepted. Only pre-defined, read-only, user-scoped queries
 * are permitted.
 *
 * Body (JSON):
 *   query — one of: "get_profile" | "get_settings" | "get_account"
 *
 * Response:
 *   query   — the name of the query that ran
 *   data    — the query result scoped to the authenticated user
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const userId = auth.user.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("Request body must be valid JSON", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => e.message).join(", ");
    return err(`Unknown or missing query. Allowed: ${NAMED_QUERIES.join(", ")}. ${msg}`, 422);
  }

  const { query } = parsed.data;
  const data = await runQuery(query, userId);

  return ok({ query, data });
}

async function runQuery(query: NamedQuery, userId: string) {
  switch (query) {
    case "get_profile": {
      const [profile] = await db
        .select({
          display_name: profiles.display_name,
          avatar_url:   profiles.avatar_url,
          created_at:   profiles.created_at,
          updated_at:   profiles.updated_at,
        })
        .from(profiles)
        .where(eq(profiles.user_id, userId))
        .limit(1);
      return profile ?? null;
    }

    case "get_settings": {
      const [settings] = await db
        .select({ updated_at: user_settings.updated_at })
        .from(user_settings)
        .where(eq(user_settings.user_id, userId))
        .limit(1);
      return settings ?? null;
    }

    case "get_account": {
      const [user] = await db
        .select({
          id:         users.id,
          full_name:  users.full_name,
          username:   users.username,
          email:      users.email,
          phone:      users.phone,
          role:       users.role,
          is_creator: users.is_creator,
          created_at: users.created_at,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return user ?? null;
    }
  }
}
