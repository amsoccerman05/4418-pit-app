import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { accessFailure } from "../src/connection.ts";

// The production suite broker and installed Supabase transport execute here.
// Only the DOM/message bus, session replies, and final fetch are synthetic.
// No HTTP request, account action, or production configuration is used.
const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, "..");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const payload = {
  p: { id: "synthetic-battery", expected_status: "READY", status: "ON ROBOT" },
};
const rpcName = "pit_transition_battery";
const context = { id: "synthetic-saved-record" };
const session = (id) => ({
  access_token: `synthetic-token-${id}`,
  user: { id },
});

function loadSource(file, overrides = {}, cache = new Map()) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("require", "exports", js)((id) => {
    if (id in overrides) return overrides[id]();
    if (!id.startsWith(".")) return require(id);
    let next = path.resolve(path.dirname(file), id);
    if (!path.extname(next)) next += existsSync(next + ".ts") ? ".ts" : ".tsx";
    return loadSource(next, overrides, cache);
  }, exports);
  return exports;
}

async function fixture() {
  const originals = new Map(
    ["window", "document", "location", "history", "fetch"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const listeners = new Map(),
    held = [],
    attempts = [],
    sent = [];
  let hold = false,
    brokerSession = session("actor-A"),
    fetchResponse = () => Response.json(context),
    currentActor = "actor-A",
    account = new AbortController();
  const frame = {
    contentWindow: {
      postMessage(message) {
        assert.equal(
          message.method,
          "getSession",
          "Only synthetic session reads are permitted",
        );
        if (hold) held.push(message);
        else queueMicrotask(() => reply(message, brokerSession));
      },
    },
  };
  const emit = (kind, value) => {
    for (const fn of [...(listeners.get(kind) || [])]) fn(value);
  };
  const reply = (message, next = brokerSession, error = null) =>
    emit("message", {
      origin: "https://team.frc4418.org",
      source: frame.contentWindow,
      data: {
        protocol: "4418-suite-auth-v1",
        id: message.id,
        result: { data: { session: next }, error },
      },
    });
  globalThis.location = {
    origin: "https://pit.frc4418.org",
    pathname: "/",
    search: "",
    hash: "#batteries",
  };
  globalThis.window = {
    opener: null,
    addEventListener(kind, fn) {
      if (!listeners.has(kind)) listeners.set(kind, new Set());
      listeners.get(kind).add(fn);
    },
    removeEventListener(kind, fn) {
      listeners.get(kind)?.delete(fn);
    },
  };
  globalThis.document = {
    referrer: "",
    createElement() {
      return frame;
    },
    body: {
      append(item) {
        item.onload();
      },
    },
    addEventListener() {},
  };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, "pit-dispatch-fixture.invalid");
    const request = {
      url: String(url),
      authorization: new Headers(init.headers).get("Authorization"),
      signal: init.signal,
      method: init.method,
      args: JSON.parse(init.body),
    };
    attempts.push(request);
    if (init.signal?.aborted)
      throw new DOMException("Synthetic fetch aborted", "AbortError");
    sent.push(request);
    return fetchResponse(request);
  };
  const { createSuiteClient } = loadSource("src/suite-auth.ts");
  const supabase = createSuiteClient(
    "https://pit-dispatch-fixture.invalid",
    "fixture-public-key",
  );
  await supabase.auth.getSession();
  // Match App's synchronous account invalidation, independently of React commit.
  const subscription = supabase.auth.onAuthStateChange((_event, next) => {
    const nextId = next?.user.id || null;
    if (currentActor !== nextId) {
      account.abort();
      account = new AbortController();
      currentActor = nextId;
    }
  });
  await tick();
  const service = loadSource("src/pit-rpc.ts", {
    "./client": () => ({ supabase }),
  });
  return {
    service,
    supabase,
    attempts,
    sent,
    scope() {
      const actorId = currentActor,
        signal = account.signal,
        hash = location.hash;
      return {
        actorId,
        signal,
        isCurrent: () => currentActor === actorId && location.hash === hash,
      };
    },
    hold() {
      hold = true;
    },
    async waitHeld() {
      await tick();
      assert.equal(held.length, 1);
    },
    release(next = brokerSession) {
      assert.equal(held.length, 1);
      reply(held.shift(), next);
    },
    releaseError(error) {
      assert.equal(held.length, 1);
      reply(held.shift(), null, error);
    },
    switchAccount(id) {
      brokerSession = id ? session(id) : null;
      emit("message", {
        origin: "https://team.frc4418.org",
        source: frame.contentWindow,
        data: {
          protocol: "4418-suite-auth-v1",
          event: id ? "SIGNED_IN" : "SIGNED_OUT",
          session: brokerSession,
        },
      });
    },
    setBroker(id) {
      brokerSession = session(id);
    },
    navigate(hash) {
      location.hash = hash;
      emit("hashchange", {});
    },
    respond(fn) {
      fetchResponse = fn;
    },
    listeners(kind) {
      return listeners.get(kind)?.size || 0;
    },
    close() {
      subscription.data.subscription.unsubscribe();
      for (const message of held.splice(0)) reply(message, null);
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

async function atSecondLookup(f, scope = f.scope()) {
  f.hold();
  const pending = f.service.scopedPitRpc(rpcName, payload, scope);
  // Observe rejections immediately, even while assertions hold broker replies.
  void pending.catch(() => {});
  await f.waitHeld();
  f.release(session("actor-A"));
  await f.waitHeld();
  assert.equal(f.sent.length, 0);
  return { pending, scope };
}

test("pit writes pin the reviewed actor through the installed SDK second broker lookup", async () => {
  const f = await fixture();
  try {
    const { pending } = await atSecondLookup(f);
    f.release(session("actor-B"));
    const result = await pending;
    assert.deepEqual(result.data, context);
    assert.equal(result.error, null);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].authorization, "Bearer synthetic-token-actor-A");
    assert.equal(f.sent[0].method, "POST");
    assert.equal(
      new URL(f.sent[0].url).pathname,
      "/rest/v1/rpc/pit_transition_battery",
    );
    assert.deepEqual(f.sent[0].args, payload);
  } finally {
    f.close();
  }
});

test("pit account replacement, sign-out, and same-actor return cancel a held write", async () => {
  for (const next of ["actor-B", null, "round-trip"]) {
    const f = await fixture();
    try {
      const { pending } = await atSecondLookup(f);
      f.switchAccount(next === "round-trip" ? "actor-B" : next);
      if (next === "round-trip") f.switchAccount("actor-A");
      f.release();
      try {
        const result = await pending;
        assert.ok(result.error, /Expected aborted transport/);
      } catch (error) {
        assert.match(error.message, /abort|cancel|changed/i);
      }
      await tick();
      assert.equal(f.sent.length, 0);
      assert.equal(f.attempts.length, 1);
      assert.equal(f.attempts[0].signal.aborted, true);
    } finally {
      f.close();
    }
  }
});

test("pit scope cancellation during the second broker wait reaches the installed SDK fetch", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController(),
      scope = { ...f.scope(), signal: controller.signal };
    const { pending } = await atSecondLookup(f, scope);
    controller.abort();
    f.release();
    try {
      const result = await pending;
      assert.ok(result.error);
    } catch (error) {
      assert.match(error.message, /abort|cancel|changed/i);
    }
    await tick();
    assert.equal(f.sent.length, 0);
    assert.equal(f.attempts[0].signal.aborted, true);
  } finally {
    f.close();
  }
});

