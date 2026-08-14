import { Resend } from "resend";
import { config } from "@/lib/config";

/**
 * MeetSweet transactional email service (Resend).
 *
 * Design system notes:
 *  - Table-based layout with inline styles only — no JavaScript, no external CSS,
 *    no CSS features that Gmail/Outlook strip (no clip-path, no backdrop-filter,
 *    no flexbox, no <style> blocks relied upon).
 *  - The real brand logo is referenced as a hosted asset served from this
 *    deployment's public origin, so it always resolves for the recipient.
 *  - CSS gradients provide the "designed background" without a large raster
 *    image; a solid background-color fallback keeps the email usable in
 *    clients that ignore background-image.
 *  - The wordmark is rendered as text next to the logo so the brand is still
 *    visible even when the image is blocked.
 */

// ─── Brand tokens ────────────────────────────────────────────────────────────

const ACCENT = "#C45A72";
const BG = "#0C0C0F";
const CARD = "#141419";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "#FFFFFF";
const TEXT_2 = "rgba(255,255,255,0.62)";
const TEXT_3 = "rgba(255,255,255,0.34)";
const FONT = "'Poppins','Helvetica Neue',Helvetica,Arial,sans-serif";

// ─── Provider ────────────────────────────────────────────────────────────────

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    const apiKey = config.resend.apiKey();
    if (!apiKey) throw new Error("RESEND_API_KEY is required");
    resend = new Resend(apiKey);
  }
  return resend;
}

/** Sender address with a friendly display name. */
function sender(): string {
  const s = config.resend.sender();
  if (!s) throw new Error("VERIFIED_SENDER_EMAIL is required");
  return s.includes("<") ? s : `MeetSweet <${s}>`;
}

/** Absolute URL of the hosted brand logo. */
function logoUrl(): string {
  const base = (config.app.publicUrl() ?? "https://meetsweet.space").replace(/\/+$/, "");
  return `${base}/meetsweet-logo.png`;
}

// ─── Delivery (with diagnostics) ─────────────────────────────────────────────

