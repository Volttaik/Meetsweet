import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const schema = z.object({
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
});

/**
 * POST /api/payments/save-bank-details
 *
 * Persists the creator's withdrawal bank details in the dedicated
 * creator_settings.bank_details column as a JSON string.
 *
 * Request body:
 * - bankName: string
 * - accountNumber: string
 * - accountName: string
 *
 * Response:
 * - success: boolean
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if ("response" in parsed) return parsed.response;

  const { bankName, accountNumber, accountName } = parsed.data;

  const now = new Date().toISOString();
  const bankJson = JSON.stringify({ bankName, accountNumber, accountName });

  const [existing] = await db
    .select({ id: creator_settings.id })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  if (!existing) {
    return err("Creator settings not found. Become a creator first.", 404);
  }

  await db
    .update(creator_settings)
    .set({ bank_details: bankJson, updated_at: now })
    .where(eq(creator_settings.user_id, auth.user.userId));

  return ok({ success: true });
}
