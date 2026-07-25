import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, forbidden } from "@/lib/api/response";
import { z } from "zod";

const archiveSchema = z.object({
  archived: z.boolean(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id: conversationId } = await params;

  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, conversationId),
        eq(conversation_members.user_id, auth.user.userId)
      )
    )
    .limit(1);

  if (!member) return forbidden("Not a participant in this conversation");

  const parsed = await parseBody(req, archiveSchema);
  if (!parsed.success) return parsed.response;

  await db
    .update(conversation_members)
    .set({ is_archived: parsed.data.archived })
    .where(
      and(
        eq(conversation_members.conversation_id, conversationId),
        eq(conversation_members.user_id, auth.user.userId)
      )
    );

  return ok({});
}
