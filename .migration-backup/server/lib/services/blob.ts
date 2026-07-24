import { put, del, type PutBlobResult } from "@vercel/blob";

export type UploadedMedia = {
  url: string;
  blob_path: string;
  size_bytes: number;
  mime_type: string;
};

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;  // 50 MB

export function getAllowedTypes() {
  return [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];
}

export function getMediaType(mimeType: string): "image" | "video" | "audio" | null {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return "image";
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return "video";
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return "audio";
  return null;
}

export function getMaxBytes(mimeType: string): number {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return MAX_IMAGE_BYTES;
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return MAX_VIDEO_BYTES;
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return MAX_AUDIO_BYTES;
  return 0;
}

export async function uploadBlob(
  file: Blob,
  mimeType: string,
  folder: string
): Promise<UploadedMedia> {
  const ext = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
  const filename = `${folder}/${crypto.randomUUID()}.${ext}`;

  const blob: PutBlobResult = await put(filename, file, {
    access: "public",
    contentType: mimeType,
  });

  return {
    url: blob.url,
    blob_path: blob.pathname,
    size_bytes: file.size,
    mime_type: mimeType,
  };
}

export async function deleteBlob(blobPath: string): Promise<void> {
  try {
    await del(blobPath);
  } catch {
    // Best-effort; log in production
    console.error("Failed to delete blob:", blobPath);
  }
}