async function deliver(
  kind: string,
  opts: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  try {
    await getResend().emails.send({
      from: sender(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
  } catch (error) {
    // Log a useful diagnostic without leaking provider secrets. Resend errors
    // do not contain the API key, but we deliberately avoid dumping the raw
    // error object in case a future SDK version includes request metadata.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[email] failed to send ${kind} email to ${opts.to}: ${message}`);
    throw error;
  }
}

// ─── Shared components ───────────────────────────────────────────────────────

function logoHeader(): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 36px auto;">
      <tr>
        <td style="width:36px;height:36px;vertical-align:middle;">
          <img src="${logoUrl()}" alt="MeetSweet" width="36" height="36"
            style="display:block;width:36px;height:36px;border-radius:10px;background-color:#ffffff;border:0;" />
        </td>
        <td style="padding-left:12px;vertical-align:middle;">
          <span style="font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:-0.5px;color:${TEXT};">
            Meet<span style="color:${ACCENT};">Sweet</span>
          </span>
        </td>
      </tr>
    </table>`;
}

function heading(text: string): string {
  return `
    <h1 style="margin:0 0 10px 0;font-size:26px;line-height:1.2;font-weight:700;color:${TEXT};
      font-family:${FONT};letter-spacing:-0.4px;text-align:center;">${text}</h1>`;
}

function subheading(text: string): string {
  return `
    <p style="margin:0 0 32px 0;font-size:15px;line-height:1.6;color:${TEXT_2};
      font-family:${FONT};text-align:center;">${text}</p>`;
}

function divider(): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
      <tr><td style="height:1px;font-size:0;line-height:0;background-color:${BORDER};"></td></tr>
    </table>`;
}

function codeLabel(): string {
  return `
    <p style="margin:0 0 18px 0;font-size:11px;font-weight:700;letter-spacing:2.5px;
      color:${ACCENT};text-align:center;text-transform:uppercase;font-family:${FONT};">
      Your verification code
    </p>`;
}

function codeBox(code: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:20px 32px;background-color:rgba(255,255,255,0.04);
                border:1px solid ${BORDER};border-radius:14px;">
                <span style="font-family:${FONT};font-size:36px;font-weight:800;letter-spacing:16px;
                  color:${TEXT};line-height:1;white-space:nowrap;">${code}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0 0;font-size:13px;color:${TEXT_3};text-align:center;font-family:${FONT};">
      Tap and hold the code to copy it
    </p>`;
}

function expiryPill(minutes: number): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:8px 20px;background-color:rgba(255,255,255,0.05);
                border:1px solid ${BORDER};border-radius:100px;">
                <span style="font-size:13px;color:${TEXT_2};font-family:${FONT};">
                  Expires in <strong style="color:${TEXT};font-weight:700;">${minutes} minutes</strong>
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function securityNote(text: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
      <tr>
        <td style="padding:16px 20px;background-color:rgba(255,255,255,0.03);
          border:1px solid ${BORDER};border-radius:12px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:${TEXT_3};
            font-family:${FONT};text-align:center;">${text}</p>
        </td>
      </tr>
    </table>`;
}

function footer(): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:36px;">
      <tr>
        <td align="center">
          <p style="margin:0 0 6px 0;font-size:13px;color:${TEXT_3};font-family:${FONT};">
            You're receiving this email because you have a MeetSweet account.
          </p>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.20);font-family:${FONT};">
            © ${new Date().getFullYear()} MeetSweet · All rights reserved
          </p>
        </td>
      </tr>
    </table>`;
}

/** Full email document shell. */
function shell(opts: { preheader: string; content: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>MeetSweet</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preheader preview text -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${opts.preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <!-- Designed background: solid fallback + gradient accents -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:${BG};background-image:radial-gradient(ellipse 80% 45% at 50% -10%, rgba(196,90,114,0.18) 0%, rgba(196,90,114,0) 62%),linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%);">
    <tr>
      <td align="center" style="padding:44px 16px 48px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
          style="width:100%;max-width:600px;">

          <tr><td>${logoHeader()}</td></tr>

          <tr>
            <td style="background-color:${CARD};border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">
              <!-- Accent top band -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="height:4px;font-size:0;line-height:0;
                    background-color:${ACCENT};background-image:linear-gradient(90deg, rgba(196,90,114,0) 0%, ${ACCENT} 50%, rgba(196,90,114,0) 100%);"></td>
                </tr>
              </table>
              <!-- Card content -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:40px 40px 44px 40px;">
                    ${opts.content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr><td>${footer()}</td></tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Verification email ──────────────────────────────────────────────────────

export async function sendVerificationEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const code = String(opts.code).replace(/\D/g, "");

  const content = `
    ${heading("Verify your email")}
    ${subheading(
      `Hi ${firstName}, enter the code below to activate your MeetSweet account.`,
    )}
    ${divider()}
    ${codeLabel()}
    ${codeBox(code)}
    ${expiryPill(15)}
    ${securityNote(
      "If you didn't create a MeetSweet account, you can safely ignore this email. Never share this code with anyone.",
    )}
  `;

  const html = shell({
    preheader: `Your MeetSweet verification code is ${code}`,
    content,
  });

  const text = [
    "MeetSweet — Verify your email",
    "",
    `Hi ${firstName}, use the code below to activate your MeetSweet account:`,
    "",
    code,
    "",
    "This code expires in 15 minutes.",
    "If you didn't create an account, you can safely ignore this email.",
  ].join("\n");

  await deliver("verification", {
    to: opts.to,
    subject: "Your MeetSweet verification code",
    html,
    text,
  });
}

// ─── Password reset email ────────────────────────────────────────────────────

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const code = String(opts.code).replace(/\D/g, "");

  const content = `
    ${heading("Reset your password")}
    ${subheading(
      `Hi ${firstName}, use the code below to set a new password for your MeetSweet account.`,
    )}
    ${divider()}
    ${codeLabel()}
    ${codeBox(code)}
    ${expiryPill(15)}
    ${securityNote(
      "Didn't request a password reset? No action needed — your password is unchanged. Never share this code with anyone.",
    )}
  `;

  const html = shell({
    preheader: `Your MeetSweet password reset code is ${code}`,
    content,
  });

  const text = [
    "MeetSweet — Reset your password",
    "",
    `Hi ${firstName}, use the code below to set a new password:`,
    "",
    code,
    "",
    "This code expires in 15 minutes.",
    "If you didn't request a reset, no action is needed — your password is unchanged.",
  ].join("\n");

  await deliver("password_reset", {
    to: opts.to,
    subject: "Reset your MeetSweet password",
    html,
    text,
  });
}

// ─── Payment / wallet emails ─────────────────────────────────────────────

function formatMoney(amount: number, currency: string): string {
  const symbol = currency.toUpperCase() === "NGN" ? "₦" : `${currency} `;
  const [int, frac] = amount.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${symbol}${grouped}.${frac}`;
}

function amountHighlight(amount: number, currency: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
      <tr>
        <td align="center">
          <p style="margin:0 0 10px 0;font-size:11px;font-weight:700;letter-spacing:2.5px;
            color:${ACCENT};text-transform:uppercase;font-family:${FONT};">Amount</p>
          <p style="margin:0;font-size:40px;font-weight:800;letter-spacing:-1px;line-height:1.1;
            color:${TEXT};font-family:${FONT};">${formatMoney(amount, currency)}</p>
        </td>
      </tr>
    </table>`;
}

function detailRows(rows: [string, string][]): string {
  const trs = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 0;font-size:12px;letter-spacing:1px;text-transform:uppercase;
            color:${TEXT_3};font-family:${FONT};">${label}</td>
          <td style="padding:10px 0;font-size:14px;font-weight:600;color:${TEXT};
            font-family:${FONT};text-align:right;">${value}</td>
        </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin:0 0 24px 0;border-top:1px solid ${BORDER};">
      ${trs}
    </table>`;
}

/** Wallet top-up confirmed. */
export async function sendWalletDepositEmail(opts: {
  to: string;
  name: string;
  amount: number;
  currency: string;
  newBalance: number;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const currency = opts.currency || "NGN";

  const content = `
    ${heading("Wallet topped up")}
    ${subheading(
      `Hi ${firstName}, your MeetSweet wallet has been credited successfully.`,
    )}
    ${amountHighlight(opts.amount, currency)}
    ${detailRows([
      ["New balance", formatMoney(opts.newBalance, currency)],
      ["Method", "Paystack"],
    ])}
    ${securityNote(
      "If you didn't make this payment, please contact MeetSweet support immediately.",
    )}
  `;

  const html = shell({
    preheader: `Your MeetSweet wallet was credited with ${formatMoney(opts.amount, currency)}`,
    content,
  });

  const text = [
    "MeetSweet — Wallet topped up",
    "",
    `Hi ${firstName}, your wallet has been credited with ${formatMoney(opts.amount, currency)}.`,
    `New balance: ${formatMoney(opts.newBalance, currency)}`,
    "",
    "If you didn't make this payment, please contact support immediately.",
  ].join("\n");

  await deliver("wallet_deposit", {
    to: opts.to,
    subject: `Your MeetSweet wallet was topped up with ${formatMoney(opts.amount, currency)}`,
    html,
    text,
  });
}

/** Withdrawal request received (pending payout). */
export async function sendWithdrawalRequestedEmail(opts: {
  to: string;
  name: string;
  amount: number;
  currency: string;
  bankName?: string | null;
  accountNumber?: string | null;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const currency = opts.currency || "NGN";
  const maskedAccount = opts.accountNumber
    ? `ending in ${opts.accountNumber.slice(-4)}`
    : "your saved account";

  const content = `
    ${heading("Withdrawal requested")}
    ${subheading(
      `Hi ${firstName}, we've received your request to withdraw funds from your MeetSweet wallet.`,
    )}
    ${amountHighlight(opts.amount, currency)}
    ${detailRows([
      ["Destination", opts.bankName ? `${opts.bankName} ${maskedAccount}` : maskedAccount],
      ["Status", "Processing"],
    ])}
    ${securityNote(
      "Withdrawals are typically processed within 1–3 business days. If you didn't request this, contact support immediately.",
    )}
  `;

  const html = shell({
    preheader: `Your ${formatMoney(opts.amount, currency)} withdrawal request was received`,
    content,
  });

  const text = [
    "MeetSweet — Withdrawal requested",
    "",
    `Hi ${firstName}, we've received your request to withdraw ${formatMoney(opts.amount, currency)}.`,
    `Destination: ${opts.bankName ? `${opts.bankName} ${maskedAccount}` : maskedAccount}`,
    "",
    "Withdrawals are typically processed within 1–3 business days.",
    "If you didn't request this, contact support immediately.",
  ].join("\n");

  await deliver("withdrawal", {
    to: opts.to,
    subject: `Your ${formatMoney(opts.amount, currency)} withdrawal request was received`,
    html,
    text,
  });
}
