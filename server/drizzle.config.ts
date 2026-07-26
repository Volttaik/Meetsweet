import { defineConfig } from "drizzle-kit";
import { config } from "./lib/config";

if (!config.turso.url()) {
  throw new Error("TURSO_DATABASE_URL is required");
}

export default defineConfig({
  out: "./lib/db/migrations",
  schema: "./lib/db/schema.ts",
  dialect: "turso",
  dbCredentials: {
    url: config.turso.url(),
    authToken: config.turso.token(),
  },
});
