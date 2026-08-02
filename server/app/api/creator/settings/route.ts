import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const patchSchema = z.object({
  subscription_price: z.number().min(0).optional(),
  allow_dms: z.boolean().optional(),
  allow_comments: z.boolean().optional(),
  who_can_message: z.enum(["everyone", "subscribers", "none"]).optional(),
  welcome_message: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  let [settings] = await db
    .select()
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  if (!settings) {
    const newId = generateId();
    await db.insert(creator_settings).values({ id: newId, user_id: auth.user.userId });
    [settings] = await db.select().from(creator_settings).where(eq(creator_settings.user_id, auth.user.userId)).limit(1);
  }

  // Return CreatorSettings fields directly — mobile expects them at the top level.
  return ok({
    subscription_price: settings!.subscription_price,
    allow_dms: settings!.allow_dms,
    allow_comments: settings!.allow_comments,
    who_can_message: settings!.who_can_message,
    welcome_message: settings!.welcome_message,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  const [existing] = await db
    .select({ id: creator_settings.id })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  const now = new Date().toISOString();

  if (existing) {
    await db.update(creator_settings).set({ ...parsed.data, updated_at: now }).where(eq(creator_settings.id, existing.id));
  } else {
    await db.insert(creator_settings).values({ id: generateId(), user_id: auth.user.userId, ...parsed.data });
  }

  const [settings] = await db.select().from(creator_settings).where(eq(creator_settings.user_id, auth.user.userId)).limit(1);
  return ok({
    subscription_price: settings!.subscription_price,
    allow_dms: settings!.allow_dms,
    allow_comments: settings!.allow_comments,
    who_can_message: settings!.who_can_message,
    welcome_message: settings!.welcome_message,
  });
}
