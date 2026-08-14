import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { getMember, listRoomMessages } from "@/lib/services/chat-rooms";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return ok({ changed: false, marker: null, messages: [] });

  const since = req.nextUrl.searchParams.get("since");
  const marker = new Date().toISOString();

  if (!since) {
    return ok({ changed: false, marker, messages: [] });
  }

  const messages = await listRoomMessages(chatRoomId, auth.user.userId, { after: since });
  return ok({ changed: messages.length > 0, marker, messages });
}
