/**
 * Cloudflare Stream — HLS transcoding + delivery for long-form videos.
 *
 * The platform stores the original MP4 in R2; for video uploads we ask Stream
 * to pull that URL, transcode it into an adaptive HLS manifest (1080p → 360p +
 * audio), and deliver playback from the Cloudflare edge. This is what makes a
 * real multi-quality selector possible: the HLS manifest exposes distinct
 * renditions, and the player picks one via `selectedVideoTrack`.
 *
 * Everything here is a no-op when Stream is not configured (no
 * CLOUDFLARE_API_TOKEN), which keeps the existing single-MP4 pipeline working
 * unchanged. Media rows simply stay in the "none"/"processing" state.
 */

import { config } from "@/lib/config";

const API = "https://api.cloudflare.com/client/v4";

export interface StreamQuality {
  /** Label shown in the player's quality selector ("Auto", "1080p", …). */
  label: string;
  /** Playback URL — the HLS manifest (shared by all renditions). */
  url: string;
  /** Rendition height in pixels; null for "Auto". */
  height: number | null;
  /** Index of this rendition inside the HLS manifest (for track selection). */
  index: number | null;
}

export interface StreamVideoInfo {
  uid: string;
  state: "queued" | "processing" | "ready" | "error" | "live-in-progress" | string;
  hlsUrl: string | null;
  mpegUrl: string | null;
  /** Parsed renditions from the HLS manifest, highest first. */
  renditions: Array<{ height: number; index: number }>;
}

export function streamConfigured(): boolean {
  return Boolean(config.cloudflare.apiToken() && config.cloudflare.accountId());
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.cloudflare.apiToken()}`,
    "Content-Type": "application/json",
  };
}

/**
 * Tell Cloudflare Stream to pull a source URL and transcode it. Fire-and-forget
 * from the upload route — completion arrives via webhook (or on-read polling).
 */
export async function pullVideoFromUrl(
  sourceUrl: string,
  meta: { postId?: string | null; uploaderId: string; mediaId: string },
): Promise<{ uid: string } | null> {
  if (!streamConfigured() || !sourceUrl.startsWith("http")) return null;
  try {
    const res = await fetch(
      `${API}/accounts/${config.cloudflare.accountId()}/stream`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          url: sourceUrl,
          meta: {
            media_id: meta.mediaId,
            post_id: meta.postId ?? "",
            uploader_id: meta.uploaderId,
          },
        }),
      },
    );
    if (!res.ok) {
      console.error(`[stream] pull failed (${res.status}):`, (await res.text()).slice(0, 300));
      return null;
    }
    const body = (await res.json()) as { success: boolean; result?: { uid: string } };
    if (!body.success || !body.result?.uid) return null;
    return { uid: body.result.uid };
  } catch (e) {
    console.error("[stream] pull error:", e);
    return null;
  }
}

/** Fetch a video's playback details from Stream. */
export async function getVideo(uid: string): Promise<StreamVideoInfo | null> {
  if (!streamConfigured() || !uid) return null;
  try {
    const res = await fetch(
      `${API}/accounts/${config.cloudflare.accountId()}/stream/${uid}`,
      { method: "GET", headers: headers() },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      success: boolean;
      result?: {
        uid: string;
        status?: { state?: string };
        playback?: { hls?: string; dash?: string; mpeg?: string };
      };
    };
    if (!body.success || !body.result) return null;
    const r = body.result;
    const hlsUrl = r.playback?.hls ?? null;
    const renditions = hlsUrl ? await parseHlsRenditions(hlsUrl) : [];
    return {
      uid: r.uid,
      state: r.status?.state ?? "processing",
      hlsUrl,
      mpegUrl: r.playback?.mpeg ?? null,
      renditions,
    };
  } catch (e) {
    console.error("[stream] getVideo error:", e);
    return null;
  }
}

/**
 * Fetch the HLS manifest and extract rendition heights in manifest order.
 * Stream returns `#EXT-X-STREAM-INF:...RESOLUTION=1920x1080` per variant.
 */
export async function parseHlsRenditions(manifestUrl: string): Promise<Array<{ height: number; index: number }>> {
  try {
    const res = await fetch(manifestUrl, { method: "GET" });
    if (!res.ok) return [];
    const text = await res.text();
    const renditions: Array<{ height: number; index: number }> = [];
    let index = 0;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
      const m = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      if (m) renditions.push({ height: Number(m[2]), index });
      index++;
    }
    // Highest resolution first (matches player expectations + "Auto" default).
    return renditions.sort((a, b) => b.height - a.height);
  } catch {
    return [];
  }
}

/**
 * Build the server-authoritative `qualities` list for a ready Stream video.
 * All variants share the HLS manifest URL; the player selects the actual
 * rendition via the manifest `index`. An MP4 fallback entry is included for
 * clients that cannot play HLS.
 */
export function buildStreamQualities(
  info: Pick<StreamVideoInfo, "hlsUrl" | "mpegUrl" | "renditions">,
): StreamQuality[] {
  const out: StreamQuality[] = [];
  if (!info.hlsUrl) return out;

  out.push({ label: "Auto", url: info.hlsUrl, height: null, index: null });
  for (const r of info.renditions) {
    out.push({
      label: `${r.height}p`,
      url: info.hlsUrl,
      height: r.height,
      index: r.index,
    });
  }
  if (info.mpegUrl && info.renditions.length > 0) {
    const top = info.renditions[0].height;
    out.push({ label: "Original", url: info.mpegUrl, height: top, index: null });
  }
  return out;
}
