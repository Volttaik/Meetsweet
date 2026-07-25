import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, notFound } from "@/lib/api/response";
import { resolveUrl } from "@/lib/services/r2";
import { updateProfileSchema } from "@/schemas/profile";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      full_name: users.full_name,
      is_creator: users.is_creator,
      role: users.role,
      display_name: profiles.display_name,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      location: profiles.location,
      is_verified_creator: profiles.is_verified_creator,
      subscription_price: profiles.subscription_price,
      created_at: users.created_at,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return notFound("User not found");

  return ok({
    ...row,
    avatar_url: await resolveUrl(row.avatar_url),
    banner_url: await resolveUrl(row.banner_url),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { userId } = await params;
  if (auth.user.userId !== userId) return err("Forbidden", 403);

  const parsed = await parseBody(req, updateProfileSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  if (body.username) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, body.username.toLowerCase()))
      .limit(1);
    if (existing && existing.id !== userId) return err("Username already taken", 409);
    await db
      .update(users)
      .set({ username: body.username.toLowerCase(), updated_at: new Date().toISOString() })
      .where(eq(users.id, userId));
  }

  const profileUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.display_name !== undefined) profileUpdate.display_name = body.display_name;
  if (body.bio !== undefined) profileUpdate.bio = body.bio;
  if (body.website !== undefined) profileUpdate.website = body.website;
  if (body.location !== undefined) profileUpdate.location = body.location;

  if (Object.keys(profileUpdate).length > 1) {
    await db.update(profiles).set(profileUpdate).where(eq(profiles.user_id, userId));
  }

  return ok(null, "Profile updated");
}
