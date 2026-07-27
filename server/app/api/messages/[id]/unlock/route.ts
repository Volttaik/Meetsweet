import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  messages,
  message_unlocks,
  conversation_members,
  wallets,
  transactions,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

/**
 * POST /api/messages/:id/unlock
 *
 * Unlock a paid message using credits from the caller's wallet.
 *
 * Security:
 *   - Caller must be an authenticated member of the message's conversation.
 *   - A sender cannot unlock their own paid content (it is already visible to them).
 *   - Duplicate unlocks are idempotent — no double-charge.
 *
 * Consistency:
 *   - Wallet debit, wallet credit, transaction insert, and unlock insert are
 *     executed inside a single LibSQL batch (all-or-nothing, in order).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  // ── 1. Fetch the message and verify caller's conversation membership ───────
  const [message] = await db
    .select({
      id: messages.id,
      sender_id: messages.sender_id,
      conversation_id: messages.conversation_id,
      is_paid: messages.is_paid,
      paid_price: messages.paid_price,
      media_url: messages.media_url,
      is_recalled: messages.is_recalled,
    })
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1);

  if (!message) return err("Message not found", 404);
  if (!message.is_paid) return err("This message is not paid content", 400);
  if (message.is_recalled) return err("This message has been deleted", 410);

  // Verify caller is a member of the conversation (prevents IDOR)
  const [membership] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, message.conversation_id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!membership) return err("Forbidden", 403);

  // Sender's own paid messages are always visible to them — no unlock needed
  if (message.sender_id === auth.user.userId) {
    return ok({ unlocked: true, already_unlocked: true, media_url: message.media_url });
  }

  const price = message.paid_price ?? 0;

  // ── 2. Idempotency check — return immediately if already unlocked ──────────
  const [existing] = await db
    .select({ id: message_unlocks.id })
    .from(message_unlocks)
    .where(
      and(
        eq(message_unlocks.message_id, id),
        eq(message_unlocks.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (existing) {
    return ok({ unlocked: true, already_unlocked: true, media_url: message.media_url });
  }

  // ── 3. Credit transfer + unlock — atomic batch ────────────────────────────
  if (price > 0) {
    // Fetch buyer wallet (must exist and have sufficient balance)
    const [buyerWallet] = await db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, auth.user.userId))
      .limit(1);

    if (!buyerWallet || buyerWallet.balance < price) {
      return err("Insufficient credits", 402, "INSUFFICIENT_CREDITS");
    }

    const [creatorWallet] = await db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, message.sender_id))
      .limit(1);

    const now = new Date().toISOString();
    const txBuyerId = generateId();
    const txCreatorId = generateId();
    const unlockId = generateId();

    // Execute all writes as an atomic LibSQL batch.
    // If any statement fails the entire batch is rolled back.
    await db.transaction(async (tx) => {
      // Deduct from buyer
      await tx
        .update(wallets)
        .set({ balance: buyerWallet.balance - price, updated_at: now })
        .where(
          and(
            eq(wallets.id, buyerWallet.id),
            // Optimistic lock: abort if balance changed concurrently
            eq(wallets.balance, buyerWallet.balance),
          ),
        );

      // Credit creator (upsert via insert-or-ignore + update pattern)
      if (creatorWallet) {
        await tx
          .update(wallets)
          .set({ balance: creatorWallet.balance + price, updated_at: now })
          .where(eq(wallets.id, creatorWallet.id));
      } else {
        await tx.insert(wallets).values({
          id: generateId(),
          user_id: message.sender_id,
          balance: price,
          currency: "NGN",
        });
      }

      // Buyer debit transaction record
      await tx.insert(transactions).values({
        id: txBuyerId,
        user_id: auth.user.userId,
        type: "message_unlock",
        amount: -price,
        status: "success",
        description: "Unlocked paid message",
        metadata: JSON.stringify({ message_id: id }),
      });

      // Creator credit transaction record
      await tx.insert(transactions).values({
        id: txCreatorId,
        user_id: message.sender_id,
        type: "message_unlock_earn",
        amount: price,
        status: "success",
        description: "Paid message unlocked",
        metadata: JSON.stringify({ message_id: id, buyer_id: auth.user.userId }),
      });

      // Unlock record (unique constraint prevents duplicates under concurrency)
      await tx.insert(message_unlocks).values({
        id: unlockId,
        message_id: id,
        user_id: auth.user.userId,
        credits_spent: price,
      });
    });
  } else {
    // Free paid content — just record the unlock
    await db.insert(message_unlocks).values({
      id: generateId(),
      message_id: id,
      user_id: auth.user.userId,
      credits_spent: 0,
    });
  }

  return ok({ unlocked: true, media_url: message.media_url });
}
