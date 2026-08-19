import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { ok } from "@/lib/api/response";
import { config } from "@/lib/config";
import { getVideo, buildStreamQualities } from "@/lib/services/stream";

/**
 * POST /api/webhooks/stream
 *
 * Cloudflare Stream lifecycle webhook. When transcoding finishes
 * (state "ready") we fetch the video's HLS manifest, parse the rendition
 * heights, and store the server-authoritative `qualities` list on the media
 * row — which is exactly what the player's quality selector reads.
 *
 * The webhook URL is: https://meetsweet.space/api/webhooks/stream
 * (configured in the Cloudflare dashboard → Stream → Webhooks.)
 *
 * Verification: Cloudflare echoes the configured webhook secret inside the
 * payload (`webhook.secret`). When STREAM_WEBHOOK_SECRET is set we require a
 * match; when it is unset (dev) we still process the event.
 */
export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return ok({ received: false });
  }

  // Cloudflare sends the secret in the payload's `webhook` object.
  const secret = config.cloudflare.webhookSecret();
  if (secret && payload?.webhook?.secret !== secret) {
    return new Response(JSON.stringify({ error: "Invalid webhook secret" }), { status: 401 });
  }

  const event = payload?.message ?? payload;
  const uid: string | undefined = event?.uid ?? payload?.uid;
  const state: string | undefined = event?.status?.state ?? payload?.status?.state;

  if (!uid || !state) return ok({ received: true });

  const [row] = await db
    .select({ id: media.id, stream_uid: media.stream_uid, stream_status: media.stream_status })
    .from(media)
    .where(eq(media.stream_uid, uid))
    .limit(1);

  if (!row) {
    // Unknown uid — not one of our media rows (or already cleaned up).
    return ok({ received: true });
  }

  if (state === "ready") {
    const info = await getVideo(uid);
    const qualities = info ? buildStreamQualities(info) : [];
    await db
      .update(media)
      .set({
        stream_status: "ready",
        qualities: qualities.length > 0 ? JSON.stringify(qualities) : null,
      })
      .where(eq(media.id, row.id));
  } else if (state === "error" || state === "expired") {
    await db
      .update(media)
      .set({ stream_status: "error" })
      .where(eq(media.id, row.id));
  } else {
    // queued / processing — nothing to do yet.
    await db
      .update(media)
      .set({ stream_status: state === "queued" ? "processing" : state })
      .where(eq(media.id, row.id));
  }

  return ok({ received: true });
}
