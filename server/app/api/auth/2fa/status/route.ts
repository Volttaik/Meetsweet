import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [user] = await db
    .select({ totp_enabled: users.totp_enabled })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  return ok({ enabled: Boolean(user.totp_enabled) });
}
