import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts, reports } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { notifyReported } from "@/lib/services/notifications";

const schema = z.object({
  reason: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  // Deleted content cannot be reported — its row is gone after authoritative
  // deletion, and soft-deleted legacy rows are rejected here.
  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id, content_type: posts.content_type, title: posts.title, caption: posts.caption })
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);
  if (!post) return err("Post not found", 404);

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db.insert(reports).values({
    id: generateId(),
    reporter_id: auth.user.userId,
    entity_type: "post",
    entity_id: id,
    reason: parsed.data.reason,
    description: parsed.data.description ?? null,
  });

  // The content owner learns their content was reported — without any
  // information about who reported it.
  if (post.creator_id && post.creator_id !== auth.user.userId) {
    void notifyReported({
      recipientId: post.creator_id,
      reporterId: auth.user.userId,
      entityType: post.content_type ?? "post",
      entityId: id,
      entityTitle: post.title ?? post.caption,
    });
  }

  return ok({ reported: true });
}
