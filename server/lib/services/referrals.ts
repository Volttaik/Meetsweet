import { randomBytes } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creator_settings,
  notifications,
  referral_rewards,
  transactions,
  users,
  wallets,
} from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { DEFAULT_SUBSCRIPTION_PRICE } from "@/lib/services/pricing";
import { sendReferralBonusEmail } from "@/lib/services/email";
import { emitNotificationCreated, type NotificationRow } from "@/lib/services/push";
import { emitEvent } from "@/lib/realtime/emit";
import { userChannel } from "@/lib/realtime/types";

export const REFERRAL_REWARD_NAIRA = 200;
export const CREATOR_ACTIVATION_NAIRA = 1000;

export function normalizeReferralCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{6,32}$/.test(code) ? code : null;
}

function newReferralCode(): string {
  return randomBytes(6).toString("hex").toUpperCase();
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const [existing] = await db
    .select({ referral_code: users.referral_code })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (existing?.referral_code) return existing.referral_code;

  // Extremely unlikely collision; retry a few times while the unique index is
  // the final source of truth.
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newReferralCode();
    try {
      const [updated] = await db
        .update(users)
        .set({ referral_code: code, updated_at: new Date().toISOString() })
        .where(and(eq(users.id, userId), isNull(users.referral_code)))
        .returning({ referral_code: users.referral_code });
      if (updated?.referral_code) return updated.referral_code;
      const [current] = await db
        .select({ referral_code: users.referral_code })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (current?.referral_code) return current.referral_code;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  throw new Error("Could not create referral code");
}

export async function lookupReferral(code: string) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  const [row] = await db
    .select({
      code: users.referral_code,
      creator_id: users.id,
      creator_name: users.full_name,
      creator_username: users.username,
      is_creator: users.is_creator,
    })
    .from(users)
    .where(
      and(
        eq(users.referral_code, normalized),
        eq(users.is_creator, true),
        eq(users.is_active, true),
        isNull(users.deleted_at),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Complete an already Paystack-verified activation in one DB transaction.
 * The reward insert has a unique referred_user_id and activation transaction
 * index, so retries and webhook/redirect races cannot pay twice.
 */
export async function settleCreatorActivation(
  userId: string,
  transactionId: string,
  paystackReference: string,
): Promise<{
  activated: boolean;
  alreadyActivated: boolean;
  rewardAmount: number;
  referrerId?: string;
  // Populated when a reward is actually paid, then used to send the referral
  // bonus email AFTER the transaction commits so a slow SMTP call never holds
  // the DB transaction open.
  emailData?: {
    referrerEmail: string;
    referrerName: string;
    newBalance: number;
    referredUserName: string;
  };
  // The committed notification row — emitted as a realtime event after the
  // transaction commits (the socket must never fire before its DB row exists).
  notificationRow?: NotificationRow;
}> {
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        username: users.username,
        is_creator: users.is_creator,
        creator_activation_paid: users.creator_activation_paid,
        referred_by: users.referred_by,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new Error("USER_NOT_FOUND");

    if (user.creator_activation_paid && user.is_creator) {
      return { activated: true, alreadyActivated: true, rewardAmount: 0, emailData: undefined };
    }

    const [activationTx] = await tx
      .select({ id: transactions.id, user_id: transactions.user_id, type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);
    if (
      !activationTx ||
      activationTx.user_id !== userId ||
      activationTx.type !== "creator_activation" ||
      Number(activationTx.amount) !== CREATOR_ACTIVATION_NAIRA
    ) {
      throw new Error("INVALID_ACTIVATION_TRANSACTION");
    }

    const now = new Date().toISOString();
    await tx
      .update(transactions)
      .set({
        status: "completed",
        paystack_ref: paystackReference,
        description: "Creator activation fee (₦800 platform / ₦200 referral allocation)",
        metadata: JSON.stringify({
          activation_amount: CREATOR_ACTIVATION_NAIRA,
          referral_reward: REFERRAL_REWARD_NAIRA,
          platform_amount: CREATOR_ACTIVATION_NAIRA - REFERRAL_REWARD_NAIRA,
          referral_settled: Boolean(user.referred_by),
        }),
        updated_at: now,
      })
      .where(eq(transactions.id, transactionId));

    await tx
      .update(users)
      .set({ creator_activation_paid: true, is_creator: true, role: "creator", updated_at: now })
      .where(eq(users.id, userId));

    const [existingSettings] = await tx
      .select({ id: creator_settings.id })
      .from(creator_settings)
      .where(eq(creator_settings.user_id, userId))
      .limit(1);
    if (!existingSettings) {
      await tx.insert(creator_settings).values({
        id: generateId(),
        user_id: userId,
        subscription_price: DEFAULT_SUBSCRIPTION_PRICE,
      });
    }

    if (!user.referred_by || user.referred_by === userId) {
      return { activated: true, alreadyActivated: false, rewardAmount: 0, emailData: undefined };
    }

    const [referrer] = await tx
      .select({ id: users.id, full_name: users.full_name, email: users.email })
      .from(users)
      .where(and(eq(users.id, user.referred_by), eq(users.is_active, true), isNull(users.deleted_at)))
      .limit(1);
    if (!referrer) return { activated: true, alreadyActivated: false, rewardAmount: 0, emailData: undefined };

    // The unique referred-user constraint is the abuse-prevention boundary.
    const [existingReward] = await tx
      .select({ id: referral_rewards.id })
      .from(referral_rewards)
      .where(eq(referral_rewards.referred_user_id, userId))
      .limit(1);
    if (existingReward) return { activated: true, alreadyActivated: false, rewardAmount: 0, emailData: undefined };

    await tx.insert(referral_rewards).values({
      id: generateId(),
      referrer_id: referrer.id,
      referred_user_id: userId,
      activation_transaction_id: transactionId,
      amount: REFERRAL_REWARD_NAIRA,
      currency: "NGN",
      created_at: now,
    });

    const [referrerWallet] = await tx
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, referrer.id))
      .limit(1);
    let newBalance: number;
    if (referrerWallet) {
      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${REFERRAL_REWARD_NAIRA}`, updated_at: now })
        .where(eq(wallets.id, referrerWallet.id));
      newBalance = Number(referrerWallet.balance) + REFERRAL_REWARD_NAIRA;
    } else {
      await tx.insert(wallets).values({
        id: generateId(),
        user_id: referrer.id,
        balance: REFERRAL_REWARD_NAIRA,
        currency: "NGN",
        created_at: now,
        updated_at: now,
      });
      newBalance = REFERRAL_REWARD_NAIRA;
    }
    const emailData = {
      referrerEmail: referrer.email,
      referrerName: referrer.full_name ?? referrer.email,
      newBalance,
      referredUserName: user.username,
    };

    await tx.insert(transactions).values({
      id: generateId(),
      user_id: referrer.id,
      type: "referral_reward",
      amount: REFERRAL_REWARD_NAIRA,
      currency: "NGN",
      status: "success",
      reference: `referral_reward_${userId}`,
      description: "Referral reward after creator activation",
      metadata: JSON.stringify({ referred_user_id: userId, activation_transaction_id: transactionId }),
      created_at: now,
      updated_at: now,
    });

    const referralNotificationId = generateId();
    await tx.insert(notifications).values({
      id: referralNotificationId,
      user_id: referrer.id,
      actor_id: userId,
      type: "referral_reward",
      entity_type: "wallet",
      entity_id: transactionId,
      body: "You received ₦200 referral reward after your referral became a creator.",
      created_at: now,
    });

    return {
      activated: true,
      alreadyActivated: false,
      rewardAmount: REFERRAL_REWARD_NAIRA,
      referrerId: referrer.id,
      emailData,
      // The notification row + wallet credit commit inside this transaction;
      // the realtime fan-out happens below, AFTER commit, so a rolled-back
      // reward never emits an event its DB row does not back.
      notificationRow: {
        id: referralNotificationId,
        user_id: referrer.id,
        actor_id: userId,
        type: "referral_reward",
        entity_type: "wallet",
        entity_id: transactionId,
        body: "You received ₦200 referral reward after your referral became a creator.",
        created_at: now,
      },
    };
  });

  // Send the bonus email after the transaction commits — best-effort.
  if (result.emailData) {
    await sendReferralBonusEmail({
      to: result.emailData.referrerEmail,
      name: result.emailData.referrerName,
      amount: REFERRAL_REWARD_NAIRA,
      currency: "NGN",
      newBalance: result.emailData.newBalance,
      referredUserName: result.emailData.referredUserName,
    }).catch(() => null);
  }

  // Realtime AFTER commit: the referrer's notification feed/badge and wallet
  // balance update instantly on every connected device. The DB rows committed
  // above remain authoritative — the socket only delivers.
  if (result.notificationRow) {
    emitNotificationCreated(result.notificationRow);
    emitEvent({
      type: "wallet.updated",
      channel: userChannel(result.notificationRow.user_id),
      userId: result.notificationRow.user_id,
      resourceId: result.notificationRow.entity_id ?? undefined,
      payload: { reason: "referral_reward", amount: REFERRAL_REWARD_NAIRA },
    });
  }

  return result;
}
