/**
 * Runtime configuration for the credential broker.
 *
 * The first name in each resolver is the production name. The fallback keeps
 * existing deployments working without creating a second configuration value.
 * Secrets are never returned from this module.
 */
function firstSet(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

export const config = {
  turso: {
    url: () => firstSet("TURSO_DATABASE_URL", "DATABASE_URL"),
    token: () => firstSet("TURSO_AUTH_TOKEN"),
  },
  r2: {
    accountId: () => firstSet("CLOUDFLARE_ACCOUNT_ID", "R2_ACCOUNT_ID"),
    accessKeyId: () => firstSet("R2_ACCESS_KEY_ID"),
    secretAccessKey: () => firstSet("R2_SECRET_ACCESS_KEY"),
    bucket: () => firstSet("R2_BUCKET_NAME"),
    publicBaseUrl: () => firstSet("R2_PUBLIC_BASE_URL"),
  },
  resend: {
    apiKey: () => firstSet("RESEND_API_KEY"),
    sender: () => firstSet("VERIFIED_SENDER_EMAIL", "RESEND_FROM_EMAIL"),
  },
  paystack: {
    secretKey: () => firstSet("PAYSTACK_SECRET_KEY"),
    publicKey: () => firstSet("PAYSTACK_PUBLIC_KEY"),
  },
  auth: {
    jwtSecret: () => firstSet("JWT_SECRET", "SESSION_SECRET"),
  },
  app: {
    url: () => firstSet("APP_URL"),
    clientId: () => firstSet("CLIENT_APP_ID") ?? "meetsweet-mobile",
  },
} as const;

export type BrokerService = "turso" | "cloudflare" | "resend" | "auth";

export function serviceConfigured(service: BrokerService): boolean {
  switch (service) {
    case "turso":
      return Boolean(config.turso.url() && config.turso.token());
    case "cloudflare":
      return Boolean(
        config.r2.accountId() &&
          config.r2.accessKeyId() &&
          config.r2.secretAccessKey() &&
          config.r2.bucket(),
      );
    case "resend":
      return Boolean(config.resend.apiKey() && config.resend.sender());
    case "auth": {
      const secret = config.auth.jwtSecret();
      return Boolean(secret && secret.length >= 32);
    }
  }
}

export function requiredEnvironmentPresent(): boolean {
  return (
    serviceConfigured("turso") &&
    serviceConfigured("cloudflare") &&
    serviceConfigured("resend") &&
    serviceConfigured("auth")
  );
}