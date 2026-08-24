import { test } from "node:test";
import assert from "node:assert/strict";
import { err, unauthorized, forbidden, notFound, serverError, ok } from "../lib/api/response";

/** Parse a NextResponse body. */
async function body(resp: Response): Promise<Record<string, unknown>> {
  return (await resp.json()) as Record<string, unknown>;
}

test("err() emits the standard machine-readable envelope", async () => {
  const resp = err("Invalid email or password", 401, "INVALID_CREDENTIALS");
  assert.equal(resp.status, 401);
  const parsed = await body(resp);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.success, false);
  // `error` stays a STRING — the installed mobile client displays it directly.
  assert.equal(parsed.error, "Invalid email or password");
  assert.equal(parsed.message, "Invalid email or password");
  assert.equal(parsed.code, "INVALID_CREDENTIALS");
  assert.deepEqual(parsed.details, { code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
});

test("err() without a code omits code/details", async () => {
  const resp = err("Something broke");
  assert.equal(resp.status, 400);
  const parsed = await body(resp);
  assert.equal(parsed.error, "Something broke");
  assert.equal(parsed.code, undefined);
  assert.equal(parsed.details, undefined);
});

test("err() accepts extra structured fields", async () => {
  const resp = err("No", 403, { code: "FORBIDDEN", field: "role" });
  const parsed = await body(resp);
  assert.equal(parsed.code, "FORBIDDEN");
  assert.equal(parsed.field, "role");
});

test("auth helpers carry stable codes and the shared envelope", async () => {
  const unauthorizedBody = await body(unauthorized("Invalid email or password"));
  assert.equal(unauthorizedBody.code, "UNAUTHORIZED");
  assert.equal(unauthorizedBody.success, false);
  const forbiddenBody = await body(forbidden());
  assert.equal(forbiddenBody.code, "FORBIDDEN");
  const notFoundBody = await body(notFound());
  assert.equal(notFoundBody.code, "NOT_FOUND");
  const serverErrorBody = await body(serverError());
  assert.equal(serverErrorBody.code, "INTERNAL_ERROR");
});

test("ok() keeps the success envelope unchanged", async () => {
  const resp = ok({ user_id: "u1" });
  assert.equal(resp.status, 200);
  const parsed = await body(resp);
  assert.deepEqual(parsed, { ok: true, data: { user_id: "u1" } });
});
