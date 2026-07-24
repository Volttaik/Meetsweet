import { NextRequest, NextResponse } from "next/server";
import { lt, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization");
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  const result = await db
    .update(subscriptions)
    .set({ status: "expired" })
    .where(and(eq(subscriptions.status, "active"), lt(subscriptions.expires_at, now)));

  console.log(`[cron/expire-subscriptions] processed`);
  return NextResponse.json({ ok: true });
}
