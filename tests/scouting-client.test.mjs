import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { initialData } from "../src/scouting/model.ts";
import { PRIVATE_SNAPSHOT_MAX_AGE_MS } from "../src/connection.ts";

const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, "..");
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
    },
  }).outputText;
  new Function("require", "exports", js)((name) => {
    if (name in overrides) return overrides[name]();
    if (!name.startsWith(".")) return require(name);
    let next = path.resolve(path.dirname(file), name);
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
function report(n = 1, event = "event-A") {
  return {
    id: id(n),
    event_id: event,
    kind: "match",
    team_number: 4418,
    match_key: "qm1",
    data: { ...initialData("match"), match_label: "Qualification 1" },
  };
}
function context(event = "event-A", note = "loaded") {
  return {
    can_scout: true,
    can_manage: true,
    observations: [
      {
        ...report(900, event),
        data: { ...report().data, notes: note },
        created_by: id(100),
        created_at: "2026-10-10T00:00:00Z",
      },
    ],
    assignments: [],
    picklist: [],
  };
}
function harness() {
  const originals = new Map(
    [
      "window",
      "document",
      "navigator",
      "localStorage",
      "setInterval",
      "clearInterval",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const originalNow = Date.now;
  let now = 1_800_000_000_000,
    online = true,
    dirty = false,
    cursor = 0,
    result,
    failures = 0;
  const slots = [],
    effects = [],
    callbacks = [],
    memos = [],
    reads = [],
    writes = [],
    intervals = new Map(),
    events = new Map(),
    storage = new Map();
  let deniedStorage = false;
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
      return (slots[cursor++] ??= { current: initial });
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!callbacks[i] || !same(callbacks[i].deps, deps))
        callbacks[i] = { fn, deps };
      return callbacks[i].fn;
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!memos[i] || !same(memos[i].deps, deps))
        memos[i] = { value: fn(), deps };
      return memos[i].value;
    },
    useEffect(setup, deps) {
      const i = cursor++,
        old = effects[i];
      if (!old || !same(old.deps, deps))
        effects[i] = { setup, deps, cleanup: old?.cleanup, pending: true };
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      get onLine() {
        return online;
      },
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        if (deniedStorage) throw new Error("privacy mode");
        return storage.size;
      },
      key(index) {
        if (deniedStorage) throw new Error("privacy mode");
        return [...storage.keys()][index] ?? null;
      },
      getItem(key) {
        if (deniedStorage) throw new Error("privacy mode");
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (deniedStorage) throw new Error("privacy mode");
        storage.set(key, value);
      },
      removeItem(key) {
        if (deniedStorage) throw new Error("privacy mode");
        storage.delete(key);
      },
    },
  });
  globalThis.window = {
    addEventListener(kind, fn) {
      if (!events.has(kind)) events.set(kind, new Set());
      events.get(kind).add(fn);
    },
    removeEventListener(kind, fn) {
      events.get(kind)?.delete(fn);
    },
  };
  globalThis.document = { hidden: false };
  globalThis.setInterval = (fn) => {
    const key = Symbol();
    intervals.set(key, fn);
    return key;
  };
  globalThis.clearInterval = (key) => intervals.delete(key);
  Date.now = () => now;
  const args = {
    profile: {
      id: id(100),
      active: true,
      role: "mentor",
      display_name: "Synthetic scout",
    },
    eventId: "event-A",
    demo: false,
    authorized: true,
    controller: new AbortController(),
  };
  const scopedPitRpc = (name, payload, scope) => {
    const request = { name, payload, scope, ...deferred() };
    (name === "pit_scouting_context" ? reads : writes).push(request);
    return request.promise;
  };
  const { useScouting } = loadSource("src/scouting/service.ts", {
    react: () => react,
    "../pit-rpc": () => ({ scopedPitRpc }),
  });
  const render = () => {
    cursor = 0;
    dirty = false;
    result = useScouting(
      args.profile,
      args.eventId,
      args.demo,
      {
        actorId: args.profile.id,
        signal: args.controller.signal,
        isCurrent: () => args.authorized,
      },
      () => failures++,
    );
    return result;
  };
  const flush = () => {
    for (const effect of effects.filter((entry) => entry?.pending)) {
      effect.pending = false;
      effect.cleanup?.();
      effect.cleanup = effect.setup();
    }
  };
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await turn();
      if (!dirty && !effects.some((entry) => entry?.pending)) return result;
      render();
      flush();
    }
    throw new Error("Scouting hook did not settle");
  };
  render();
  flush();
  return {
    args,
    reads,
    writes,
    storage,
    render,
    flush,
    settle,
    get value() {
      return result;
    },
    get failures() {
      return failures;
    },
    set now(value) {
      now = value;
    },
    get now() {
      return now;
    },
    denyStorage() {
      deniedStorage = true;
    },
    event(kind, event = {}) {
      if (kind === "offline") online = false;
      if (kind === "online") online = true;
      for (const fn of events.get(kind) || []) fn(event);
    },
    tick() {
      for (const fn of intervals.values()) fn();
    },
    async ready() {
      reads[0].resolve({ data: context(), error: null });
      await settle();
      assert.equal(result.context.observations[0].data.notes, "loaded");
    },
    async close() {
      for (const effect of effects) effect?.cleanup?.();
      for (const request of [...reads, ...writes])
        request.resolve({ data: null, error: null });
      await turn();
      Date.now = originalNow;
      for (const [key, descriptor] of originals)
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    },
  };
}

