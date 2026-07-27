import { NextRequest } from "next/server";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { shares } from "@/lib/db/schema";
import { ok, err } from "@/lib/api/response";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const now = new Date().toISOString();

  const [share] = await db
    .select({
      id: shares.id,
      content_type: shares.content_type,
      content_id: shares.content_id,
      token: shares.token,
      expires_at: shares.expires_at,
      created_at: shares.created_at,
    })
    .from(shares)
    .where(
      and(
        eq(shares.token, token),
        // Allow expired shares to still resolve (for deep-linking graceful degradation)
      ),
    )
    .limit(1);

  if (!share) return err("Share link not found", 404);

  return ok({
    content_type: share.content_type,
    content_id: share.content_id,
    token: share.token,
    expires_at: share.expires_at,
  });
}
