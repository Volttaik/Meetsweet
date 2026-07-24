import { z } from "zod";
import { err } from "./response";
import { NextResponse } from "next/server";

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: NextResponse };

export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<ValidationResult<T>> {
  try {
    const body = await req.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      const message = result.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return { success: false, response: err(message, 422) };
    }
    return { success: true, data: result.data as T };
  } catch {
    return { success: false, response: err("Invalid JSON body", 400) };
  }
}

export function parseQuery<T>(
  searchParams: URLSearchParams,
  schema: z.ZodType<T>
): ValidationResult<T> {
  const raw = Object.fromEntries(searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    return { success: false, response: err(message, 422) };
  }
  return { success: true, data: result.data as T };
}
