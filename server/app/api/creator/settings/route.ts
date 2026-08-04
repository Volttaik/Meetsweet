import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { creator_settings, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const patchSchema = z.object({
  subscription_price: z.number().min(0).optional(),
  allow_dms: z.boolean().optional(),
  allow_comments: z.boolean().optional(),
  // Accept both field names from mobile
  who_can_message: z.enum(["everyone", "subscribers", "none"]).optional(),
  who_can_dm: z.enum(["everyone", "subscribers", "none"]).optional(),
  welcome_message: z.string().max(500).nullable().optional(),
});

function buildSettingsResponse(
  settings: typeof creator_settings.$inferSelect,
  isVerifiedCreator: boolean,
) {
  const who = settings.who_can_message ?? "everyone";
  return {
    subscription_price: settings.subscription_price,
    allow_dms: settings.allow_dms,
    allow_comments: settings.allow_comments,
    who_can_message: who,
    who_can_dm: who, // alias expected by mobile
    welcome_message: settings.welcome_message,
    verification_status: settings.verification_status,
    is_verified_creator: isVerifiedCreator,
  };
}

async function getVerifiedStatus(userId: string): Promise<boolean> {
  const [profile] = await db
    .select({ is_verified_creator: profiles.is_verified_creator })
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .limit(1);
  return profile?.is_verified_creator ?? false;
}

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

  const isVerified = await getVerifiedStatus(auth.user.userId);
  return ok(buildSettingsResponse(settings!, isVerified));
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  // Normalise: who_can_dm is an alias for who_can_message
  const { who_can_dm, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest };
  if (who_can_dm && !rest.who_can_message) updates.who_can_message = who_can_dm;

  const [existing] = await db
    .select({ id: creator_settings.id })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  const now = new Date().toISOString();

  if (existing) {
    await db.update(creator_settings).set({ ...updates, updated_at: now }).where(eq(creator_settings.id, existing.id));
  } else {
    await db.insert(creator_settings).values({ id: generateId(), user_id: auth.user.userId, ...updates });
  }

  const [settings] = await db.select().from(creator_settings).where(eq(creator_settings.user_id, auth.user.userId)).limit(1);
  const isVerified = await getVerifiedStatus(auth.user.userId);
  return ok(buildSettingsResponse(settings!, isVerified));
}
