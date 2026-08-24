import { NextResponse } from "next/server";

export type ApiSuccess<T = unknown> = {
  ok: true;
  data: T;
  message?: string;
};

/**
 * The standard API error envelope. Every failing route returns this shape so
 * clients can rely on one machine-readable contract:
 *
 *   {
 *     "ok": false,          // legacy envelope flag (mobile parses this)
 *     "success": false,     // explicit boolean
 *     "error": "...",       // human-readable message (string — mobile displays it)
 *     "code": "...",        // stable machine-readable code
 *     "message": "...",     // same as error, for clients that read `message`
 *     "details": { "code": "...", "message": "..." }  // structured details
 *   }
 *
 * `error` deliberately stays a STRING at the top level: the installed mobile
 * client reads `error` directly for display. The structured `details` object
 * carries the same code/message for machine consumers.
 */
export type ApiError = {
  ok: false;
  success: false;
  error: string;
  code?: string;
  message?: string;
  details?: { code: string; message: string };
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
  const base: ApiError = { ok: false, success: false, error, message: error };
  if (typeof extra === "string") {
    base.code = extra;
    base.details = { code: extra, message: error };
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