test("scouting drafts stay local and reviewed reports upload on reconnect", async () => {
  const h = harness();
  try {
    await h.ready();
    h.event("offline");
    await h.settle();
    const draft = h.value.saveDraft(report());
    assert.ok(draft);
    h.value.queue(report(), draft.id);
    await h.settle();
    assert.equal(h.value.outbox[0].status, "queued");
    assert.equal(h.value.drafts.length, 0);
    await h.value.sync();
    assert.equal(h.writes.length, 0);
    h.event("online");
    h.tick();
    await h.settle();
    assert.equal(h.writes.length, 1);
    assert.equal(h.reads.length, 2);
    h.reads[1].resolve({ data: context(), error: null });
    await h.settle();
    await h.value.sync();
    assert.equal(h.writes.length, 1);
    assert.equal(h.value.busy, true);
    h.writes[0].resolve({ data: id(1), error: null });
    await h.settle();
    h.reads.at(-1).resolve({ data: context(), error: null });
    await h.settle();
    assert.equal(h.value.outbox[0].status, "synced");
    assert.equal(h.value.busy, false);
  } finally {
    await h.close();
  }
});

test("scouting reports and snapshots hide immediately on actor/event/demo changes", async () => {
  const h = harness();
  try {
    await h.ready();
    h.value.saveDraft(report());
    h.value.queue(report(2));
    await h.settle();
    h.args.profile = { ...h.args.profile, id: id(101) };
    h.render();
    assert.equal(h.value.context, null);
    assert.deepEqual(h.value.drafts, []);
    assert.deepEqual(h.value.outbox, []);
    h.flush();
    await h.settle();
    h.args.profile = { ...h.args.profile, id: id(100) };
    h.render();
    h.flush();
    await h.settle();
    assert.equal(h.value.drafts.length, 1);
    assert.equal(h.value.outbox.length, 1);
    h.args.eventId = "event-B";
    h.render();
    assert.equal(h.value.context, null);
    assert.deepEqual(h.value.outbox, []);
    h.flush();
    h.args.eventId = "event-A";
    h.args.demo = true;
    h.render();
    h.flush();
    await h.settle();
    assert.deepEqual(h.value.outbox, []);
    assert.deepEqual(h.value.context.observations, []);
  } finally {
    await h.close();
  }
});

test("old account completion cannot overwrite new scope or keep its operation lock", async () => {
  const h = harness();
  try {
    await h.ready();
    h.value.queue(report());
    await h.settle();
    const oldSync = h.value.sync();
    await h.settle();
    assert.equal(h.value.busy, true);
    h.args.eventId = "event-B";
    h.render();
    assert.equal(h.value.busy, false);
    h.flush();
    await h.settle();
    h.reads
      .at(-1)
      .resolve({ data: context("event-B", "new event"), error: null });
    await h.settle();
    h.value.queue(report(2, "event-B"));
    await h.settle();
    const newSync = h.value.sync();
    await h.settle();
    assert.equal(h.writes.length, 2);
    h.writes[0].resolve({ data: id(1), error: null });
    await oldSync;
    await h.settle();
    assert.equal(h.value.busy, true);
    assert.equal(h.value.context.observations[0].data.notes, "new event");
    h.writes[1].resolve({ data: id(2), error: null });
    await h.settle();
    h.reads
      .at(-1)
      .resolve({ data: context("event-B", "newer event"), error: null });
    await newSync;
    await h.settle();
    assert.equal(h.value.busy, false);
    assert.equal(h.value.outbox[0].payload.event_id, "event-B");
  } finally {
    await h.close();
  }
});

test("post-sync refresh supersedes an old read and never accepts its stale completion", async () => {
  const h = harness();
  try {
    await h.ready();
    const oldRead = h.value.refresh();
    h.value.queue(report());
    await h.settle();
    const sync = h.value.sync();
    await h.settle();
    h.writes[0].resolve({ data: id(1), error: null });
    await h.settle();
    assert.equal(h.reads.length, 3);
    assert.equal(h.reads[1].scope.signal.aborted, true);
    h.reads[2].resolve({ data: context("event-A", "fresh"), error: null });
    await sync;
    await h.settle();
    h.reads[1].resolve({ data: context("event-A", "old"), error: null });
    await oldRead;
    await h.settle();
    assert.equal(h.value.context.observations[0].data.notes, "fresh");
  } finally {
    await h.close();
  }
});

