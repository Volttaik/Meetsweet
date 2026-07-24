import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound } from "@/lib/api/response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { messageId } = await params;

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) return notFound();
  if (msg.sender_id !== auth.user.userId) return forbidden();

  await db.update(messages).set({ is_recalled: true, body: null, media_url: null }).where(eq(messages.id, messageId));
  return ok(null, "Message recalled");
}
