import { and, eq, gte, sql, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creator_settings,
  profiles,
  subscriptions,
  transactions,
  wallets,
} from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { resolveBasePrice } from "@/lib/services/pricing";
import { recordCreatorEarning } from "@/lib/services/creator-finance";
import {
  notifySubscriptionRenewal,
  notifySubscriptionRenewalFailed,
} from "@/lib/services/notifications";

/**
 * Monthly subscription auto-renewal.
 *
 * Subscriptions last 30 days. When a subscription passes `expires_at`, the
 * system attempts to renew it automatically by debiting the required amount
 * from the subscriber's wallet. This is the single authoritative renewal path,
 * run lazily when a subscription's state is next read — so a subscription that
 * expires while the user is offline is still renewed/cancelled correctly the
 * moment it's touched again, and never double-charges.
 *
 * Renewal success → debit price, extend 30 days, keep active, record the
 * transaction, credit the creator's earnings.
 * Renewal failure (insufficient balance) → expire the subscription, remove
 * active-subscriber status for that creator, notify the user, and NEVER retry
 * charging in a loop.
 *
 * Idempotency / no double-charge: renewal only runs inside a DB transaction
 * that re-checks `status = 'active' AND expires_at <= now` on the row before
 * mutating it. Any other process (a concurrent lazy re-sync) that sees the row
 * concurrently will fail that guard and skip — a given subscription is renewed
 * exactly once per period.
 */

export const SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Pure renewal decision — testable without a DB.
 *
 * Returns the action to take for a single due subscription given its resolved
 * price and the subscriber's current wallet balance:
 *  - "skip"   → not actually due (expires in the future).
 *  - "renew"  → extend by one period; `newExpiresMs` is set. Free (price <= 0)
 *               subscriptions always renew.
 *  - "expire" → wallet can't cover the priced renewal: expire + notify.
 *
 * This is the single source of truth for the renewal decision; the DB service
 * merely executes the returned action inside a transaction (with its own
 * re-checking guard for idempotency).
 */
export function resolveRenewalDecision(input: {
  price: number;
  balance: number | null; // null = subscriber has no wallet row
  nowMs: number;
  expiresMs: number;
  periodMs?: number;
}): { action: "renew" | "expire" | "skip"; newExpiresMs?: number } {
  const periodMs = input.periodMs ?? SUBSCRIPTION_PERIOD_MS;
  if (input.expiresMs > input.nowMs) {
    return { action: "skip" };
  }
  if (input.price <= 0) {
    return { action: "renew", newExpiresMs: input.nowMs + periodMs };
  }
  if (input.balance === null || input.balance < input.price) {
    return { action: "expire" };
  }
  return { action: "renew", newExpiresMs: input.nowMs + periodMs };
}

export interface RenewalOutcome {
  renewed: number;
  failed: number;
  skipped: number;
}

/**
 * Renew a single subscription atomically. Returns "renewed" when it extended
 * the subscription, "failed" when the wallet couldn't cover it (and the
 * subscription was expired), or "skipped" when it wasn't due / no longer
 * active (so the caller never needs to worry about double-processing).
 */
export async function renewExpiredSubscription(subId: string): Promise<
  "renewed" | "failed" | "skipped"