test("401/403 clears private snapshots and hides own records pending reauthentication", async () => {
  const h = harness();
  try {
    await h.ready();
    h.value.queue(report());
    await h.settle();
    const refresh = h.value.refresh();
    h.reads.at(-1).resolve({
      data: null,
      error: { status: 403, message: "Active account required" },
    });
    await refresh;
    await h.settle();
    assert.equal(h.failures, 1);
    assert.equal(h.value.context, null);
    assert.equal(h.value.store, null);
    assert.deepEqual(h.value.outbox, []);
    assert.equal(h.value.canScout, false);
    assert.equal(h.value.saveDraft(report(3)), null);
    await h.value.sync();
    assert.equal(h.writes.length, 0);
    assert.ok(h.storage.size > 0);
  } finally {
    await h.close();
  }
});

test("private team snapshots expire but own durable drafts and queue remain available", async () => {
  const h = harness();
  try {
    await h.ready();
    h.value.saveDraft(report());
    h.value.queue(report(2));
    h.event("offline");
    await h.settle();
    h.now += PRIVATE_SNAPSHOT_MAX_AGE_MS + 1;
    h.tick();
    await h.settle();
    assert.equal(h.value.context, null);
    assert.equal(h.value.updatedAt, null);
    assert.equal(h.value.drafts.length, 1);
    assert.equal(h.value.outbox.length, 1);
    assert.match(h.value.error, /snapshot expired/);
  } finally {
    await h.close();
  }
});

test("storage denial is surfaced without crashing the hook or claiming an empty saved queue", async () => {
  const h = harness();
  try {
    await h.ready();
    h.value.queue(report());
    h.denyStorage();
    h.event("storage", { key: null });
    await h.settle();
    assert.match(h.value.error, /storage is unavailable/i);
    assert.ok(h.value.storageIssues.length);
    assert.equal(h.value.saveDraft(report(3)), null);
    await h.settle();
    assert.match(h.value.error, /storage/);
  } finally {
    await h.close();
  }
});

test("readonly and unknown future roles never collect or sync scouting observations", async () => {
  for (const role of ["readonly", "parent", "guest"]) {
    const h = harness();
    try {
      await h.ready();
      h.args.profile = { ...h.args.profile, role };
      h.render();
      h.flush();
      await h.settle();
      assert.equal(h.value.canScout, false);
      assert.equal(h.value.saveDraft(report()), null);
      assert.equal(h.value.queue(report()), null);
      await h.value.sync();
      assert.equal(h.writes.length, 0);
    } finally {
      await h.close();
    }
  }
});

test("management strips id, uses single-flight locking, and blocks uncertain repeats until reviewed refresh", async () => {
  const h = harness();
  try {
    await h.ready();
    const payload = {
      id: id(700),
      team_number: 4418,
      rank: 1,
      status: "available",
      notes: "",
      version: 1,
    };
    const first = h.value.manage("picklist", payload);
    assert.equal(await h.value.manage("picklist", payload), false);
    await h.settle();
    assert.equal(h.writes.length, 1);
    assert.equal("id" in h.writes[0].payload.p, false);
    h.writes[0].reject(new Error("Lost reply"));
    assert.equal(await first, false);
    await h.settle();
    assert.equal(h.value.managementReady, false);
    assert.equal(await h.value.manage("picklist", payload), false);
    h.tick();
    await h.settle();
    h.reads.at(-1).resolve({ data: context(), error: null });
    await h.settle();
    assert.equal(h.value.managementReady, false);
    assert.match(h.value.error, /Lost reply/);
    const reviewed = h.value.refresh();
    h.reads.at(-1).resolve({ data: context(), error: null });
    await reviewed;
    await h.settle();
    assert.equal(h.value.managementReady, true);
    assert.equal(h.value.error, "");
  } finally {
    await h.close();
  }
});

test("malformed/cross-event context never replaces the current authorized snapshot", async () => {
  const h = harness();
  try {
    await h.ready();
    const refresh = h.value.refresh();
    h.reads.at(-1).resolve({ data: context("event-B"), error: null });
    await refresh;
    await h.settle();
    assert.equal(h.value.context.observations[0].event_id, "event-A");
    assert.match(h.value.error, /event changed/);
    assert.equal(h.value.managementReady, false);
  } finally {
    await h.close();
  }
});

