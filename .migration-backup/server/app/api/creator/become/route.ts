import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [user] = await db.select({ is_creator: users.is_creator }).from(users).where(eq(users.id, auth.user.userId)).limit(1);
  if (!user) return err("User not found", 404);
  if (user.is_creator) return ok(null, "Already a creator");

  await db.update(users).set({ is_creator: true, role: "creator" }).where(eq(users.id, auth.user.userId));

  // Initialize creator settings
  const [existing] = await db.select({ id: creator_settings.id }).from(creator_settings).where(eq(creator_settings.user_id, auth.user.userId)).limit(1);
  if (!existing) {
    await db.insert(creator_settings).values({ id: generateId(), user_id: auth.user.userId });
  }

  return ok(null, "Creator account activated");
}
