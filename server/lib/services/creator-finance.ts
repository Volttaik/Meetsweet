import { eq, sql } from "drizzle-orm";
import { creator_earnings, transactions, wallets } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

export const CREATOR_COMMISSION_RATE = 0.10;
export const CREATOR_COMMISSION_CAP = 1000;

export function calculateCreatorSplit(grossAmount: number): {
  grossAmount: number;
  platformFee: number;
  creatorAmount: number;
} {
  const gross = Math.max(0, Number(grossAmount) || 0);
  const platformFee = Math.min(gross * CREATOR_COMMISSION_RATE, CREATOR_COMMISSION_CAP);
  return {
    grossAmount: gross,
    platformFee,
    creatorAmount: gross - platformFee,
  };
}

/**
 * Credit one creator earning inside the caller's existing DB transaction.
 * The mobile client supplies no amount, fee, or net value: all three are
 * derived here from the gross amount and persisted in an auditable ledger.
 */
export async function recordCreatorEarning(
  tx: any,
  input: {
    creatorId: string;
    buyerId?: string | null;
    sourceType: string;
    sourceId?: string | null;
    grossAmount: number;
    description: string;
    metadata?: Record<string, unknown>;
    currency?: string;
  },
): Promise<{ transactionId: string; grossAmount: number; platformFee: number; creatorAmount: number }> {
  const split = calculateCreatorSplit(input.grossAmount);
  const transactionId = generateId();
  const currency = input.currency ?? "NGN";
  const now = new Date().toISOString();
  const metadata = {
    ...(input.metadata ?? {}),
    gross_amount: split.grossAmount,
    platform_fee: split.platformFee,
    creator_net_amount: split.creatorAmount,
    commission_rate: CREATOR_COMMISSION_RATE,
    commission_cap: CREATOR_COMMISSION_CAP,
    source_type: input.sourceType,
    source_id: input.sourceId ?? null,
  };

  const [creatorWallet] = await tx
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.user_id, input.creatorId))
    .limit(1);

  if (creatorWallet) {
    await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} + ${split.creatorAmount}`,
        updated_at: now,
      })
      .where(eq(wallets.id, creatorWallet.id));
  } else {
    await tx.insert(wallets).values({
      id: generateId(),
      user_id: input.creatorId,
      balance: split.creatorAmount,
      currency,
    });
  }

  await tx.insert(transactions).values({
    id: transactionId,
    user_id: input.creatorId,
    type: `${input.sourceType}_earn`,
    amount: split.creatorAmount,
    currency,
    status: "success",
    description: input.description,
    metadata: JSON.stringify(metadata),
    created_at: now,
    updated_at: now,
  });

  await tx.insert(creator_earnings).values({
    id: generateId(),
    creator_id: input.creatorId,
    buyer_id: input.buyerId ?? null,
    source_type: input.sourceType,
    source_id: input.sourceId ?? null,
    transaction_id: transactionId,
    gross_amount: split.grossAmount,
    platform_fee: split.platformFee,
    net_amount: split.creatorAmount,
    currency,
    created_at: now,
  });

  return { transactionId, ...split };
}
