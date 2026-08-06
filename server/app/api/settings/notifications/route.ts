import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { user_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

/**
 * GET/PATCH /api/settings/notifications
 *
 * Persists granular notification preference toggles.
 * Columns are added to user_settings via the migrate script.
 */

const patchSchema = z.object({
  notif_messages:         z.boolean().optional(),
  notif_comments:         z.boolean().optional(),
  notif_mentions:         z.boolean().optional(),
  notif_likes:            z.boolean().optional(),
  notif_new_subscribers:  z.boolean().optional(),
  notif_creator_updates:  z.boolean().optional(),
  notif_marketing:        z.boolean().optional(),
  notif_vibration:        z.boolean().optional(),
  notif_sound:            z.boolean().optional(),
  notif_preview:          z.boolean().optional(),
  notif_quiet_hours:      z.boolean().optional(),
  notif_quiet_start:      z.string().max(10).optional(),
  notif_quiet_end:        z.string().max(10).optional(),
});

async function ensureSettings(userId: string) {
  let [settings] = await db
    .select()
    .from(user_settings)
    .where(eq(user_settings.user_id, userId))
    .limit(1);

  if (!settings) {
    await db.insert(user_settings).values({ id: generateId(), user_id: userId });
    [settings] = await db
      .select()
      .from(user_settings)
      .where(eq(user_settings.user_id, userId))
      .limit(1);
  }
  return settings!;
}

function notifShape(s: Record<string, unknown>) {
  return {
    notif_messages:         s.notif_messages         ?? true,
    notif_comments:         s.notif_comments         ?? true,
    notif_mentions:         s.notif_mentions         ?? true,
    notif_likes:            s.notif_likes            ?? true,
    notif_new_subscribers:  s.notif_new_subscribers  ?? true,
    notif_creator_updates:  s.notif_creator_updates  ?? true,
    notif_marketing:        s.notif_marketing        ?? false,
    notif_vibration:        s.notif_vibration        ?? true,
    notif_sound:            s.notif_sound            ?? true,
    notif_preview:          s.notif_preview          ?? true,
    notif_quiet_hours:      s.notif_quiet_hours      ?? false,
    notif_quiet_start:      s.notif_quiet_start      ?? "22:00",
    notif_quiet_end:        s.notif_quiet_end        ?? "08:00",
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const settings = await ensureSettings(auth.user.userId);
  return ok(notifShape(settings as unknown as Record<string, unknown>));
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  const settings = await ensureSettings(auth.user.userId);
  const now = new Date().toISOString();

  await db
    .update(user_settings)
    .set({ ...(parsed.data as Record<string, unknown>), updated_at: now })
    .where(eq(user_settings.id, settings.id));

  const [updated] = await db
    .select()
    .from(user_settings)
    .where(eq(user_settings.user_id, auth.user.userId))
    .limit(1);

  return ok(notifShape(updated as unknown as Record<string, unknown>));
}
