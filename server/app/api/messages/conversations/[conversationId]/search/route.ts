import { NextRequest } from "next/server";
import { eq, and, isNull, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, conversation_members, users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, err } from "@/lib/api/response";
import { signMessageRow } from "@/lib/api/media";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.length < 2) return err("Query must be at least 2 characters", 400);

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

  if (!member) return forbidden();

  const rows = await db
    .select({
      id: messages.id,
      body: messages.body,
      type: messages.type,
      created_at: messages.created_at,
      sender_id: messages.sender_id,
      sender_username: users.username,
      sender_avatar: profiles.avatar_url,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.sender_id))
    .leftJoin(profiles, eq(profiles.user_id, messages.sender_id))
    .where(
      and(
        eq(messages.conversation_id, conversationId),
        isNull(messages.deleted_at),
        like(messages.body, `%${q}%`)
      )
    )
    .limit(50);

  const signed = await Promise.all(rows.map(signMessageRow));
  return ok({ messages: signed, query: q });
}
