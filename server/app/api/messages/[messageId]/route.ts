import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, forbidden, notFound } from "@/lib/api/response";
import { editMessageSchema } from "@/schemas/message";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { messageId } = await params;

  const [msg] = await db.select().from(messages).where(and(eq(messages.id, messageId), isNull(messages.deleted_at))).limit(1);
  if (!msg) return notFound();

  return ok(msg);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { messageId } = await params;

  const [msg] = await db.select().from(messages).where(and(eq(messages.id, messageId), isNull(messages.deleted_at))).limit(1);
  if (!msg) return notFound();
  if (msg.sender_id !== auth.user.userId) return forbidden();

  const parsed = await parseBody(req, editMessageSchema);
  if (!parsed.success) return parsed.response;

  await db.update(messages).set({ body: parsed.data.body, is_edited: true, updated_at: new Date().toISOString() }).where(eq(messages.id, messageId));
  return ok(null, "Message edited");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { messageId } = await params;

  const [msg] = await db.select().from(messages).where(and(eq(messages.id, messageId), isNull(messages.deleted_at))).limit(1);
  if (!msg) return notFound();
  if (msg.sender_id !== auth.user.userId) return forbidden();

  await db.update(messages).set({ deleted_at: new Date().toISOString() }).where(eq(messages.id, messageId));
  return ok(null, "Message deleted");
}
