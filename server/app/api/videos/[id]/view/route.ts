import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { recordView } from "@/lib/services/views";

const viewSchema = z.object({
  // ADDITIONAL seconds watched since the last report (deltas accumulate server-side).
  watch_duration_secs: z.number().int().min(0).max(86400).optional(),
  // Client-known media duration — hint only; the server prefers its own stored value.
  video_duration_secs: z.number().min(0).max(86400).optional(),
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

  const auth = await optionalAuth(req);
  const parsed = await parseBody(req, viewSchema);
  const watchSeconds = parsed.success ? (parsed.data.watch_duration_secs ?? 0) : 0;
  const clientDuration = parsed.success ? (parsed.data.video_duration_secs ?? null) : null;

  const result = await recordView(id, auth?.userId ?? null, watchSeconds, clientDuration);
  if (!result) return err("Video not found", 404);

  return ok({
    tracked: true,
    counted: result.counted,
    view_count: result.viewCount,
    viewCount: result.viewCount,
    required_seconds: result.requiredSeconds,
  });
}
