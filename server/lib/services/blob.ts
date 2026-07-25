// Cloudflare R2 is now the storage provider.
// This file re-exports everything from r2.ts for backward compatibility.
export {
  uploadBlob,
  deleteBlob,
  resolveUrl,
  resolveUrls,
  getMediaType,
  getMaxBytes,
  getAllowedTypes,
  type UploadedMedia,
} from "@/lib/services/r2";
