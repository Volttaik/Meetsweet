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
 * GET/PATCH /api/settings/privacy
 *
 * Persists privacy preference toggles that the mobile stores locally.
 * Columns are added to user_settings via the migrate script.
 */

const patchSchema = z.object({
  private_account:    z.boolean().optional(),
  online_status:      z.boolean().optional(),
  activity_status:    z.boolean().optional(),
  typing_indicator:   z.boolean().optional(),
  read_receipts:      z.boolean().optional(),
  allow_dms:          z.boolean().optional(),
  allow_mentions:     z.boolean().optional(),
  allow_tags:         z.boolean().optional(),
  search_visible:     z.boolean().optional(),
  birthday_visible:   z.boolean().optional(),
  phone_visible:      z.boolean().optional(),
  sensitive_blur:     z.boolean().optional(),
  qr_discovery:       z.boolean().optional(),
  auto_archive:       z.boolean().optional(),
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

function privacyShape(s: Record<string, unknown>) {
  return {
    private_account:  s.private_account  ?? false,
    online_status:    s.online_status    ?? true,
    activity_status:  s.activity_status  ?? true,
    typing_indicator: s.typing_indicator ?? true,
    read_receipts:    s.read_receipts    ?? true,
    allow_dms:        s.allow_dms        ?? true,
    allow_mentions:   s.allow_mentions   ?? true,
    allow_tags:       s.allow_tags       ?? true,
    search_visible:   s.search_visible   ?? true,
    birthday_visible: s.birthday_visible ?? false,
    phone_visible:    s.phone_visible    ?? false,
    sensitive_blur:   s.sensitive_blur   ?? true,
    qr_discovery:     s.qr_discovery     ?? true,
    auto_archive:     s.auto_archive     ?? false,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const settings = await ensureSettings(auth.user.userId);
  return ok(privacyShape(settings as unknown as Record<string, unknown>));
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

  return ok(privacyShape(updated as unknown as Record<string, unknown>));
}
