import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { err, ok } from "@/lib/api/response";
import { ensureReferralCode } from "@/lib/services/referrals";
import { config } from "@/lib/config";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [user] = await db
    .select({ id: users.id, is_creator: users.is_creator, full_name: users.full_name, referral_code: users.referral_code, referred_by: users.referred_by })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);
  if (!user) return err("User not found", 404);
  if (!user.is_creator) return err("Creator referral link unavailable", 403, "CREATOR_REQUIRED");

  const code = user.referral_code ?? await ensureReferralCode(user.id);
  const baseUrl = config.app.publicUrl().replace(/\/+$/, "");
  const [referrer] = user.referred_by
    ? await db.select({ full_name: users.full_name, username: users.username }).from(users).where(eq(users.id, user.referred_by)).limit(1)
    : [];
  return ok({
    code,
    url: `${baseUrl}/r/${code}`,
    referral_link: `${baseUrl}/r/${code}`,
    is_creator: Boolean(user.is_creator),
    referrer: referrer ? { name: referrer.full_name, username: referrer.username } : null,
  });
}