test("verified missing, expired, or changed pit sessions invalidate access before transport", async () => {
  for (const next of [
    session("actor-B"),
    null,
    { ...session("actor-A"), access_token: null },
    { ...session("actor-A"), expires_at: Math.floor(Date.now() / 1000) - 1 },
  ]) {
    const f = await fixture();
    try {
      f.hold();
      const pending = f.service.scopedPitRpc(rpcName, payload, f.scope());
      void pending.catch(() => {});
      await f.waitHeld();
      f.release(next);
      await assert.rejects(pending, (error) => {
        assert.equal(
          accessFailure(error),
          true,
          "Callers must clear the old private snapshot when broker access is lost",
        );
        return true;
      });
      assert.equal(f.attempts.length, 0);
    } finally {
      f.close();
    }
  }
});

test("already cancelled or obsolete pit scopes never reach the broker or transport", async () => {
  const f = await fixture();
  try {
    const cancelled = new AbortController();
    cancelled.abort();
    for (const scope of [
      { ...f.scope(), signal: cancelled.signal },
      { ...f.scope(), isCurrent: () => false },
    ]) {
      f.hold();
      await assert.rejects(
        f.service.scopedPitRpc(rpcName, payload, scope),
        /abort|cancel|changed/i,
      );
      assert.equal(f.attempts.length, 0);
    }
  } finally {
    f.close();
  }
});

test("pit authorization headers remain request-local and transport failures never replay writes", async () => {
  const f = await fixture();
  try {
    await f.service.scopedPitRpc(rpcName, payload, f.scope());
    f.switchAccount("actor-B");
    await f.supabase.rpc("synthetic_unrelated_rpc", {});
    assert.deepEqual(
      f.sent.map((item) => item.authorization),
      ["Bearer synthetic-token-actor-A", "Bearer synthetic-token-actor-B"],
    );
    f.respond(() => {
      throw new TypeError("Synthetic connection failure");
    });
    try {
      const result = await f.service.scopedPitRpc(rpcName, payload, f.scope());
      assert.ok(result.error);
    } catch (error) {
      assert.match(error.message, /Synthetic connection failure/);
    }
    assert.equal(f.sent.length, 3, "The non-idempotent write must not retry");
  } finally {
    f.close();
  }
});

test("transient broker failures stay distinguishable from verified loss of pit access", async () => {
  const f = await fixture();
  try {
    f.hold();
    const pending = f.service.scopedPitRpc(rpcName, payload, f.scope());
    void pending.catch(() => {});
    await f.waitHeld();
    f.releaseError(new TypeError("Synthetic broker outage"));
    await assert.rejects(pending, (error) => {
      assert.equal(accessFailure(error), false);
      assert.match(error.message, /Synthetic broker outage/);
      return true;
    });
    assert.equal(f.attempts.length, 0);
  } finally {
    f.close();
  }
});
