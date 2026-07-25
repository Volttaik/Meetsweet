import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, notFound } from "@/lib/api/response";
import { parseBody } from "@/lib/api/validate";
import { resolveUrl } from "@/lib/services/r2";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [row] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      phone: users.phone,
      is_creator: users.is_creator,
      is_verified: users.is_verified,
      role: users.role,
      created_at: users.created_at,
      display_name: profiles.display_name,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      location: profiles.location,
      subscription_price: profiles.subscription_price,
      is_verified_creator: profiles.is_verified_creator,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!row) return notFound();

  return ok({
    ...row,
    avatar_url: await resolveUrl(row.avatar_url),
    banner_url: await resolveUrl(row.banner_url),
  });
}

const patchMeSchema = z.object({
  name: z.string().min(2).optional(),
  bio: z.string().max(160).nullable().optional(),
  website: z.string().url().nullable().optional(),
  location: z.string().max(100).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, patchMeSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const now = new Date().toISOString();

  if (body.name !== undefined) {
    await db
      .update(users)
      .set({ full_name: body.name, updated_at: now })
      .where(eq(users.id, auth.user.userId));
  }

  const profileUpdate: Record<string, unknown> = { updated_at: now };
  if (body.bio !== undefined) profileUpdate.bio = body.bio;
  if (body.website !== undefined) profileUpdate.website = body.website;
  if (body.location !== undefined) profileUpdate.location = body.location;

  await db
    .update(profiles)
    .set(profileUpdate)
    .where(eq(profiles.user_id, auth.user.userId));

  const [row] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      phone: users.phone,
      is_creator: users.is_creator,
      is_verified: users.is_verified,
      role: users.role,
      created_at: users.created_at,
      display_name: profiles.display_name,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      location: profiles.location,
      subscription_price: profiles.subscription_price,
      is_verified_creator: profiles.is_verified_creator,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!row) return notFound();
  return ok({
    user: {
      ...row,
      avatar_url: await resolveUrl(row.avatar_url),
      banner_url: await resolveUrl(row.banner_url),
    },
  });
}
