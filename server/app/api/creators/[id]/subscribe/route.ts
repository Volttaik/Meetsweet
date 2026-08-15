import { NextRequest } from "next/server";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  creator_settings,
  notifications,
  subscriptions,
  transactions,
  users,
  wallets,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { sendPushToUser, getActorUsername } from "@/lib/services/push";

const TIER_MULTIPLIER: Record<string, number> = { subscriber: 1, subscriber_plus: 2 };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id: creator_id } = await params;
  if (creator_id === auth.user.userId) return err("Cannot subscribe to yourself", 400);

  const parsed = await parseBody(
    req,
    z.object({ plan: z.enum(["subscriber", "subscriber_plus"]).optional() }),
  );
  if (!parsed.success) return parsed.response;

  const tier: "subscriber" | "subscriber_plus" = parsed.data.plan ?? "subscriber";

  const [creator] = await db.select({ id: users.id }).from(users).where(eq(users.id, creator_id)).limit(1);
  if (!creator) return err("Creator not found", 404);

  const [settings] = await db
    .select({
      subscription_price: creator_settings.subscription_price,
      subscription_plus_price: creator_settings.subscription_plus_price,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, creator_id))
    .limit(1);

  const creatorPrice = settings?.subscription_price ?? 0;
  const price =
    tier === "subscriber_plus"
      ? Math.round(settings?.subscription_plus_price ?? creatorPrice * TIER_MULTIPLIER.subscriber_plus)
      : Math.round(creatorPrice);

  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const subId = generateId();

  // The wallet debit + transaction + subscription insert are ONE atomic unit.
  // A failure at any step rolls the whole thing back so the user is never
  // charged without receiving an active subscription (or vice-versa).
  type Outcome = { kind: "existing" | "created"; id: string; tier: "subscriber" | "subscriber_plus" };
  let outcome!: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      // Idempotency: one active subscription per (subscriber, creator).
      const [existing] = await tx
        .select({ id: subscriptions.id, tier: subscriptions.tier })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.subscriber_id, auth.user.userId),
            eq(subscriptions.creator_id, creator_id),
            eq(subscriptions.status, "active"),
          ),
        )
        .limit(1);
      if (existing) {
        return { kind: "existing", id: existing.id, tier: existing.tier ?? tier };
      }

      if (price > 0) {
        const [wallet] = await tx
          .select({ id: wallets.id, balance: wallets.balance })
          .from(wallets)
          .where(eq(wallets.user_id, auth.user.userId))
          .limit(1);
        if (!wallet || (wallet.balance ?? 0) < price) {
          throw new Error("INSUFFICIENT_BALANCE");
        }

        // Conditional debit: only succeeds if the balance is still sufficient,
        // preventing concurrent double-charges.
        const [debited] = await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} - ${price}`, updated_at: now })
          .where(and(eq(wallets.id, wallet.id), gte(wallets.balance, price)))
          .returning({ id: wallets.id });
        if (!debited) throw new Error("INSUFFICIENT_BALANCE");

        await tx.insert(transactions).values({
          id: generateId(),
          user_id: auth.user.userId,
          type: "subscription",
          amount: price,
          currency: "NGN",
          status: "success",
          description: `Subscription to creator ${creator_id}`,
          metadata: JSON.stringify({ creator_id, tier }),
        });
      }

      await tx.insert(subscriptions).values({
        id: subId,
        subscriber_id: auth.user.userId,
        creator_id,
        status: "active",
        tier,
        amount: price,
        started_at: now,
        expires_at: expires,
      });

      return { kind: "created", id: subId, tier };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
    }
    throw error;
  }

  // Authoritative subscriber count AFTER the transaction so the client can
  // update the creator profile immediately (no stale zero-count after subscribe).
  const [subCountRow] = await db
    .select({ n: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.creator_id, creator_id), eq(subscriptions.status, "active")));
  const subscriber_count = subCountRow?.n ?? 0;

  if (outcome.kind === "existing") {
    return ok({
      subscription_id: outcome.id,
      subscribed: true,
      tier: outcome.tier,
      subscriber_count,
      subscriberCount: subscriber_count,
      subscription: { id: outcome.id, creator_id, status: "active" },
    });
  }

  // Best-effort notification + push — outside the transaction so a delivery
  // failure can never roll back the committed subscription.
  await db.insert(notifications).values({
    id: generateId(),
    user_id: creator_id,
    actor_id: auth.user.userId,
    type: "subscribe",
    entity_type: "user",
    entity_id: auth.user.userId,
    body: "just subscribed to you",
  }).catch(() => {});

  getActorUsername(auth.user.userId).then((actor) =>
    sendPushToUser(creator_id, {
      title: "New Subscriber",
      body: `${actor} just subscribed to you`,
      data: { type: "subscribe", actor_id: auth.user.userId, actor_username: actor.replace(/^@/, "") },
    }, "notif_new_subscribers"),
  );

  return created({
    subscribed: true,
    subscription_id: subId,
    tier,
    subscriber_count,
    subscriberCount: subscriber_count,
    subscription: { id: subId, creator_id, status: "active", amount: price, started_at: now, expires_at: expires },
  });
}
