import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { creator_settings, reports } from "@/lib/db/schema";
import { DEFAULT_SUBSCRIPTION_PRICE } from "@/lib/services/pricing";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  id_type: z.string().min(1).max(50),
  id_number: z.string().min(1).max(50),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const { id_type, id_number } = parsed.data;
  const now = new Date().toISOString();

  // Upsert creator_settings and set verification_status to "pending"
  const [existing] = await db
    .select({ id: creator_settings.id })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  if (existing) {
    await db
      .update(creator_settings)
      .set({ verification_status: "pending", updated_at: now })
      .where(eq(creator_settings.id, existing.id));
  } else {
    await db.insert(creator_settings).values({
      id: generateId(),
      user_id: auth.user.userId,
      verification_status: "pending",
      subscription_price: DEFAULT_SUBSCRIPTION_PRICE,
    });
  }

  // Store the submitted identity document details in the reports table
  // so admins can review verification requests
  await db.insert(reports).values({
    id: generateId(),
    reporter_id: auth.user.userId,
    entity_type: "creator_verification",
    entity_id: auth.user.userId,
    reason: id_type,
    description: id_number,
    status: "pending",
  });

  return ok({ submitted: true, verification_status: "pending" });
}
