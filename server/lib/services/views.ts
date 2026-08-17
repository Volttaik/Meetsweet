/**
 * Authoritative view counting.
 *
 * Rules enforced here (never on the client):
 * - Scrolling past / previewing a video does NOT count a view.
 * - Views are per AUTHENTICATED ACCOUNT: anonymous plays are never counted.
 * - Long-form video (>= 60s): the account must accumulate 60s of watch time.
 * - Short video (< 60s): the account must watch ~90% of it (with a 2s floor)
 *   so shorts can earn views without the 60s rule making them impossible.
 * - ACCOUNT + VIDEO = at most ONE counted view. Replays never recount.
 *
 * The client only reports watched seconds (deltas); accumulation, threshold
 * crossing and the view_count increment all happen server-side in a
 * transaction, so the server remains the single source of truth.
 */
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, media, post_views } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

const LONG_VIEW_THRESHOLD_SECS = 60;
/** Fallback when a short's duration is unknown (e.g. legacy uploads). */
const SHORT_UNKNOWN_DURATION_THRESHOLD_SECS = 5;

export interface RecordViewResult {
  /** True when THIS report crossed the threshold and the view was counted. */
  counted: boolean;
  /** Authoritative view count after this report (read from posts). */
  viewCount: number;
  /** Seconds of accumulated watch time this account needs to count. */
  requiredSeconds: number;
}

/**
 * Resolve the view threshold for a piece of content.
 * duration >= 60s (or unknown long-form): 60s flat.
 * duration < 60s (shorts): 90% of the duration, min 2s — a short must be
 * essentially watched through to count, matching the existing short product
 * (one full watch ≈ one view) without making views impossible.
 */
export function resolveViewThreshold(
  contentType: string,
  durationSeconds: number | null | undefined,
): number {
  const d = typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : null;
  if (d !== null) {
    return d >= LONG_VIEW_THRESHOLD_SECS
      ? LONG_VIEW_THRESHOLD_SECS
      : Math.max(2, Math.round(d * 0.9));
  }
  return contentType === "short" ? SHORT_UNKNOWN_DURATION_THRESHOLD_SECS : LONG_VIEW_THRESHOLD_SECS;
}

/**
 * Record a watch-time report for a post.
 *
 * @param postId        the post/video/short id
 * @param userId        authenticated viewer id, or null for anonymous
 * @param watchSeconds  ADDITIONAL seconds watched since the last report
 * @param clientDurationSeconds  optional client-reported media duration — used
 *                      only when the server has no duration stored for the post
 */
export async function recordView(
  postId: string,
  userId: string | null,
  watchSeconds: number,
  clientDurationSeconds?: number | null,
): Promise<RecordViewResult | null> {
  const [post] = await db
    .select({
      id: posts.id,
      content_type: posts.content_type,
      deleted_at: posts.deleted_at,
      status: posts.status,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  // Deleted / draft / missing content never counts views.
  if (!post || post.deleted_at !== null || post.status !== "published") {
    return null;
  }

  // Anonymous plays are tracked as non-events — no row, no count.
  if (!userId) {
    const [row] = await db
      .select({ view_count: posts.view_count })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    return { counted: false, viewCount: row?.view_count ?? 0, requiredSeconds: LONG_VIEW_THRESHOLD_SECS };
  }

  // Prefer the server's stored duration; the client value is only a hint.
  const [mediaRow] = await db
    .select({ duration_seconds: media.duration_seconds })
    .from(media)
    .where(and(eq(media.post_id, postId), eq(media.type, "video")))
    .limit(1);
  const durationSeconds =
    mediaRow?.duration_seconds && mediaRow.duration_seconds > 0
      ? mediaRow.duration_seconds
      : (clientDurationSeconds ?? null);
  const required = resolveViewThreshold(post.content_type, durationSeconds);
  const delta = Math.max(0, Math.min(86400, Math.round(watchSeconds)));

  if (delta <= 0) {
    const [row] = await db
      .select({ view_count: posts.view_count })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    return { counted: false, viewCount: row?.view_count ?? 0, requiredSeconds: required };
  }

  // Atomic accumulate + count. The unique (post_id, user_id) index means the
  // account can only ever hold ONE row, and `counted` flips exactly once.
  let countedThisReport = false;
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: post_views.id,
        watched_seconds: post_views.watched_seconds,
        counted: post_views.counted,
      })
      .from(post_views)
      .where(and(eq(post_views.post_id, postId), eq(post_views.user_id, userId)))
      .limit(1);

    const previous = existing?.watched_seconds ?? 0;
    const wasCounted = existing?.counted ?? false;
    const total = previous + delta;

    if (existing) {
      await tx
        .update(post_views)
        .set({ watched_seconds: total, updated_at: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
        .where(eq(post_views.id, existing.id));
    } else {
      await tx.insert(post_views).values({
        id: generateId(),
        post_id: postId,
        user_id: userId,
        watched_seconds: total,
        counted: false,
      });
    }

    // Count exactly once — the first report that crosses the threshold.
    if (!wasCounted && total >= required) {
      countedThisReport = true;
      await tx
        .update(post_views)
        .set({ counted: true, updated_at: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
        .where(eq(post_views.post_id, postId));
      await tx
        .update(posts)
        .set({ view_count: sql`${posts.view_count} + 1` })
        .where(eq(posts.id, postId));
    }
  });

  const [fresh] = await db
    .select({ view_count: posts.view_count })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  return {
    counted: countedThisReport,
    viewCount: fresh?.view_count ?? 0,
    requiredSeconds: required,
  };
}
