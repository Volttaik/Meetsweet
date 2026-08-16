/**
 * Paystack service — thin wrapper over the Paystack HTTP API.
 *
 * Covers:
 *   • bank list + account-name resolution (payout setup)
 *   • single transfers (real money payouts to a creator's bank account)
 *   • webhook signature verification (HMAC-SHA512)
 *
 * Keeps the secret key server-side so the mobile app never holds it.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { config } from "@/lib/config";

const PAYSTACK_API = "https://api.paystack.co";

export interface PaystackBank {
  name: string;
  code: string;
}

export type PaystackTransferStatus = "otp" | "pending" | "success" | "failed";

export interface PaystackTransfer {
  transferCode: string;
  status: PaystackTransferStatus;
  reference: string;
}

function secretKey(): string | null {
  return config.paystack.secretKey() ?? null;
}

// ─── Bank list & account resolution ──────────────────────────────────────────

/** Supported Nigerian banks (Paystack is the source of truth for bank codes). */
export async function listBanks(): Promise<PaystackBank[]> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const res = await fetch(`${PAYSTACK_API}/bank?currency=NGN&perPage=100`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: Array<{ name: string; code: string }>;
  };

  if (!res.ok || !json.status || !Array.isArray(json.data)) {
    throw new Error(json.message ?? "Failed to load banks");
  }
  return json.data
    .map((b) => ({ name: b.name, code: b.code }))
    .filter((b) => b.name && b.code);
}

/** Resolve the account holder name for a given account number + bank code. */
export async function resolveAccountName(
  accountNumber: string,
  bankCode: string,
): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const qs = new URLSearchParams({
    account_number: accountNumber,
    bank_code: bankCode,
  });
  const res = await fetch(`${PAYSTACK_API}/bank/resolve?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { account_name?: string };
  };

  if (!res.ok || !json.status || !json.data?.account_name) {
    throw new Error(json.message ?? "Could not resolve account name");
  }
  return json.data.account_name;
}

// ─── Transfers (payouts) ─────────────────────────────────────────────────────

/** Create a NUBAN transfer recipient; returns its `recipient_code`. */
export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const res = await fetch(`${PAYSTACK_API}/transferrecipient`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "nuban",
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: "NGN",
    }),
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { recipient_code?: string };
  };

  if (!res.ok || !json.status || !json.data?.recipient_code) {
    throw new Error(json.message ?? "Could not create transfer recipient");
  }
  return json.data.recipient_code;
}

/**
 * Initiate a single transfer from the platform Paystack balance to a recipient.
 * `amountNaira` is converted to kobo. Returns the transfer code + status.
 * A status of "otp" means the transfer needs finalizing with an OTP.
 */
export async function initiateTransfer(params: {
  recipientCode: string;
  amountNaira: number;
  reference: string;
  reason?: string;
}): Promise<PaystackTransfer> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const res = await fetch(`${PAYSTACK_API}/transfer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "balance",
      amount: Math.round(params.amountNaira * 100),
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason ?? "MeetSweet payout",
      currency: "NGN",
    }),
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { transfer_code?: string; status?: string; reference?: string };
  };

  if (!res.ok || !json.status || !json.data) {
    throw new Error(json.message ?? "Could not initiate transfer");
  }
  return {
    transferCode: json.data.transfer_code ?? "",
    status: (json.data.status as PaystackTransferStatus) ?? "pending",
    reference: json.data.reference ?? params.reference,
  };
}

/** Finalize a transfer that was returned with status "otp". */
export async function finalizeTransfer(
  transferCode: string,
  otp: string,
): Promise<PaystackTransfer> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const res = await fetch(`${PAYSTACK_API}/transfer/finalize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transfer_code: transferCode, otp }),
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { transfer_code?: string; status?: string; reference?: string };
  };

  if (!res.ok || !json.status || !json.data) {
    throw new Error(json.message ?? "Could not finalize transfer");
  }
  return {
    transferCode: json.data.transfer_code ?? transferCode,
    status: (json.data.status as PaystackTransferStatus) ?? "pending",
    reference: json.data.reference ?? "",
  };
}

/** Fetch a transfer's current status (used for reconciliation). */
export async function fetchTransfer(
  transferCode: string,
): Promise<{ status: string; reference?: string }> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const res = await fetch(
    `${PAYSTACK_API}/transfer/${encodeURIComponent(transferCode)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { status?: string; reference?: string };
  };
  if (!res.ok || !json.status || !json.data) {
    throw new Error(json.message ?? "Could not fetch transfer");
  }
  return { status: json.data.status ?? "unknown", reference: json.data.reference };
}

// ─── Webhook signature verification ──────────────────────────────────────────

/** Verify a Paystack webhook using the x-paystack-signature HMAC-SHA512. */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const key = secretKey();
  if (!key || !signature) return false;
  const expected = createHmac("sha512", key).update(payload, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
