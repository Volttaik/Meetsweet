import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { conversations, conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv) return err("Conversation not found", 404);

  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(and(eq(conversation_members.conversation_id, id), eq(conversation_members.user_id, auth.user.userId)))
    .limit(1);
  if (!member) return err("Forbidden", 403);

  const parsed = await parseBody(req, z.object({ archived: z.boolean() }));
  if (!parsed.success) return parsed.response;

  await db
    .update(conversation_members)
    .set({ is_archived: parsed.data.archived })
    .where(eq(conversation_members.id, member.id));

  return ok({});
}
