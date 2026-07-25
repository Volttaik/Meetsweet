import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err, forbidden } from "@/lib/api/response";
import { uploadBlob, deleteBlob, getMediaType, getMaxBytes, resolveUrl } from "@/lib/services/blob";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { userId } = await params;
  if (auth.user.userId !== userId) return forbidden();

  const contentType = req.headers.get("content-type") ?? "";
  const mimeType = contentType.split(";")[0].trim();

  if (getMediaType(mimeType) !== "image") {
    return err("Only image files are allowed for banners", 422);
  }

  const blob = await req.blob();
  const max = getMaxBytes(mimeType);
  if (blob.size > max) return err(`File too large (max ${max / 1024 / 1024}MB)`, 413);

  // Delete old banner if present
  const [profile] = await db
    .select({ banner_url: profiles.banner_url })
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .limit(1);

  if (profile?.banner_url) {
    await deleteBlob(profile.banner_url);
  }

  const uploaded = await uploadBlob(blob, mimeType, `banners/${userId}`);

  await db
    .update(profiles)
    .set({ banner_url: uploaded.blob_path, updated_at: new Date().toISOString() })
    .where(eq(profiles.user_id, userId));

  return ok({ banner_url: await resolveUrl(uploaded.blob_path) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { userId } = await params;
  if (auth.user.userId !== userId) return forbidden();

  const [profile] = await db
    .select({ banner_url: profiles.banner_url })
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .limit(1);

  if (profile?.banner_url) {
    await deleteBlob(profile.banner_url);
  }

  await db
    .update(profiles)
    .set({ banner_url: null, updated_at: new Date().toISOString() })
    .where(eq(profiles.user_id, userId));

  return ok(null, "Banner removed");
}
