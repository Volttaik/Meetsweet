import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "../lib/realtime/timeout";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("withTimeout resolves with the promise value when it settles first", async () => {
  const result = await withTimeout(Promise.resolve("done"), 1000, "fallback");
  assert.equal(result, "done");
});

test("withTimeout returns the fallback when the promise never settles", async () => {
  const never = new Promise<string>(() => {});
  const result = await withTimeout(never, 30, "fallback");
  assert.equal(result, "fallback");
});

test("withTimeout returns the fallback when the promise settles too slowly", async () => {
  const slow = sleep(200).then(() => "late");
  const result = await withTimeout(slow, 30, "fallback");
  assert.equal(result, "fallback");
});

test("withTimeout propagates rejections when the promise fails before the bound", async () => {
  await assert.rejects(
    withTimeout(Promise.reject(new Error("boom")), 1000, "fallback"),
    /boom/,
  );
});

test("withTimeout resolves promptly after the bound even when the promise hangs", async () => {
  const never = new Promise<number>(() => {});
  const started = Date.now();
  const result = await withTimeout(never, 40, -1);
  assert.equal(result, -1);
  assert.ok(Date.now() - started < 500, "must not wait much longer than the bound");
});
