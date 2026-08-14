import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const saveSchema = z.object({
  bank_name: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
  account_number: z.string().min(1).optional(),
  accountNumber: z.string().min(1).optional(),
  account_name: z.string().min(1).optional(),
  accountName: z.string().min(1).optional(),
  bank_code: z.string().optional(),
  bankCode: z.string().optional(),
});

async function ensureSettings(userId: string) {
  let [settings] = await db
    .select()
    .from(creator_settings)
    .where(eq(creator_settings.user_id, userId))
    .limit(1);
  if (!settings) {
    await db.insert(creator_settings).values({ id: generateId(), user_id: userId });
    [settings] = await db.select().from(creator_settings).where(eq(creator_settings.user_id, userId)).limit(1);
  }
  return settings!;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const settings = await ensureSettings(auth.user.userId);
  let details: Record<string, unknown> = {};
  try {
    details = settings.bank_details ? JSON.parse(settings.bank_details) : {};
  } catch {
    details = {};
  }

  return ok({
    bank_name: details.bankName ?? details.bank_name ?? null,
    bankName: details.bankName ?? details.bank_name ?? null,
    account_number: details.accountNumber ?? details.account_number ?? null,
    accountNumber: details.accountNumber ?? details.account_number ?? null,
    account_name: details.accountName ?? details.account_name ?? null,
    accountName: details.accountName ?? details.account_name ?? null,
    bank_code: details.bankCode ?? details.bank_code ?? null,
    bankCode: details.bankCode ?? details.bank_code ?? null,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, saveSchema);
  if (!parsed.success) return parsed.response;

  const bankName = parsed.data.bankName ?? parsed.data.bank_name ?? "";
  const accountNumber = parsed.data.accountNumber ?? parsed.data.account_number ?? "";
  const accountName = parsed.data.accountName ?? parsed.data.account_name ?? "";
  const bankCode = parsed.data.bankCode ?? parsed.data.bank_code ?? undefined;

  if (!bankName || !accountNumber || !accountName) {
    return err("bankName, accountNumber and accountName are required", 422);
  }

  const settings = await ensureSettings(auth.user.userId);
  const bankJson = JSON.stringify({ bankName, accountNumber, accountName, bankCode });

  await db
    .update(creator_settings)
    .set({ bank_details: bankJson, updated_at: new Date().toISOString() })
    .where(eq(creator_settings.user_id, auth.user.userId));

  return ok({
    success: true,
    bank_name: bankName,
    account_number: accountNumber,
    account_name: accountName,
    bank_code: bankCode ?? null,
  });
}
