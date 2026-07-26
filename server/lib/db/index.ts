import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { config } from "@/lib/config";

function createDb() {
  const databaseUrl = config.turso.url();
  if (!databaseUrl) {
    throw new Error("TURSO_DATABASE_URL environment variable is required");
  }

  const client = createClient({
    url: databaseUrl,
    authToken: config.turso.token(),
  });

  return drizzle(client, { schema });
}

export type DB = ReturnType<typeof createDb>;

let dbInstance: DB | undefined;

function getDb(): DB {
  dbInstance ??= createDb();
  return dbInstance;
}

// Route modules are imported during `next build`. Keep database initialization
// request-scoped so a build never requires production-only database settings.
export const db = new Proxy({} as DB, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver);
  },
});
