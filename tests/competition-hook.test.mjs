import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PRIVATE_SNAPSHOT_MAX_AGE_MS } from "../src/connection.ts";

// Execute the real hook with deterministic hook state/effects and synthetic
// transport. This verifies lifecycle decisions, not React DOM/browser timing.
const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, "..");
const turn = () => new Promise((resolve) => setImmediate(resolve));
function loadSource(file, overrides, cache = new Map()) {
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
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const context = (event = "event-A", note = "loaded", version = 1) => ({
  can_manage: true,
  config: {
    event_id: event,
    team_number: 4418,
    tba_event_key: "2026test",
    nexus_event_key: null,
    version,
  },
  matches: [
    { id: "ops", event_id: event, match_key: "2026test_qm1", note, version },
  ],
  templates: [],
  runs: [],
  items: [],
  links: [],
  areas: [],
});
function harness() {
  const originals = new Map(
    ["window", "document", "navigator", "setInterval", "clearInterval"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
    ),
  );
  const originalNow = Date.now;
  let now = 1800000000000,
    online = true,
    dirty = false,
    cursor = 0,
    result;
  const slots = [],
    effects = [],
    callbacks = [],
    reads = [],
    writes = [],
    intervals = new Map(),
    windowEvents = new Map(),
    documentEvents = new Map();
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (next) => {
          const value = typeof next === "function" ? next(slots[i]) : next;
          if (!Object.is(slots[i], value)) {
            slots[i] = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!callbacks[i] || !same(callbacks[i].deps, deps))
        callbacks[i] = { fn, deps };
      return callbacks[i].fn;
    },
    useEffect(setup, deps) {
      const i = cursor++,
        old = effects[i];
      if (!old || !same(old.deps, deps))
        effects[i] = { setup, deps, cleanup: old?.cleanup, pending: true };
    },
  };
  const events = (map) => ({
    addEventListener(kind, fn) {
      if (!map.has(kind)) map.set(kind, new Set());
      map.get(kind).add(fn);
    },
    removeEventListener(kind, fn) {
      map.get(kind)?.delete(fn);
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      get onLine() {
        return online;
      },
    },
  });
  globalThis.window = events(windowEvents);
  globalThis.document = { ...events(documentEvents), hidden: false };
  globalThis.setInterval = (fn) => {
    const id = Symbol();
    intervals.set(id, fn);
    return id;
  };
  globalThis.clearInterval = (id) => intervals.delete(id);
  Date.now = () => now;
  const supabase = {
    rpc(name, args) {
      assert.equal(name, "pit_competition_context");
      const pending = { name, args, ...deferred(), signal: null };
      reads.push(pending);
      return {
        abortSignal(signal) {
          pending.signal = signal;
          return this;
        },
        then(yes, no) {
          return pending.promise.then(yes, no);
        },
      };
    },
    functions: {
      invoke() {
        throw new Error("External feeds not enabled in this fixture");
      },
    },
  };
  const scopedPitRpc = (name, args, scope) => {
    const pending = { name, args, scope, ...deferred() };
    writes.push(pending);
    return pending.promise;
  };
  let failures = 0;
  const account = new AbortController();
  const args = {
    profile: {
      id: "actor-A",
      active: true,
      role: "mentor",
      display_name: "Synthetic crew",
    },
    eventId: "event-A",
    generation: 1,
    authorized: true,
    pitReadOnly: false,
    signal: account.signal,
  };
  const { useCompetition } = loadSource("src/competition/service.ts", {
    react: () => react,
    "../client": () => ({ supabase }),
    "../pit-rpc": () => ({ scopedPitRpc }),
  });
  const render = () => {
    cursor = 0;
    dirty = false;
    result = useCompetition(
      args.profile,
      args.eventId,
      false,
      false,
      args.generation,
      args.pitReadOnly,
      () => failures++,
      () => args.authorized,
      args.signal,
    );
    return result;
  };
  const flush = () => {
    const pending = effects.filter((effect) => effect?.pending);
    for (const effect of pending) {
      effect.pending = false;
      effect.cleanup?.();
      effect.cleanup = effect.setup();
    }
  };
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await turn();
      if (!dirty && !effects.some((effect) => effect?.pending)) return result;
      render();
      flush();
    }
    throw new Error("Hook did not settle");
  };
  render();
  flush();
  return {
    args,
    reads,
    writes,
    render,
    flush,
    settle,
    get value() {
      return result;
    },
    get failures() {
      return failures;
    },
    get now() {
      return now;
    },
    set now(value) {
      now = value;
    },
    event(kind) {
      if (kind === "offline") online = false;
      if (kind === "online") online = true;
      for (const fn of windowEvents.get(kind) || []) fn();
    },
    tick() {
      for (const fn of intervals.values()) fn();
    },
    async ready() {
      reads[0].resolve({ data: context(), error: null });
      await settle();
      assert.equal(result.readOnly, false);
    },
    async close() {
      for (const effect of effects) effect?.cleanup?.();
      for (const pending of [...reads, ...writes])
        pending.resolve({ data: null, error: null });
      await turn();
      Date.now = originalNow;
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("competition post-save refresh supersedes an older read and keeps its write lock until fresh context arrives", async () => {
  const h = harness();
  try {
    await h.ready();
    const oldRefresh = h.value.refresh();
    await h.settle();
    assert.equal(h.reads.length, 2);
    assert.equal(await h.value.refresh(), false);
    assert.equal(h.reads.length, 2, "Repeated refreshes stay single-flight");
    const save = h.value.run("item", { id: "check", complete: true });
    await h.settle();
    assert.equal(h.value.busy, true);
    await assert.rejects(
      h.value.run("item", { id: "check", complete: true }),
      /Please wait/,
    );
    assert.equal(h.writes.length, 1);
    h.writes[0].resolve({ data: "saved", error: null });
    await h.settle();
    assert.equal(h.reads.length, 3);
    assert.equal(h.reads[1].signal.aborted, true);
    assert.equal(h.value.busy, true);
    h.reads[1].resolve({
      data: context("event-A", "old-before-save"),
      error: null,
    });
    await oldRefresh;
    await h.settle();
    assert.notEqual(h.value.context.matches[0].note, "old-before-save");
    h.reads[2].resolve({
      data: context("event-A", "fresh-after-save"),
      error: null,
    });
    assert.equal(await save, "saved");
    await h.settle();
    assert.equal(h.value.context.matches[0].note, "fresh-after-save");
    assert.equal(h.value.busy, false);
  } finally {
    await h.close();
  }
});

test("competition event replacement clears its snapshot and busy state without accepting an old write completion", async () => {
  const h = harness();
  try {
    await h.ready();
    const save = h.value.run("template", { id: "template" });
    void save.catch(() => {});
    await h.settle();
    assert.equal(h.value.busy, true);
    h.args.eventId = "event-B";
    h.render();
    assert.equal(h.value.context, null);
    h.flush();
    await h.settle();
    assert.equal(h.value.busy, false);
    h.reads
      .at(-1)
      .resolve({ data: context("event-B", "new-scope"), error: null });
    await h.settle();
    h.writes[0].resolve({ data: "old-scope-save", error: null });
    await assert.rejects(save, /Account.*changed/);
    await h.settle();
    assert.equal(h.value.context.config.event_id, "event-B");
    assert.equal(h.value.busy, false);
    assert.equal(h.value.error, "");
    const next = h.value.run("item", { id: "second" });
    await h.settle();
    assert.equal(h.writes.length, 2);
    h.writes[1].resolve({ data: "second-save", error: null });
    await h.settle();
    h.reads.at(-1).resolve({ data: context("event-B", "newest"), error: null });
    await next;
  } finally {
    await h.close();
  }
});

test("competition read failures preserve only the current snapshot, while authorization failure removes it", async () => {
  const h = harness();
  try {
    await h.ready();
    const at = h.value.contextAt,
      refresh = h.value.refresh();
    h.reads
      .at(-1)
      .resolve({ data: null, error: { message: "Synthetic outage" } });
    assert.equal(await refresh, false);
    await h.settle();
    assert.equal(h.value.context.matches[0].note, "loaded");
    assert.equal(h.value.contextAt, at);
    assert.equal(h.value.readOnly, true);
    assert.equal(h.failures, 0);
    const denied = h.value.refresh();
    h.reads.at(-1).resolve({
      data: null,
      error: { code: "42501", message: "Active team account required" },
    });
    assert.equal(await denied, false);
    await h.settle();
    assert.equal(h.value.context, null);
    assert.equal(h.failures, 1);
  } finally {
    await h.close();
  }
});

test("uncertain competition writes stay locked through automatic recovery and never replay", async () => {
  const h = harness();
  try {
    await h.ready();
    const save = h.value.run("item", { id: "check", complete: true });
    void save.catch(() => {});
    h.writes[0].reject(new TypeError("Synthetic lost response"));
    await assert.rejects(save, /lost response/);
    await h.settle();
    assert.equal(h.value.readOnly, true);
    assert.match(h.value.error, /Save not confirmed/);
    h.event("offline");
    await h.settle();
    h.event("online");
    h.reads
      .at(-1)
      .resolve({ data: context("event-A", "record confirmed"), error: null });
    await h.settle();
    assert.equal(h.value.readOnly, true);
    assert.equal(h.writes.length, 1);
    const reviewed = h.value.refresh(true);
    h.reads
      .at(-1)
      .resolve({ data: context("event-A", "record confirmed"), error: null });
    await reviewed;
    await h.settle();
    assert.equal(h.value.readOnly, false);
    assert.equal(h.writes.length, 1);
  } finally {
    await h.close();
  }
});

test("competition private snapshot expires independently even without a new base pit snapshot", async () => {
  const h = harness();
  try {
    await h.ready();
    h.event("offline");
    await h.settle();
    assert.ok(h.value.context);
    h.now += PRIVATE_SNAPSHOT_MAX_AGE_MS + 1;
    h.tick();
    await h.settle();
    assert.equal(h.value.context, null);
    assert.equal(h.value.feed, null);
    assert.equal(h.value.readOnly, true);
    assert.match(h.value.error, /snapshot expired/);
    assert.equal(h.writes.length, 0);
  } finally {
    await h.close();
  }
});

test("competition completion callbacks do not survive a scope change during post-save refresh", async () => {
  const h = harness();
  try {
    await h.ready();
    const save = h.value.run("template", { id: "template" });
    void save.catch(() => {});
    h.writes[0].resolve({ data: "saved-before-switch", error: null });
    await h.settle();
    assert.equal(h.reads.length, 2);
    assert.equal(h.value.busy, true);
    h.args.eventId = "event-B";
    h.render();
    h.flush();
    await h.settle();
    await assert.rejects(save, /Account.*changed/);
    assert.equal(h.reads[1].signal.aborted, true);
    h.reads
      .at(-1)
      .resolve({ data: context("event-B", "new-scope"), error: null });
    await h.settle();
    assert.equal(h.value.context.config.event_id, "event-B");
    assert.equal(h.value.busy, false);
    assert.equal(h.value.error, "");
  } finally {
    await h.close();
  }
});
