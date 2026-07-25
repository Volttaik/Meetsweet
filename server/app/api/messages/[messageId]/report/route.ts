import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, conversation_members, reports } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, notFound, forbidden } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { z } from "zod";

const schema = z.object({
  reason: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { messageId } = await params;

  const [msg] = await db
    .select({ id: messages.id, conversation_id: messages.conversation_id })
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deleted_at)))
    .limit(1);

  if (!msg) return notFound("Message not found");

  // Ensure reporter is a member of that conversation
  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, msg.conversation_id),
        eq(conversation_members.user_id, auth.user.userId)
      )
    )
    .limit(1);

  if (!member) return forbidden();

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db.insert(reports).values({
    id: generateId(),
    reporter_id: auth.user.userId,
    entity_type: "message",
    entity_id: messageId,
    reason: parsed.data.reason,
    description: parsed.data.description,
  });

  return ok(null, "Report submitted");
}
