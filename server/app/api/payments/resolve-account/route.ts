import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { resolveAccountName } from "@/lib/services/paystack";

/**
 * GET /api/payments/resolve-account?account_number=&bank_code=
 *
 * Resolves the real account-holder name via Paystack so the client never trusts
 * a user-typed account name for a withdrawal.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const accountNumber =
    req.nextUrl.searchParams.get("account_number") ??
    req.nextUrl.searchParams.get("accountNumber") ??
    "";
  const bankCode =
    req.nextUrl.searchParams.get("bank_code") ??
    req.nextUrl.searchParams.get("bankCode") ??
    "";

  if (!accountNumber || !bankCode) {
    return err("account_number and bank_code are required", 400);
  }

  try {
    const accountName = await resolveAccountName(accountNumber, bankCode);
    return ok({ account_name: accountName, accountName });
  } catch (e) {
    return err(
      e instanceof Error ? e.message : "Could not resolve account",
      502,
      "PAYSTACK_RESOLVE_FAILED",
    );
  }
}
