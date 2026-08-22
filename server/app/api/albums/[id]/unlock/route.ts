import { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { album_unlocks, albums, transactions, users, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { err, ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { loadAlbum } from "@/lib/services/albums";
import { recordCreatorEarning } from "@/lib/services/creator-finance";
import { sendPushToUser, getActorUsername, createNotification } from "@/lib/services/push";
import { sendAlbumPurchaseEmail } from "@/lib/services/email";
import { emitEvent } from "@/lib/realtime/emit";

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

  const [creator] = await db.select({ id: users.id, full_name: users.full_name }).from(users).where(eq(users.id, album.creator_id)).limit(1);
  if (!creator) return err("Creator not found", 404);
  const [buyerUser] = await db
    .select({ id: users.id, full_name: users.full_name, email: users.email })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);
  if (!buyerUser) return err("User not found", 404);

  const reference = `album_unlock_${id}_${auth.user.userId}_${Date.now()}`;
  const purchasedAt = new Date().toISOString();

  try {
    await db.transaction(async (tx) => {
      const [updatedBuyer] = await tx.update(wallets)
        .set({ balance: sql`${wallets.balance} - ${price}`, updated_at: new Date().toISOString() })
        .where(and(eq(wallets.id, buyer.id), gte(wallets.balance, price)))
        .returning({ id: wallets.id });
      if (!updatedBuyer) throw new Error("INSUFFICIENT_BALANCE");

      await tx.insert(transactions).values({
        id: generateId(), user_id: auth.user.userId, type: "album_unlock",
        amount: -price, status: "success", reference, description: "Unlocked paid album",
        metadata: JSON.stringify({ album_id: id, creator_id: album.creator_id, purchased_at: purchasedAt }),
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

  // In-app row gated by the creator's Creator Updates preference — when OFF,
  // the purchase never appears in their notification feed either.
  await createNotification(album.creator_id, "notif_creator_updates", {
    actor_id: auth.user.userId,
    type: "payment",
    entity_type: "album",
    entity_id: id,
    body: "Your album received a new purchase",
  });
  getActorUsername(auth.user.userId).then((actor) =>
    sendPushToUser(album.creator_id, {
      title: "Album Purchase",
      body: `${actor} unlocked your album`,
      data: { type: "payment", wallet: true, content_type: "album", album_id: id, content_id: id },
    }, "notif_creator_updates"),
  );

  // Realtime — emitted ONLY after the confirmed transaction (financial state
  // is never optimistic): the buyer's wallet balance and album purchase state
  // update instantly on their connected devices.
  void emitEvent({
    type: "wallet.updated",
    channel: `user:${auth.user.userId}`,
    resourceId: auth.user.userId,
    userId: auth.user.userId,
    payload: { reason: "album_unlock", albumId: id },
  });
  void emitEvent({
    type: "purchase.completed",
    channel: `user:${auth.user.userId}`,
    resourceId: id,
    userId: auth.user.userId,
    payload: { albumId: id, creatorId: album.creator_id, amount: price },
  });

  // Buyer confirmation email with full purchase context. Best-effort — a
  // delivery failure must never fail the unlock itself.
  await sendAlbumPurchaseEmail({
    to: buyerUser.email,
    name: buyerUser.full_name ?? auth.user.userId,
    albumTitle: album.title,
    creatorName: creator.full_name ?? "a creator",
    amount: price,
    currency: "NGN",
    reference,
    purchasedAt,
  }).catch(() => null);

  return ok({ unlocked: true, already_unlocked: false, album: await loadAlbum(id, auth.user.userId) });
}