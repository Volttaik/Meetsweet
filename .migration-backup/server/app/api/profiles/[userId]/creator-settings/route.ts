import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { creator_settings, users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, forbidden, notFound } from "@/lib/api/response";
import { creatorSettingsSchema } from "@/schemas/profile";
import { generateId } from "@/lib/auth/codes";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { userId } = await params;
  if (auth.user.userId !== userId) return forbidden();

  const [settings] = await db
    .select()
    .from(creator_settings)
    .where(eq(creator_settings.user_id, userId))
    .limit(1);

  return ok(settings ?? null);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { userId } = await params;
  if (auth.user.userId !== userId) return forbidden();

  const [user] = await db
    .select({ is_creator: users.is_creator })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return notFound();
  if (!user.is_creator) return err("Only creators can update creator settings", 403);

  const parsed = await parseBody(req, creatorSettingsSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const [existing] = await db
    .select({ id: creator_settings.id })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, userId))
    .limit(1);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.subscription_price !== undefined) update.subscription_price = body.subscription_price;
  if (body.allow_dms !== undefined) update.allow_dms = body.allow_dms;
  if (body.allow_comments !== undefined) update.allow_comments = body.allow_comments;
  if (body.welcome_message !== undefined) update.welcome_message = body.welcome_message;

  if (existing) {
    await db.update(creator_settings).set(update).where(eq(creator_settings.id, existing.id));
  } else {
    await db.insert(creator_settings).values({
      id: generateId(),
      user_id: userId,
      ...update,
    });
  }

  return ok(null, "Creator settings updated");
}
