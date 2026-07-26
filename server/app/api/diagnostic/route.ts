import { NextResponse } from "next/server";
import { createClient } from "@libsql/client";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { config, requiredEnvironmentPresent, serviceConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Status = "Present" | "Missing" | "Healthy" | "Unavailable";

const REQUIRED_ENVIRONMENT = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "RESEND_API_KEY",
  "VERIFIED_SENDER_EMAIL",
  "JWT_SECRET",
];

function environmentPresent(primary: string, ...fallbacks: string[]): boolean {
  return Boolean([primary, ...fallbacks].some((name) => process.env[name]?.trim()));
}

async function tursoHealth(): Promise<Status> {
  if (!serviceConfigured("turso")) return "Unavailable";
  try {
    const client = createClient({
      url: config.turso.url()!,
      authToken: config.turso.token()!,
    });
    await client.execute("SELECT 1");
    client.close();
    return "Healthy";
  } catch {
    return "Unavailable";
  }
}

async function cloudflareHealth(): Promise<Status> {
  if (!serviceConfigured("cloudflare")) return "Unavailable";
  try {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${config.r2.accountId()}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2.accessKeyId()!,
        secretAccessKey: config.r2.secretAccessKey()!,
      },
    });
    await client.send(new HeadBucketCommand({ Bucket: config.r2.bucket()! }));
    return "Healthy";
  } catch {
    return "Unavailable";
  }
}

export async function GET() {
  const [turso, cloudflare] = await Promise.all([
    tursoHealth(),
    cloudflareHealth(),
  ]);
  const envNames = REQUIRED_ENVIRONMENT.map((name) => {
    const fallback =
      name === "CLOUDFLARE_ACCOUNT_ID"
        ? "R2_ACCOUNT_ID"
        : name === "VERIFIED_SENDER_EMAIL"
          ? "RESEND_FROM_EMAIL"
          : name === "JWT_SECRET"
            ? "SESSION_SECRET"
            : name === "TURSO_DATABASE_URL"
              ? "DATABASE_URL"
              : undefined;
    return {
      name,
      status: environmentPresent(name, ...(fallback ? [fallback] : []))
        ? "Present"
        : "Missing",
    };
  });

  const auth = serviceConfigured("auth") ? "Healthy" : "Unavailable";
  const resend = serviceConfigured("resend") ? "Healthy" : "Unavailable";
  const environment = envNames.every((item) => item.status === "Present")
    ? "Present"
    : "Missing";
  const broker =
    auth === "Healthy" &&
    turso === "Healthy" &&
    cloudflare === "Healthy" &&
    resend === "Healthy"
      ? "Healthy"
      : "Unavailable";

  const response = {
    backend_reachable: "Healthy" as Status,
    authentication: auth as Status,
    turso: turso as Status,
    cloudflare: cloudflare as Status,
    resend: resend as Status,
    required_environment_variables: environment as Status,
    credential_broker: broker as Status,
    backend_url: config.app.url() ? "Present" : "Missing",
    environment_variables: envNames,
  };

  return NextResponse.json(response, { status: broker === "Healthy" ? 200 : 503 });
}