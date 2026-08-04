import { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { album_unlocks, albums, transactions, users, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { err, ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { loadAlbum } from "@/lib/services/albums";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const [album] = await db.select().from(albums).where(eq(albums.id, id)).limit(1);
  if (!album || album.deleted_at) return err("Album not found", 404);
  if (album.creator_id === auth.user.userId || !album.is_premium || album.price_credits <= 0) {
    return ok({ unlocked: true, already_unlocked: true, album: await loadAlbum(id, auth.user.userId) });
  }

  const [existing] = await db.select({ id: album_unlocks.id })
    .from(album_unlocks)
    .where(and(eq(album_unlocks.album_id, id), eq(album_unlocks.user_id, auth.user.userId)))
    .limit(1);
  if (existing) return ok({ unlocked: true, already_unlocked: true, album: await loadAlbum(id, auth.user.userId) });

  const price = album.price_credits;
  const [buyer] = await db.select({ id: wallets.id, balance: wallets.balance })
    .from(wallets).where(eq(wallets.user_id, auth.user.userId)).limit(1);
  if (!buyer || buyer.balance < price) return err("Insufficient wallet balance", 402, "INSUFFICIENT_BALANCE");

  const [creator] = await db.select({ id: users.id }).from(users).where(eq(users.id, album.creator_id)).limit(1);
  if (!creator) return err("Creator not found", 404);

  try {
    await db.transaction(async (tx) => {
      const [updatedBuyer] = await tx.update(wallets)
        .set({ balance: sql`${wallets.balance} - ${price}`, updated_at: new Date().toISOString() })
        .where(and(eq(wallets.id, buyer.id), gte(wallets.balance, price)))
        .returning({ id: wallets.id });
      if (!updatedBuyer) throw new Error("INSUFFICIENT_BALANCE");

      const [creatorWallet] = await tx.select({ id: wallets.id })
        .from(wallets).where(eq(wallets.user_id, album.creator_id)).limit(1);
      if (creatorWallet) {
        await tx.update(wallets).set({
          balance: sql`${wallets.balance} + ${price}`,
          updated_at: new Date().toISOString(),
        }).where(eq(wallets.id, creatorWallet.id));
      } else {
        await tx.insert(wallets).values({
          id: generateId(), user_id: album.creator_id, balance: price, currency: "NGN",
        });
      }

      await tx.insert(transactions).values([
        {
          id: generateId(), user_id: auth.user.userId, type: "album_unlock",
          amount: -price, status: "success", description: "Unlocked paid album",
          metadata: JSON.stringify({ album_id: id, creator_id: album.creator_id }),
        },
        {
          id: generateId(), user_id: album.creator_id, type: "album_unlock_earn",
          amount: price, status: "success", description: "Album unlocked by a fan",
          metadata: JSON.stringify({ album_id: id, buyer_id: auth.user.userId }),
        },
      ]);
      await tx.insert(album_unlocks).values({
        id: generateId(), album_id: id, user_id: auth.user.userId, credits_spent: price,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      return err("Insufficient wallet balance", 402, "INSUFFICIENT_BALANCE");
    }
    throw error;
  }

  return ok({ unlocked: true, already_unlocked: false, album: await loadAlbum(id, auth.user.userId) });
}