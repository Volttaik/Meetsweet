/**
 * POST /api/private-message-attachments/:id/purchase
 * Unlock a priced reply attachment. Only the original message's sender may
 * purchase; the claim + debit are atomic so a retry or a racing duplicate can
 * never charge the wallet twice. Returns the unlocked attachment (with URL).
 */

import type { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { err, ok } from "@/lib/api/response";
import { purchaseAttachment, PrivateInboxError } from "@/lib/services/private-inbox";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  try {
    const result = await purchaseAttachment(auth.user.userId, id);
    return ok(result);
  } catch (error) {
    if (error instanceof PrivateInboxError) {
      const status =
        error.code === "NOT_FOUND" ? 404
        : error.code === "FORBIDDEN" ? 403
        : error.code === "INSUFFICIENT_BALANCE" ? 402
        : 400;
      return err(error.message, status, error.code);
    }
    console.error("[private-message-attachments] purchase failed:", error);
    return err("Could not complete the purchase", 500);
  }
}
