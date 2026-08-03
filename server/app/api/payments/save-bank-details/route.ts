import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { creator_bank_details } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const bankDetailsSchema = z.object({
  bankName: z.string().min(1).max(100),
  accountNumber: z.string().min(5).max(20),
  accountName: z.string().min(1).max(100),
});

/**
 * POST /api/payments/save-bank-details
 *
 * Save or update the creator's bank details for withdrawals.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Check if user is a creator
  if (auth.user.role !== "creator" && auth.user.role !== "admin") {
    return err("Only creators can save bank details", 403);
  }

  const parsed = await parseBody(req, bankDetailsSchema);
  if (!parsed.success) return parsed.response;

  const { bankName, accountNumber, accountName } = parsed.data;

  // Check if bank details already exist
  const [existing] = await db
    .select({ id: creator_bank_details.id })
    .from(creator_bank_details)
    .where(eq(creator_bank_details.user_id, auth.user.userId))
    .limit(1);

  if (existing) {
    // Update existing record
    await db
      .update(creator_bank_details)
      .set({
        bank_name: bankName,
        account_number: accountNumber,
        account_name: accountName,
        updated_at: new Date().toISOString(),
      })
      .where(eq(creator_bank_details.id, existing.id));
  } else {
    // Create new record
    await db.insert(creator_bank_details).values({
      id: generateId(),
      user_id: auth.user.userId,
      bank_name: bankName,
      account_number: accountNumber,
      account_name: accountName,
    });
  }

  return ok({
    success: true,
    bank_name: bankName,
    account_number: accountNumber,
    account_name: accountName,
  });
}
