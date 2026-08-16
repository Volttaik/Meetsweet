import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const viewSchema = z.object({
  watch_duration_secs: z.number().int().min(0).max(86400).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.content_type, "video")))
    .limit(1);
  if (!post) return err("Video not found", 404);

  const parsed = await parseBody(req, viewSchema);
  const duration = parsed.success ? (parsed.data.watch_duration_secs ?? 0) : 0;

  await db
    .update(posts)
    .set({ view_count: sql`${posts.view_count} + 1` })
    .where(eq(posts.id, id));

  return ok({ tracked: true, watch_duration_secs: duration });
}
