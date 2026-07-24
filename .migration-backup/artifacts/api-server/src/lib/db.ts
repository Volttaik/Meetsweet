import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

// Helper for parameterized queries — returns rows
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await pool.query(sql, params);
  return (result.rows[0] as T) ?? null;
}

// Raw query — returns rowCount and rows (needed where rowCount matters)
export async function queryRaw(
  sql: string,
  params?: unknown[],
): Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> {
  const result = await pool.query(sql, params);
  return { rowCount: result.rowCount, rows: result.rows as Record<string, unknown>[] };
}
