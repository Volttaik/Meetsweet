import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { user_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const patchSchema = z.object({
  push_notifications: z.boolean().optional(),
  email_notifications: z.boolean().optional(),
  dark_mode: z.boolean().optional(),
  data_saver: z.boolean().optional(),
  autoplay_media: z.boolean().optional(),
  high_quality_media: z.boolean().optional(),
  sensitive_content: z.boolean().optional(),
  language: z.string().max(50).optional(),
  biometric_login: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  let [settings] = await db
    .select()
    .from(user_settings)
    .where(eq(user_settings.user_id, auth.user.userId))
    .limit(1);

  if (!settings) {
    await db.insert(user_settings).values({ id: generateId(), user_id: auth.user.userId });
    [settings] = await db.select().from(user_settings).where(eq(user_settings.user_id, auth.user.userId)).limit(1);
  }

  // Return settings fields directly — mobile expects AppSettings at the top level, not wrapped.
  return ok({
    push_notifications: settings!.push_notifications,
    email_notifications: settings!.email_notifications,
    dark_mode: settings!.dark_mode,
    data_saver: settings!.data_saver,
    autoplay_media: settings!.autoplay_media,
    high_quality_media: settings!.high_quality_media,
    sensitive_content: settings!.sensitive_content,
    language: settings!.language,
    biometric_login: settings!.biometric_login,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  const [existing] = await db
    .select({ id: user_settings.id })
    .from(user_settings)
    .where(eq(user_settings.user_id, auth.user.userId))
    .limit(1);

  const now = new Date().toISOString();

  if (existing) {
    await db.update(user_settings).set({ ...parsed.data, updated_at: now }).where(eq(user_settings.id, existing.id));
  } else {
    await db.insert(user_settings).values({ id: generateId(), user_id: auth.user.userId, ...parsed.data });
  }

  const [settings] = await db.select().from(user_settings).where(eq(user_settings.user_id, auth.user.userId)).limit(1);
  return ok({
    push_notifications: settings!.push_notifications,
    email_notifications: settings!.email_notifications,
    dark_mode: settings!.dark_mode,
    data_saver: settings!.data_saver,
    autoplay_media: settings!.autoplay_media,
    high_quality_media: settings!.high_quality_media,
    sensitive_content: settings!.sensitive_content,
    language: settings!.language,
    biometric_login: settings!.biometric_login,
  });
}
