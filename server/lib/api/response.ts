import { NextResponse } from "next/server";

export type ApiSuccess<T = unknown> = {
  ok: true;
  data: T;
  message?: string;
};

export type ApiError = {
  ok: false;
  error: string;
  code?: string;
  [key: string]: unknown;
};

export function ok<T>(data: T, message?: string, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data, message } satisfies ApiSuccess<T>, { status });
}

export function created<T>(data: T, message?: string): NextResponse {
  return ok(data, message, 201);
}

export function err(
  error: string,
  status = 400,
  extra?: string | Record<string, unknown>,
): NextResponse {
  const base: ApiError = { ok: false, error };
  if (typeof extra === "string") {
    base.code = extra;
  } else if (extra) {
    Object.assign(base, extra);
  }
  return NextResponse.json(base, { status });
}

export function unauthorized(msg = "Unauthorized"): NextResponse {
  return err(msg, 401, "UNAUTHORIZED");
}

export function forbidden(msg = "Forbidden"): NextResponse {
  return err(msg, 403, "FORBIDDEN");
}

export function notFound(msg = "Not found"): NextResponse {
  return err(msg, 404, "NOT_FOUND");
}

export function serverError(msg = "Internal server error"): NextResponse {
  return err(msg, 500, "INTERNAL_ERROR");
}
