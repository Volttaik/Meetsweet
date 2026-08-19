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

// ─── Customers & dedicated virtual accounts (in-app deposits) ────────────────

/**
 * Create (or fetch — Paystack returns the existing code for a known email) a
 * Paystack customer and return its `customer_code`. This code is the stable
 * handle we store on a pending deposit so incoming dedicated-NUBAN transfers
 * can be matched back to the right wallet.
 */
export async function ensureCustomer(params: {
  email: string;
  firstName?: string;
  lastName?: string;
}): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const res = await fetch(`${PAYSTACK_API}/customer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      first_name: params.firstName,
      last_name: params.lastName,
    }),
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { customer_code?: string };
  };

  if (!res.ok || !json.status || !json.data?.customer_code) {
    throw new Error(json.message ?? "Could not create Paystack customer");
  }
  return json.data.customer_code;
}

export interface PaystackDedicatedAccount {
  accountNumber: string;
  accountName: string;
  bankName: string;
  customerCode: string;
  expiresAt: string | null;
}

/** Preferred virtual-account issuers, tried in order. Paystack Titan is the
 *  current default issuer; Wema is the legacy fallback. */
const DVA_PREFERRED_BANKS = ["titan-paystack", "wema-bank"];

/**
 * Assign a temporary dedicated virtual NUBAN account for a one-time amount.
 * Incoming bank transfers to this account surface as `charge.success` webhooks
 * with `channel: "dedicated_nuban"` — the authoritative credit signal.
 *
 * Requires the business Paystack account to have the Dedicated Virtual Account
 * (DVA) product enabled. When it is not enabled Paystack rejects the request
 * and we surface a PAYSTACK_DVA_UNAVAILABLE error rather than falling back to
 * the hosted checkout.
 */
export async function assignDedicatedAccount(params: {
  customerCode: string;
  amountNaira: number;
  firstName?: string;
  lastName?: string;
}): Promise<PaystackDedicatedAccount> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  let lastError = "";
  for (const preferredBank of DVA_PREFERRED_BANKS) {
    const res = await fetch(`${PAYSTACK_API}/dedicated_account/assign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer: params.customerCode,
        preferred_bank: preferredBank,
        first_name: params.firstName,
        last_name: params.lastName,
        amount: Math.round(params.amountNaira * 100),
      }),
    });
    const json = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: {
        account_number?: string;
        account_name?: string;
        bank?: { name?: string };
        customer?: { customer_code?: string };
        assignment?: { expires_at?: string | null };
      };
    };

    if (res.ok && json.status && json.data?.account_number) {
      return {
        accountNumber: json.data.account_number,
        accountName: json.data.account_name ?? "",
        bankName: json.data.bank?.name ?? "Paystack",
        customerCode: json.data.customer?.customer_code ?? params.customerCode,
        expiresAt: json.data.assignment?.expires_at ?? null,
      };
    }
    lastError = json.message ?? "Could not assign dedicated account";
  }

  throw new Error(lastError || "Could not assign dedicated account");
}

export interface PaystackReceivedTransfer {
  reference: string;
  amountNaira: number;
  status: string;
  channel: string;
  customerCode: string;
  createdAt: string;
}

/**
 * List a customer's recent Paystack transactions. Used by the confirm step to
 * independently verify that a dedicated-NUBAN bank transfer has actually been
 * received before the wallet is credited (the "Confirm Transaction" button is
 * never trusted on its own).
 */
export async function listCustomerTransactions(
  customerCode: string,
): Promise<PaystackReceivedTransfer[]> {
  const key = secretKey();
  if (!key) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const qs = new URLSearchParams({ customer: customerCode, perPage: "50" });
  const res = await fetch(`${PAYSTACK_API}/transaction?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: Array<{
      reference?: string;
      amount?: number;
      status?: string;
      channel?: string;
      customer?: { customer_code?: string };
      createdAt?: string;
    }>;
  };

  if (!res.ok || !json.status || !Array.isArray(json.data)) {
    throw new Error(json.message ?? "Could not list Paystack transactions");
  }

  return json.data.map((t) => ({
    reference: t.reference ?? "",
    amountNaira: Math.round((t.amount ?? 0) / 100),
    status: t.status ?? "",
    channel: t.channel ?? "",
    customerCode: t.customer?.customer_code ?? "",
    createdAt: t.createdAt ?? "",
  }));
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
