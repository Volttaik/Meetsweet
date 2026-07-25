import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { z } from "zod";

const schema = z.object({ biometric_login: z.boolean() });

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const [existing] = await db
    .select({ id: user_settings.id })
    .from(user_settings)
    .where(eq(user_settings.user_id, auth.user.userId))
    .limit(1);

  const now = new Date().toISOString();

  if (existing) {
    await db
      .update(user_settings)
      .set({ biometric_login: parsed.data.biometric_login, updated_at: now })
      .where(eq(user_settings.id, existing.id));
  } else {
    await db.insert(user_settings).values({
      id: generateId(),
      user_id: auth.user.userId,
      biometric_login: parsed.data.biometric_login,
    });
  }

  return ok({ biometric_login: parsed.data.biometric_login });
}
