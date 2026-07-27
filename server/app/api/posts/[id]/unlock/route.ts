import { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { post_unlocks, posts, transactions, users, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { err, ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const [post] = await db.select().from(posts)
    .where(and(eq(posts.id, id), sql`${posts.deleted_at} IS NULL`))
    .limit(1);
  if (!post) return err("Post not found", 404);
  if (post.creator_id === auth.user.userId || (post.unlock_price ?? 0) <= 0) {
    return ok({ unlocked: true, already_unlocked: true, media_url: null });
  }

  const [existing] = await db.select({ id: post_unlocks.id })
    .from(post_unlocks)
    .where(and(eq(post_unlocks.post_id, id), eq(post_unlocks.user_id, auth.user.userId)))
    .limit(1);
  if (existing) return ok({ unlocked: true, already_unlocked: true, media_url: null });

  const price = post.unlock_price ?? 0;
  const [buyer] = await db.select({ id: wallets.id, balance: wallets.balance })
    .from(wallets).where(eq(wallets.user_id, auth.user.userId)).limit(1);
  if (!buyer || buyer.balance < price) {
    return err("Insufficient credits", 402, "INSUFFICIENT_CREDITS");
  }

  const [creator] = await db.select({ id: users.id })
    .from(users).where(eq(users.id, post.creator_id)).limit(1);
  if (!creator) return err("Creator not found", 404);

  try {
    await db.transaction(async (tx) => {
      const [debited] = await tx.update(wallets)
        .set({ balance: sql`${wallets.balance} - ${price}`, updated_at: new Date().toISOString() })
        .where(and(eq(wallets.id, buyer.id), gte(wallets.balance, price)))
        .returning({ id: wallets.id });
      if (!debited) throw new Error("INSUFFICIENT_CREDITS");

      const [creatorWallet] = await tx.select({ id: wallets.id })
        .from(wallets).where(eq(wallets.user_id, post.creator_id)).limit(1);
      if (creatorWallet) {
        await tx.update(wallets).set({
          balance: sql`${wallets.balance} + ${price}`,
          updated_at: new Date().toISOString(),
        }).where(eq(wallets.id, creatorWallet.id));
      } else {
        await tx.insert(wallets).values({
          id: generateId(), user_id: post.creator_id, balance: price, currency: "NGN",
        });
      }

      await tx.insert(transactions).values([
        {
          id: generateId(), user_id: auth.user.userId, type: "post_unlock",
          amount: -price, status: "success", description: "Unlocked paid post",
          metadata: JSON.stringify({ post_id: id, creator_id: post.creator_id }),
        },
        {
          id: generateId(), user_id: post.creator_id, type: "post_unlock_earn",
          amount: price, status: "success", description: "Paid post unlocked by a fan",
          metadata: JSON.stringify({ post_id: id, buyer_id: auth.user.userId }),
        },
      ]);
      await tx.insert(post_unlocks).values({
        id: generateId(), post_id: id, user_id: auth.user.userId, credits_spent: price,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_CREDITS") {
      return err("Insufficient credits", 402, "INSUFFICIENT_CREDITS");
    }
    throw error;
  }

  return ok({ unlocked: true, already_unlocked: false });
}