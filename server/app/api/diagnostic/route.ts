import { NextResponse } from "next/server";
import { createClient } from "@libsql/client";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENV_VARS = [
  { key: "TURSO_DATABASE_URL", label: "Turso Database URL", critical: true },
  { key: "TURSO_AUTH_TOKEN", label: "Turso Auth Token", critical: true },
  { key: "JWT_SECRET", label: "JWT Secret", critical: false },
  { key: "SESSION_SECRET", label: "Session Secret (JWT fallback)", critical: false },
  { key: "R2_ACCOUNT_ID", label: "R2 Account ID", critical: true },
  { key: "R2_ACCESS_KEY_ID", label: "R2 Access Key ID", critical: true },
  { key: "R2_SECRET_ACCESS_KEY", label: "R2 Secret Access Key", critical: true },
  { key: "R2_BUCKET_NAME", label: "R2 Bucket Name", critical: true },
  { key: "RESEND_API_KEY", label: "Resend API Key", critical: false },
  { key: "RESEND_FROM_EMAIL", label: "Resend From Email", critical: false },
  { key: "PAYSTACK_SECRET_KEY", label: "Paystack Secret Key", critical: false },
  { key: "PAYSTACK_PUBLIC_KEY", label: "Paystack Public Key", critical: false },
  { key: "R2_PUBLIC_BASE_URL", label: "R2 Public Base URL (optional CDN)", critical: false },
  { key: "APP_URL", label: "App URL", critical: false },
  { key: "CLIENT_APP_ID", label: "Client App ID", critical: false },
];

async function checkDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return { ok: false, error: "TURSO_DATABASE_URL not set" };
  try {
    const start = Date.now();
    const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    await client.execute("SELECT 1");
    client.close();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkR2(): Promise<{ ok: boolean; error?: string }> {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return { ok: false, error: "One or more R2 env vars missing" };
  }
  try {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
    await client.send(new HeadBucketCommand({ Bucket: R2_BUCKET_NAME }));
    return { ok: true };
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

export async function GET() {
  const [db, r2] = await Promise.all([checkDatabase(), checkR2()]);
  const jwt = checkJwt();

  const envStatus = ENV_VARS.map(({ key, label, critical }) => ({
    key,
    label,
    critical,
    set: !!process.env[key],
  }));

  const missingCritical = envStatus.filter((e) => e.critical && !e.set);
  const healthy = db.ok && r2.ok && jwt.ok && missingCritical.length === 0;

  return NextResponse.json(
    {
      ok: healthy,
      timestamp: new Date().toISOString(),
      services: {
        database: db,
        r2_storage: r2,
        jwt: jwt,
      },
      env: envStatus,
    },
    { status: healthy ? 200 : 503 }
  );
}
