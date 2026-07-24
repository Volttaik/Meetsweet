import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { creator_settings, users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [user] = await db.select({ is_creator: users.is_creator }).from(users).where(eq(users.id, auth.user.userId)).limit(1);
  if (!user?.is_creator) return err("Must be a creator to request verification", 403);

  const [existing] = await db
    .select({ id: creator_settings.id, verification_status: creator_settings.verification_status })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  if (existing?.verification_status === "pending") return err("Verification already pending", 409);
  if (existing?.verification_status === "approved") return ok(null, "Already verified");

  if (existing) {
    await db.update(creator_settings).set({ verification_status: "pending" }).where(eq(creator_settings.id, existing.id));
  } else {
    await db.insert(creator_settings).values({
      id: generateId(),
      user_id: auth.user.userId,
      verification_status: "pending",
    });
  }

  return ok(null, "Verification request submitted");
}
