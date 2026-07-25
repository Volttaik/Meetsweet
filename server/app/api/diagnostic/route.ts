import { NextResponse } from "next/server";
import { createClient } from "@libsql/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENV_VARS = [
  { key: "TURSO_DATABASE_URL", label: "Turso Database URL", critical: true },
  { key: "TURSO_AUTH_TOKEN", label: "Turso Auth Token", critical: true },
  { key: "JWT_SECRET", label: "JWT Secret", critical: true },
  { key: "SESSION_SECRET", label: "Session Secret (JWT fallback)", critical: false },
  { key: "R2_ACCOUNT_ID", label: "Cloudflare R2 Account ID", critical: false },
  { key: "R2_ACCESS_KEY_ID", label: "Cloudflare R2 Access Key ID", critical: false },
  { key: "R2_SECRET_ACCESS_KEY", label: "Cloudflare R2 Secret Access Key", critical: false },
  { key: "R2_BUCKET_NAME", label: "Cloudflare R2 Bucket Name", critical: false },
  { key: "RESEND_API_KEY", label: "Resend API Key", critical: false },
  { key: "RESEND_FROM_EMAIL", label: "Resend From Email", critical: false },
  { key: "PAYSTACK_SECRET_KEY", label: "Paystack Secret Key", critical: false },
  { key: "APP_URL", label: "App URL", critical: false },
  { key: "CLIENT_APP_ID", label: "Client App ID", critical: false },
  { key: "CRON_SECRET", label: "Cron Secret", critical: false },
];

async function checkDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string; warning?: string }> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return { ok: false, error: "TURSO_DATABASE_URL not set" };

  try {
    const start = Date.now();
    const client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    await client.execute("SELECT 1");
    client.close();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function checkJwt(): { ok: boolean; error?: string } {
  const secret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) return { ok: false, error: "Neither JWT_SECRET nor SESSION_SECRET is set" };
  if (secret.length < 32) return { ok: false, error: `Secret too short: ${secret.length} chars (need ≥32)` };
  return { ok: true };
}

const API_ENDPOINTS = [
  { group: "Auth", endpoints: [
    "POST /api/auth/register",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/auth/refresh",
    "POST /api/auth/verify-email",
    "POST /api/auth/resend-verification",
    "POST /api/auth/forgot-password",
    "POST /api/auth/reset-password",
    "PATCH /api/auth/update-email",
    "PATCH /api/auth/update-password",
    "GET  /api/auth/username-availability",
    "DELETE /api/auth/delete-account",
  ]},
  { group: "Users / Profiles", endpoints: [
    "GET  /api/users/me",
    "POST /api/users/block",
    "POST /api/users/mute",
    "GET  /api/profiles/:userId",
    "PATCH /api/profiles/:userId",
    "POST /api/profiles/:userId/avatar",
    "POST /api/profiles/:userId/banner",
    "GET  /api/profiles/:userId/creator-settings",
    "PATCH /api/profiles/:userId/creator-settings",
  ]},
  { group: "Posts", endpoints: [
    "GET  /api/posts",
    "POST /api/posts",
    "GET  /api/posts/:postId",
    "PATCH /api/posts/:postId",
    "DELETE /api/posts/:postId",
    "POST /api/posts/:postId/like",
    "POST /api/posts/:postId/save",
    "POST /api/posts/:postId/hide",
    "POST /api/posts/:postId/pin",
    "POST /api/posts/:postId/publish",
    "POST /api/posts/:postId/archive",
    "POST /api/posts/:postId/restore",
    "POST /api/posts/:postId/report",
  ]},
  { group: "Comments", endpoints: [
    "GET  /api/posts/:postId/comments",
    "POST /api/posts/:postId/comments",
    "GET  /api/comments/:commentId",
    "PATCH /api/comments/:commentId",
    "DELETE /api/comments/:commentId",
    "POST /api/comments/:commentId/like",
    "POST /api/comments/:commentId/pin",
    "GET  /api/comments/:commentId/replies",
  ]},
  { group: "Messages", endpoints: [
    "GET  /api/messages/conversations",
    "POST /api/messages/conversations",
    "GET  /api/messages/conversations/:id",
    "PATCH /api/messages/conversations/:id",
    "DELETE /api/messages/conversations/:id",
    "GET  /api/messages/conversations/:id/messages",
    "POST /api/messages/conversations/:id/messages",
    "POST /api/messages/conversations/:id/read",
    "POST /api/messages/conversations/:id/mute",
    "POST /api/messages/conversations/:id/pin",
    "POST /api/messages/:messageId/react",
    "POST /api/messages/:messageId/recall",
    "DELETE /api/messages/:messageId",
  ]},
  { group: "Notifications", endpoints: [
    "GET  /api/notifications",
    "PATCH /api/notifications/:id",
    "POST /api/notifications/read-all",
  ]},
  { group: "Creator", endpoints: [
    "POST /api/creator/become",
    "GET  /api/creator/analytics",
    "POST /api/creator/verification",
  ]},
  { group: "Subscriptions & Payments", endpoints: [
    "GET  /api/subscriptions",
    "POST /api/subscriptions",
    "POST /api/subscriptions/:id/cancel",
    "POST /api/payments/initialize",
    "POST /api/payments/verify",
    "POST /api/payments/webhook",
    "GET  /api/wallet",
  ]},
  { group: "Search & Misc", endpoints: [
    "GET  /api/search",
    "GET  /api/search/recent",
    "POST /api/uploads",
    "POST /api/archive",
    "GET  /api/healthz",
    "POST /api/cron/daily",
  ]},
];

export async function GET() {
  const [dbResult] = await Promise.all([checkDatabase()]);
  const jwtResult = checkJwt();

  const envStatus = ENV_VARS.map(({ key, label, critical }) => ({
    key,
    label,
    critical,
    set: !!process.env[key],
    hint: key === "TURSO_DATABASE_URL" && process.env[key]
      ? process.env[key]!.replace(/\/\/.*@/, "//***@").substring(0, 40) + "..."
      : undefined,
  }));

  const missingCritical = envStatus.filter((e) => e.critical && !e.set).map((e) => e.key);

  return NextResponse.json({
    server: "MeetSweet API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "development",
    health: {
      database: dbResult,
      jwt: jwtResult,
      blob: {
        ok: !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME),
        note: !(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME)
          ? `R2 credentials incomplete — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME`
          : "Cloudflare R2 credentials present",
      },
      email: {
        ok: !!process.env.RESEND_API_KEY,
        note: !process.env.RESEND_API_KEY ? "RESEND_API_KEY not set — email features will fail" : undefined,
      },
      payments: {
        ok: !!process.env.PAYSTACK_SECRET_KEY,
        note: !process.env.PAYSTACK_SECRET_KEY ? "PAYSTACK_SECRET_KEY not set — payments will fail" : undefined,
      },
    },
    envStatus,
    missingCritical,
    ready: missingCritical.length === 0 && dbResult.ok && jwtResult.ok,
    apiEndpoints: API_ENDPOINTS,
  });
}
