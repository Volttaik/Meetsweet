import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const patchSchema = z.object({
  full_name: z.string().min(2).max(100).optional(),
  display_name: z.string().min(1).max(100).optional(),
  bio: z.string().max(300).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  banner_url: z.string().url().nullable().optional(),
  website: z.string().url().nullable().optional(),
  location: z.string().max(100).nullable().optional(),
});

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
      role: users.role,
      is_creator: users.is_creator,
      is_verified: users.is_verified,
      created_at: users.created_at,
      display_name: profiles.display_name,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      location: profiles.location,
      is_verified_creator: profiles.is_verified_creator,
      subscription_price: profiles.subscription_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!row) return err("User not found", 404);

  return ok({ user: row });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  const { full_name, display_name, bio, avatar_url, banner_url, website, location } = parsed.data;
  const now = new Date().toISOString();

  if (full_name !== undefined) {
    await db.update(users).set({ full_name, updated_at: now }).where(eq(users.id, auth.user.userId));
  }

  const profileUpdates: Record<string, unknown> = { updated_at: now };
  if (display_name !== undefined) profileUpdates.display_name = display_name;
  if (bio !== undefined) profileUpdates.bio = bio;
  if (avatar_url !== undefined) profileUpdates.avatar_url = avatar_url;
  if (banner_url !== undefined) profileUpdates.banner_url = banner_url;
  if (website !== undefined) profileUpdates.website = website;
  if (location !== undefined) profileUpdates.location = location;

  if (Object.keys(profileUpdates).length > 1) {
    await db.update(profiles).set(profileUpdates).where(eq(profiles.user_id, auth.user.userId));
  }

  const [row] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      phone: users.phone,
      role: users.role,
      is_creator: users.is_creator,
      is_verified: users.is_verified,
      created_at: users.created_at,
      display_name: profiles.display_name,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      location: profiles.location,
      is_verified_creator: profiles.is_verified_creator,
      subscription_price: profiles.subscription_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  return ok({ user: row });
}
