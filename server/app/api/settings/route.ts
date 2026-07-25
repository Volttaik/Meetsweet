import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { z } from "zod";

const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().min(2).max(10).optional(),
  notif_likes: z.boolean().optional(),
  notif_comments: z.boolean().optional(),
  notif_follows: z.boolean().optional(),
  notif_messages: z.boolean().optional(),
  notif_subscriptions: z.boolean().optional(),
  private_account: z.boolean().optional(),
  show_online_status: z.boolean().optional(),
  show_read_receipts: z.boolean().optional(),
  typing_indicator: z.boolean().optional(),
  sensitive_content: z.boolean().optional(),
  data_saver: z.boolean().optional(),
  autoplay_media: z.boolean().optional(),
  biometric_login: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [settings] = await db
    .select()
    .from(user_settings)
    .where(eq(user_settings.user_id, auth.user.userId))
    .limit(1);

  // Return defaults if not yet created
  if (!settings) {
    return ok({
      theme: "system",
      language: "en",
      notif_likes: true,
      notif_comments: true,
      notif_follows: true,
      notif_messages: true,
      notif_subscriptions: true,
      private_account: false,
      show_online_status: true,
      show_read_receipts: true,
      typing_indicator: true,
      sensitive_content: false,
      data_saver: false,
      autoplay_media: true,
      biometric_login: false,
    });
  }

  return ok(settings);
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, settingsSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const [existing] = await db
    .select({ id: user_settings.id })
    .from(user_settings)
    .where(eq(user_settings.user_id, auth.user.userId))
    .limit(1);

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) update[k] = v;
  }

  if (existing) {
    await db
      .update(user_settings)
      .set(update)
      .where(eq(user_settings.id, existing.id));
  } else {
    await db.insert(user_settings).values({
      id: generateId(),
      user_id: auth.user.userId,
      ...update,
    });
  }

  const [updated] = await db
    .select()
    .from(user_settings)
    .where(eq(user_settings.user_id, auth.user.userId))
    .limit(1);

  return ok(updated);
}
