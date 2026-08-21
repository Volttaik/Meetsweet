import { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { album_unlocks, albums, notifications, transactions, users, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { err, ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { loadAlbum } from "@/lib/services/albums";
import { recordCreatorEarning } from "@/lib/services/creator-finance";
import { sendPushToUser, getActorUsername } from "@/lib/services/push";

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

      await tx.insert(transactions).values({
        id: generateId(), user_id: auth.user.userId, type: "album_unlock",
        amount: -price, status: "success", description: "Unlocked paid album",
        metadata: JSON.stringify({ album_id: id, creator_id: album.creator_id }),
      });

      await recordCreatorEarning(tx, {
        creatorId: album.creator_id,
        buyerId: auth.user.userId,
        sourceType: "album_unlock",
        sourceId: id,
        grossAmount: price,
        description: "Album unlocked by a fan",
        metadata: { album_id: id, buyer_id: auth.user.userId },
      });
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

  await db.insert(notifications).values({
    id: generateId(),
    user_id: album.creator_id,
    actor_id: auth.user.userId,
    type: "payment",
    entity_type: "album",
    entity_id: id,
    body: "Your album received a new purchase",
  }).catch(() => {});
  getActorUsername(auth.user.userId).then((actor) =>
    sendPushToUser(album.creator_id, {
      title: "Album Purchase",
      body: `${actor} unlocked your album`,
      data: { type: "payment", wallet: true, content_type: "album", album_id: id, content_id: id },
    }, "notif_creator_updates"),
  );

  return ok({ unlocked: true, already_unlocked: false, album: await loadAlbum(id, auth.user.userId) });
}