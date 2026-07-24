import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { z } from "zod";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  reason: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db.insert(reports).values({
    id: generateId(),
    reporter_id: auth.user.userId,
    entity_type: "post",
    entity_id: postId,
    reason: parsed.data.reason,
    description: parsed.data.description,
  });

  return ok(null, "Report submitted");
}
