import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accessFailure,
  abortable,
  boundedRequest,
  REQUEST_TIMEOUT_MS,
} from "../src/connection.ts";

// Pure local regression coverage. No browser, transport, credentials or server.
test("access failure classification distinguishes authorization loss from a transient outage", () => {
  for (const error of [
    { status: 401 },
    { status: 403 },
    { context: { status: 401 } },
    { context: { status: 403 } },
    { code: "42501" },
    { code: "PGRST301" },
    { code: "PGRST302" },
    { code: "PGRST303" },
    new Error("JWT expired"),
    new Error("Active profile required"),
    new Error("Not authenticated"),
    new Error("Invalid JWT"),
  ])
    assert.equal(accessFailure(error), true, JSON.stringify(error));
  for (const error of [
    null,
    undefined,
    new Error("Failed to fetch"),
    new Error("Connection timed out"),
    { status: 500 },
    { status: 503 },
    { code: "23505" },
    new Error("Checklist item changed. Refresh before saving"),
  ])
    assert.equal(accessFailure(error), false, JSON.stringify(error));
});

test("bounded request never starts an operation for an already cancelled scope", async () => {
  const scope = new AbortController();
  scope.abort();
  let attempts = 0;
  await assert.rejects(
    boundedRequest(() => {
      attempts++;
      return Promise.resolve("private");
    }, scope.signal),
    /cancelled/i,
  );
  assert.equal(attempts, 0);
});

test("scope cancellation reaches the underlying operation and ignores late success", async () => {
  const scope = new AbortController();
  let requestSignal,
    resolve,
    attempts = 0;
  const pending = boundedRequest((signal) => {
    requestSignal = signal;
    attempts++;
    return new Promise((yes) => {
      resolve = yes;
    });
  }, scope.signal);
  const rejected = assert.rejects(pending, /cancelled/i);
  scope.abort();
  await rejected;
  assert.equal(requestSignal.aborted, true);
  resolve("late private snapshot");
  await Promise.resolve();
  assert.equal(attempts, 1);
});

test("a timeout aborts exactly one attempt and does not replay it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal,
    attempts = 0,
    resolve;
  const pending = boundedRequest((s) => {
    signal = s;
    attempts++;
    return new Promise((yes) => {
      resolve = yes;
    });
  });
  const rejected = assert.rejects(pending, /timed out/i);
  t.mock.timers.tick(REQUEST_TIMEOUT_MS);
  await rejected;
  assert.equal(signal.aborted, true);
  resolve("late completion");
  t.mock.timers.tick(REQUEST_TIMEOUT_MS * 3);
  await Promise.resolve();
  assert.equal(attempts, 1);
});

test("successful requests release timeout and scope cancellation hooks", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = new AbortController();
  let signal;
  const result = await boundedRequest((s) => {
    signal = s;
    return Promise.resolve("fresh snapshot");
  }, scope.signal);
  assert.equal(result, "fresh snapshot");
  scope.abort();
  t.mock.timers.tick(REQUEST_TIMEOUT_MS * 2);
  assert.equal(signal.aborted, false);
});

test("operation failures propagate without an automatic retry", async () => {
  const expected = new TypeError("Synthetic connection failure");
  let attempts = 0,
    signal;
  await assert.rejects(
    boundedRequest((s) => {
      signal = s;
      attempts++;
      return Promise.reject(expected);
    }),
    (error) => error === expected,
  );
  assert.equal(attempts, 1);
  assert.equal(
    signal.aborted,
    true,
    "Sibling operations share cancellation after a request fails",
  );
});

test("query abort forwarding preserves builder identity and legacy adapters", () => {
  const signal = new AbortController().signal;
  const query = {
    seen: null,
    abortSignal(next) {
      this.seen = next;
      return this;
    },
  };
  assert.equal(abortable(query, signal), query);
  assert.equal(query.seen, signal);
  const legacy = Promise.resolve("test-only adapter");
  assert.equal(abortable(legacy, signal), legacy);
});
