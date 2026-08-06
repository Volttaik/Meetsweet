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
    // Never fall back to DATABASE_URL — in Replit that is always the built-in
    // PostgreSQL URL (postgresql://...?sslmode=...) which libsql cannot parse.
    url: () => {
      const raw = firstSet("TURSO_DATABASE_URL");
      if (!raw) return undefined;
      // Strip any unsupported query params (e.g. sslmode) so a mis-pasted URL
      // doesn't silently break every API route.
      try {
        const u = new URL(raw);
        u.search = "";
        return u.toString();
      } catch {
        return raw;
      }
    },
    token: () => firstSet("TURSO_AUTH_TOKEN"),
  },
  r2: {
    endpoint: () => firstSet("R2_ENDPOINT"),
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
    // Public web/API origin. Keep this separate from APP_URL so an older
    // deployment value such as api.meetsweet.space cannot leak into share URLs.
    publicUrl: () => firstSet("PUBLIC_APP_URL") ?? "https://meetsweet.space",
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
        (config.r2.endpoint() || config.r2.accountId()) &&
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