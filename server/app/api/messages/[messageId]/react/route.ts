import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, notFound } from "@/lib/api/response";
import { reactMessageSchema } from "@/schemas/message";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { messageId } = await params;

  const parsed = await parseBody(req, reactMessageSchema);
  if (!parsed.success) return parsed.response;

  const [msg] = await db.select({ reactions: messages.reactions }).from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) return notFound();

  const reactions: Record<string, string[]> = msg.reactions ? JSON.parse(msg.reactions) : {};
  const emoji = parsed.data.emoji;
  if (!reactions[emoji]) reactions[emoji] = [];
  if (!reactions[emoji].includes(auth.user.userId)) {
    reactions[emoji].push(auth.user.userId);
  }

  await db.update(messages).set({ reactions: JSON.stringify(reactions) }).where(eq(messages.id, messageId));
  return ok(null, "Reacted");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { messageId } = await params;

  const parsed = await parseBody(req, reactMessageSchema);
  if (!parsed.success) return parsed.response;

  const [msg] = await db.select({ reactions: messages.reactions }).from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) return notFound();

  const reactions: Record<string, string[]> = msg.reactions ? JSON.parse(msg.reactions) : {};
  const emoji = parsed.data.emoji;
  if (reactions[emoji]) {
    reactions[emoji] = reactions[emoji].filter((uid) => uid !== auth.user.userId);
    if (!reactions[emoji].length) delete reactions[emoji];
  }

  await db.update(messages).set({ reactions: JSON.stringify(reactions) }).where(eq(messages.id, messageId));
  return ok(null, "Reaction removed");
}