> {
  const now = new Date().toISOString();
  const nowMs = Date.now();

  return db.transaction(async (tx) => {
    // Re-check under the same transaction so a racing lazy re-sync cannot
    // double-charge. If another process already renewed or expired it, the row
    // is no longer active+due and we skip.
    const [sub] = await tx
      .select({
        id: subscriptions.id,
        subscriber_id: subscriptions.subscriber_id,
        creator_id: subscriptions.creator_id,
        status: subscriptions.status,
        tier: subscriptions.tier,
        expires_at: subscriptions.expires_at,
      })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subId)))
      .limit(1);

    if (
      !sub ||
      sub.status !== "active" ||
      !sub.expires_at ||
      new Date(sub.expires_at).getTime() > nowMs
    ) {
      return "skipped";
    }

    // Resolve the creator's CURRENT price from the same authoritative sources
    // used to subscribe, so the renewal charge always matches the advertised
    // price (falling back to the legacy profile price).
    const [settings] = await tx
      .select({
        subscription_price: creator_settings.subscription_price,
        subscription_plus_price: creator_settings.subscription_plus_price,
      })
      .from(creator_settings)
      .where(eq(creator_settings.user_id, sub.creator_id))
      .limit(1);
    const [profile] = await tx
      .select({ subscription_price: profiles.subscription_price })
      .from(profiles)
      .where(eq(profiles.user_id, sub.creator_id))
      .limit(1);

    const basePrice = resolveBasePrice(settings?.subscription_price, profile?.subscription_price);
    const tier = sub.tier ?? "subscriber";
    const price =
      tier === "subscriber_plus"
        ? Math.round(settings?.subscription_plus_price ?? basePrice * 2)
        : Math.round(basePrice);

    const [wallet] = await tx
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, sub.subscriber_id))
      .limit(1);

    const decision = resolveRenewalDecision({
      price,
      balance: wallet?.balance ?? null,
      nowMs,
      expiresMs: new Date(sub.expires_at).getTime(),
    });

    if (decision.action === "expire") {
      // Failed renewal — expire the subscription and remove active-subscriber
      // status. Never retried in a loop: the row is now status = 'expired'.
      await tx
        .update(subscriptions)
        .set({
          status: "expired",
          cancelled_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(subscriptions.id, sub.id),
            eq(subscriptions.status, "active"),
            lt(subscriptions.expires_at, now),
          ),
        );

      // In-app notification + push (not preference-gated — this is an
      // account-critical event the user must always see). Deduped by
      // subscription so retries never double-notify.
      void notifySubscriptionRenewalFailed({
        userId: sub.subscriber_id,
        creatorId: sub.creator_id,
        subscriptionId: sub.id,
      });

      return "failed";
    }

    // Successful renewal — atomically debit, extend, record transaction and
    // credit the creator. The WHERE guard prevents double-charging this period.
    const newExpires = new Date(decision.newExpiresMs ?? nowMs + SUBSCRIPTION_PERIOD_MS).toISOString();

    if (price > 0) {
      const [debited] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${price}`, updated_at: now })
        .where(and(eq(wallets.id, wallet!.id), gte(wallets.balance, price)))
        .returning({ id: wallets.id });

      if (!debited) {
        // Balance changed between the read and the update (concurrent spend) —
        // treat as a failed renewal rather than extending for free.
        await tx
          .update(subscriptions)
          .set({ status: "expired", cancelled_at: now, updated_at: now })
          .where(
            and(
              eq(subscriptions.id, sub.id),
              eq(subscriptions.status, "active"),
              lt(subscriptions.expires_at, now),
            ),
          );
        void notifySubscriptionRenewalFailed({
          userId: sub.subscriber_id,
          creatorId: sub.creator_id,
          subscriptionId: sub.id,
        });
        return "failed";
      }

      await tx.insert(transactions).values({
        id: generateId(),
        user_id: sub.subscriber_id,
        type: "subscription",
        amount: price,
        currency: "NGN",
        status: "success",
        description: `Subscription renewal for creator ${sub.creator_id}`,
        metadata: JSON.stringify({
          creator_id: sub.creator_id,
          tier,
          renewal: true,
          subscription_id: sub.id,
        }),
      });

      await recordCreatorEarning(tx, {
        creatorId: sub.creator_id,
        buyerId: sub.subscriber_id,
        sourceType: "subscription",
        sourceId: sub.id,
        grossAmount: price,
        description: `Subscription renewal from a fan (${sub.subscriber_id})`,
        metadata: { subscriber_id: sub.subscriber_id, tier, renewal: true },
      });
    }

    await tx
      .update(subscriptions)
      .set({
        status: "active",
        expires_at: newExpires,
        updated_at: now,
      })
      .where(
        and(
          eq(subscriptions.id, sub.id),
          eq(subscriptions.status, "active"),
          lt(subscriptions.expires_at, now),
        ),
      );

    // Renewal succeeded — let the subscriber know (in-app + push, deduped).
    void notifySubscriptionRenewal({
      userId: sub.subscriber_id,
      creatorId: sub.creator_id,
      subscriptionId: sub.id,
      amount: price,
    });

    return "renewed";
  });
}

/**
 * Find every due subscription and attempt to renew it. Returns a summary.
 *
 * Querying by status = 'active' AND expires_at <= now means a subscription is
 * processed at most once per period; concurrent invocations skip already-moved
 * rows. Available for batch sweeps; individual viewers are re-synced lazily
 * on read paths.
 */
export async function processDueSubscriptions(limit = 500): Promise<RenewalOutcome> {
  const now = new Date().toISOString();

  const due = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "active"),
        lt(subscriptions.expires_at, now),
      ),
    )
    .limit(limit);

  const outcome: RenewalOutcome = { renewed: 0, failed: 0, skipped: 0 };

  for (const row of due) {
    const result = await renewExpiredSubscription(row.id);
    if (result === "renewed") outcome.renewed += 1;
    else if (result === "failed") outcome.failed += 1;
    else outcome.skipped += 1;
  }

  return outcome;
}

/**
 * Controller/auth middleware can call this to lazily re-sync a specific
 * viewer's expired subscriptions (e.g. when they open their wallet or a
 * creator profile). Running renewal here keeps an offline-expired subscription
 * correct the moment the user is next seen.
 */
export async function renewForUser(userId: string, limit = 50): Promise<RenewalOutcome> {
  const now = new Date().toISOString();

  const due = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.subscriber_id, userId),
        eq(subscriptions.status, "active"),
        lt(subscriptions.expires_at, now),
      ),
    )
    .limit(limit);

  const outcome: RenewalOutcome = { renewed: 0, failed: 0, skipped: 0 };

  for (const row of due) {
    const result = await renewExpiredSubscription(row.id);
    if (result === "renewed") outcome.renewed += 1;
    else if (result === "failed") outcome.failed += 1;
    else outcome.skipped += 1;
  }

  return outcome;
}
