import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { DEFAULT_SUBSCRIPTION_PRICE } from "@/lib/services/pricing";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [user] = await db
    .select({ id: users.id, is_creator: users.is_creator, creator_activation_paid: users.creator_activation_paid })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);
  if (user.is_creator && user.creator_activation_paid) {
    return err("You are already a creator", 409);
  }

  // Require the one-time ₦1,000 creator activation fee to have been paid.
  // The client should call /api/creator/activation first to initiate Paystack
  // payment, then /api/creator/activation/verify to confirm it.
  if (!user.creator_activation_paid) {
    return err(
      "A one-time creator activation fee of ₦1,000 is required before you can become a creator. Please complete the payment.",
      402,
      "ACTIVATION_REQUIRED",
    );
  }

  const now = new Date().toISOString();

  // Set is_creator = true
  await db
    .update(users)
    .set({ is_creator: true, role: "creator", updated_at: now })
    .where(eq(users.id, auth.user.userId));

  // Upsert creator_settings
  const [existing] = await db
    .select({ id: creator_settings.id })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  if (!existing) {
    await db.insert(creator_settings).values({
      id: generateId(),
      user_id: auth.user.userId,
      subscription_price: DEFAULT_SUBSCRIPTION_PRICE,
    });
  }

  return ok({ is_creator: true });
}
