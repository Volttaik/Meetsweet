import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { config } from "@/lib/config";

function createDb() {
  try {
    const databaseUrl = config.turso.url();
    if (!databaseUrl) {
      throw new Error("TURSO_DATABASE_URL environment variable is required");
    }

    const client = createClient({
      url: databaseUrl,
      authToken: config.turso.token(),
    });

    return drizzle(client, { schema });
  } catch (err) {
    console.warn('[AI Studio] Database not connected — using mock');
    const noOp = { findMany: async () => [], findFirst: async () => null,
      findUnique: async () => null, create: async (d: any) => d?.data ?? {},
      update: async (d: any) => d?.data ?? {}, delete: async () => ({}) };
    const db = new Proxy({}, {
      get: (_, prop) => prop === 'query'
        ? new Proxy({}, { get: () => noOp }) : async () => [],
    });
    return db as unknown as ReturnType<typeof drizzle>;
  }
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
