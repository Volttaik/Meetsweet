import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { creator_settings, profiles, users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { DEFAULT_SUBSCRIPTION_PRICE } from "@/lib/services/pricing";
import { emitEvent } from "@/lib/realtime/emit";
import { userChannel } from "@/lib/realtime/types";

const patchSchema = z.object({
  subscription_price: z.number().finite().min(0).optional(),
  subscription_plus_price: z.number().finite().min(0).nullable().optional(),
  // ── Private Inbox ──────────────────────────────────────────────────────
  private_inbox_enabled: z.boolean().optional(),
  // 0 = FREE messaging (default); a positive value opts the inbox into PAID.
  private_message_price: z.number().finite().min(0).max(1_000_000).optional(),
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
    subscription_plus_price: settings.subscription_plus_price,
    subscriptionPlusPrice: settings.subscription_plus_price,
    allow_dms: settings.allow_dms,
    allow_comments: settings.allow_comments,
    who_can_message: who,
    who_can_dm: who, // alias expected by mobile
    welcome_message: settings.welcome_message,
    verification_status: settings.verification_status,
    is_verified_creator: isVerifiedCreator,
    // Private Inbox (creator monetization controls)
    private_inbox_enabled: settings.private_inbox_enabled,
    privateInboxEnabled: settings.private_inbox_enabled,
    private_message_price: settings.private_message_price,
    privateMessagePrice: settings.private_message_price,
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
  const [account] = await db.select({ is_creator: users.is_creator, role: users.role }).from(users).where(eq(users.id, auth.user.userId)).limit(1);
  if (!account?.is_creator || account.role !== "creator") return new Response(JSON.stringify({ error: "Creator access required", code: "FORBIDDEN" }), { status: 403, headers: { "Content-Type": "application/json" } });

  let [settings] = await db
    .select()
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  if (!settings) {
    const newId = generateId();
    await db.insert(creator_settings).values({
      id: newId,
      user_id: auth.user.userId,
      // Auto-created rows must start at the default price (₦200), not 0, so
      // the dashboard never shows "Free" for a creator who never priced it.
      subscription_price: DEFAULT_SUBSCRIPTION_PRICE,
    });
    [settings] = await db.select().from(creator_settings).where(eq(creator_settings.user_id, auth.user.userId)).limit(1);
  }

  const isVerified = await getVerifiedStatus(auth.user.userId);
  return ok(buildSettingsResponse(settings!, isVerified));
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const [account] = await db.select({ is_creator: users.is_creator, role: users.role }).from(users).where(eq(users.id, auth.user.userId)).limit(1);
  if (!account?.is_creator || account.role !== "creator") return new Response(JSON.stringify({ error: "Creator access required", code: "FORBIDDEN" }), { status: 403, headers: { "Content-Type": "application/json" } });

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
    await db.insert(creator_settings).values({
      id: generateId(),
      user_id: auth.user.userId,
      ...updates,
      // Only override the default price when the PATCH explicitly sets one.
      subscription_price: (updates.subscription_price as number | undefined) ?? DEFAULT_SUBSCRIPTION_PRICE,
    });
  }

  const [settings] = await db.select().from(creator_settings).where(eq(creator_settings.user_id, auth.user.userId)).limit(1);
  const isVerified = await getVerifiedStatus(auth.user.userId);

  // Live pricing updates propagate to fans viewing the creator's profile.
  const inboxFieldsChanged =
    "private_inbox_enabled" in updates || "private_message_price" in updates;
  if (inboxFieldsChanged) {
    emitEvent({
      type: "private_inbox.settings_updated",
      channel: userChannel(auth.user.userId),
      userId: auth.user.userId,
      resourceId: auth.user.userId,
      payload: {
        private_inbox_enabled: settings?.private_inbox_enabled ?? true,
        private_message_price: settings?.private_message_price ?? 0,
      },
    });
  }

  return ok(buildSettingsResponse(settings!, isVerified));
}
