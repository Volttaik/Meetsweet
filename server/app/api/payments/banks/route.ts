import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { listBanks } from "@/lib/services/paystack";

/**
 * GET /api/payments/banks
 *
 * Returns the authoritative Nigerian bank list from Paystack so the client
 * never hardcodes bank names/codes. Cache-friendly; the list changes rarely.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  try {
    const banks = await listBanks();
    return ok({ banks });
  } catch (e) {
    return err(
      e instanceof Error ? e.message : "Failed to load banks",
      502,
      "PAYSTACK_BANKS_FAILED",
    );
  }
}
