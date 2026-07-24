import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound } from "@/lib/api/response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { subscriptionId } = await params;

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!sub) return notFound();
  if (sub.subscriber_id !== auth.user.userId) return forbidden();

  await db.update(subscriptions).set({ status: "cancelled", cancelled_at: new Date().toISOString() }).where(eq(subscriptions.id, subscriptionId));

  return ok(null, "Subscription cancelled");
}
