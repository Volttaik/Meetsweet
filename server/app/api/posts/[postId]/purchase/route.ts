import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, wallets, transactions, content_purchases } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err, notFound } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      unlock_price: posts.unlock_price,
      visibility: posts.visibility,
    })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound();
  if (post.creator_id === auth.user.userId) return err("You own this post", 400);

  const price = post.unlock_price ?? 0;
  if (price <= 0) return err("This post is not available for purchase", 400);

  // Check if already purchased
  const [existing] = await db
    .select({ id: content_purchases.id })
    .from(content_purchases)
    .where(
      and(
        eq(content_purchases.user_id, auth.user.userId),
        eq(content_purchases.post_id, postId)
      )
    )
    .limit(1);

  if (existing) return ok({ already_purchased: true }, "Already purchased");

  // Deduct from wallet
  const [wallet] = await db
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  if (!wallet || wallet.balance < price) {
    return err("Insufficient wallet balance", 402);
  }

  // Record purchase
  const purchaseId = generateId();
  await db.insert(content_purchases).values({
    id: purchaseId,
    user_id: auth.user.userId,
    post_id: postId,
    amount: price,
  });

  // Debit buyer
  await db
    .update(wallets)
    .set({ balance: wallet.balance - price })
    .where(eq(wallets.id, wallet.id));

  // Record transaction
  await db.insert(transactions).values({
    id: generateId(),
    user_id: auth.user.userId,
    type: "purchase",
    amount: price,
    status: "success",
    description: `Unlocked post ${postId}`,
  });

  // Credit creator (best-effort — in production use a proper settlement flow)
  const [creatorWallet] = await db
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, post.creator_id))
    .limit(1);

  if (creatorWallet) {
    await db
      .update(wallets)
      .set({ balance: creatorWallet.balance + price })
      .where(eq(wallets.id, creatorWallet.id));

    await db.insert(transactions).values({
      id: generateId(),
      user_id: post.creator_id,
      type: "credit",
      amount: price,
      status: "success",
      description: `Content unlock by user`,
    });
  }

  return ok({ id: purchaseId }, "Content unlocked successfully");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({
      id: posts.id,
      unlock_price: posts.unlock_price,
      creator_id: posts.creator_id,
    })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound();

  const isOwner = post.creator_id === auth.user.userId;

  const [purchased] = await db
    .select({ id: content_purchases.id, purchased_at: content_purchases.purchased_at })
    .from(content_purchases)
    .where(
      and(
        eq(content_purchases.user_id, auth.user.userId),
        eq(content_purchases.post_id, postId)
      )
    )
    .limit(1);

  const [wallet] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  return ok({
    unlock_price: post.unlock_price ?? 0,
    is_owner: isOwner,
    is_purchased: !!purchased || isOwner,
    purchased_at: purchased?.purchased_at ?? null,
    can_afford: (wallet?.balance ?? 0) >= (post.unlock_price ?? 0),
    wallet_balance: wallet?.balance ?? 0,
  });
}
