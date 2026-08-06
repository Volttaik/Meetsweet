import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]).optional().default("android"),
  device_name: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const { token, platform, device_name } = parsed.data;
  const now = new Date().toISOString();

  // A token identifies an installation, not a user session. If a user logs
  // into the same installation, transfer ownership instead of creating a
  // duplicate delivery row.
  const [existing] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.push_token, token))
    .limit(1);

  if (existing) {
    await db
      .update(devices)
      .set({
        user_id: auth.user.userId,
        platform,
        device_name: device_name ?? null,
        last_seen_at: now,
      })
      .where(eq(devices.id, existing.id));
  } else {
    await db.insert(devices).values({
      id: generateId(),
      user_id: auth.user.userId,
      push_token: token,
      platform,
      device_name: device_name ?? null,
      last_seen_at: now,
    });
  }

  return ok({});
}