test("re-authentication automatically resumes only the same account's reviewed queue", async () => {
  const h = harness();
  try {
    await h.ready();
    h.value.saveDraft(report(1));
    h.value.queue(report(2));
    await h.settle();
    assert.equal(
      h.writes.length,
      0,
      "draft edits and store queueing do not themselves invoke transport",
    );
    h.args.controller.abort();
    h.args.controller = new AbortController();
    h.render();
    h.flush();
    await h.settle();
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].payload.p.id, id(2));
    h.writes[0].resolve({ data: id(2), error: null });
    await h.settle();
    h.reads.at(-1).resolve({ data: context(), error: null });
    await h.settle();
    assert.equal(h.value.drafts.length, 1);
    assert.equal(h.value.outbox[0].status, "synced");
    h.tick();
    await h.settle();
    assert.equal(
      h.writes.length,
      1,
      "read polling does not repeatedly upload reports",
    );
  } finally {
    await h.close();
  }
});

test("automatic failure is retained and waits for reconnect or user retry", async () => {
  const h = harness();
  try {
    await h.ready();
    h.value.queue(report());
    h.event("offline");
    await h.settle();
    h.event("online");
    await h.settle();
    assert.equal(h.writes.length, 1);
    h.writes[0].reject(new Error("Network unavailable"));
    await h.settle();
    h.reads.at(-1).resolve({ data: context(), error: null });
    await h.settle();
    assert.equal(h.value.outbox[0].status, "error");
    h.tick();
    await h.settle();
    assert.equal(h.writes.length, 1);
    h.event("offline");
    h.event("online");
    await h.settle();
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[1].payload.p.id, h.writes[0].payload.p.id);
    h.writes[1].resolve({ data: id(1), error: null });
    await h.settle();
    h.reads.at(-1).resolve({ data: context(), error: null });
    await h.settle();
    assert.equal(h.value.outbox[0].status, "synced");
  } finally {
    await h.close();
  }
});

test("server-confirmed student leaders can manage, without client role-name overreach", async () => {
  const h = harness();
  try {
    await h.ready();
    h.args.profile = { ...h.args.profile, role: "student" };
    h.render();
    h.flush();
    await h.settle();
    const pending = h.value.manage("picklist", {
      team_number: 4418,
      rank: 1,
      status: "available",
      notes: "",
      version: 0,
    });
    await h.settle();
    assert.equal(h.writes.length, 1);
    h.writes[0].resolve({ data: id(700), error: null });
    await h.settle();
    h.reads.at(-1).resolve({ data: context(), error: null });
    assert.equal(await pending, true);
  } finally {
    await h.close();
  }
});

test("newly reviewed reports queued during another upload drain immediately afterward", async () => {
  const h = harness();
  try {
    await h.ready();
    h.value.queue(report(1));
    await h.settle();
    const first = h.value.sync();
    await h.settle();
    h.value.queue(report(2));
    await h.value.sync();
    await h.settle();
    assert.equal(h.writes.length, 1);
    h.writes[0].resolve({ data: id(1), error: null });
    await h.settle();
    h.reads.at(-1).resolve({ data: context(), error: null });
    await first;
    await h.settle();
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[1].payload.p.id, id(2));
    h.writes[1].resolve({ data: id(2), error: null });
    await h.settle();
    h.reads.at(-1).resolve({ data: context(), error: null });
    await h.settle();
    assert.ok(h.value.outbox.every((record) => record.status === "synced"));
  } finally {
    await h.close();
  }
});

test("station-only context is accepted while mixed or malformed assignment targets are rejected", async () => {
  const h = harness();
  try {
    await h.ready();
    const valid = {
      ...context(),
      assignments: [
        {
          id: id(700),
          event_id: "event-A",
          kind: "match",
          team_number: null,
          match_key: null,
          alliance: "blue",
          station: 3,
          assignee_id: id(100),
          version: 1,
        },
      ],
    };
    let refresh = h.value.refresh();
    h.reads.at(-1).resolve({ data: valid, error: null });
    await refresh;
    await h.settle();
    assert.equal(h.value.context.assignments[0].station, 3);
    for (const extra of [
      { team_number: 4418 },
      { match_key: "qm1" },
      { station: "3" },
      { kind: "pit" },
      { version: 0 },
    ]) {
      refresh = h.value.refresh();
      h.reads
        .at(-1)
        .resolve({
          data: {
            ...valid,
            assignments: [{ ...valid.assignments[0], ...extra }],
          },
          error: null,
        });
      await refresh;
      await h.settle();
      assert.match(h.value.error, /Unexpected scouting assignment/);
      assert.equal(h.value.managementReady, false);
      assert.equal(h.value.context.assignments[0].team_number, null);
    }
  } finally {
    await h.close();
  }
});
