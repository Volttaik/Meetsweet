import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, reports } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, notFound } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { z } from "zod";

const schema = z.object({
  reason: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return notFound("Comment not found");

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db.insert(reports).values({
    id: generateId(),
    reporter_id: auth.user.userId,
    entity_type: "comment",
    entity_id: commentId,
    reason: parsed.data.reason,
    description: parsed.data.description,
  });

  return ok(null, "Report submitted");
}
