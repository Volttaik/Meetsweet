import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err, forbidden } from "@/lib/api/response";
import { uploadBlob, deleteBlob, getMediaType, getMaxBytes } from "@/lib/services/blob";

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
    return err("Only image files are allowed for avatars", 422);
  }

  const blob = await req.blob();
  const max = getMaxBytes(mimeType);
  if (blob.size > max) return err(`File too large (max ${max / 1024 / 1024}MB)`, 413);

  // Delete old avatar blob if present
  const [profile] = await db
    .select({ avatar_url: profiles.avatar_url })
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .limit(1);

  const uploaded = await uploadBlob(blob, mimeType, `avatars/${userId}`);

  await db
    .update(profiles)
    .set({ avatar_url: uploaded.url, updated_at: new Date().toISOString() })
    .where(eq(profiles.user_id, userId));

  return ok({ avatar_url: uploaded.url });
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
    .select({ avatar_url: profiles.avatar_url })
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .limit(1);

  if (profile?.avatar_url) {
    const path = new URL(profile.avatar_url).pathname.slice(1);
    await deleteBlob(path);
  }

  await db
    .update(profiles)
    .set({ avatar_url: null, updated_at: new Date().toISOString() })
    .where(eq(profiles.user_id, userId));

  return ok(null, "Avatar removed");
}
