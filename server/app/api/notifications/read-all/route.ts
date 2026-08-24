import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, auth.user.userId), eq(notifications.is_read, false)));

  return ok({ updated: true });
}
