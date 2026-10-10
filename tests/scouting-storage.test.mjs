import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScoutingStore,
  newScoutingId,
  ScoutingStorageError,
} from "../src/scouting/storage.ts";

class MemoryStorage {
  values = new Map();
  failRead = false;
  failWrite = false;
  failRemove = false;
  dropWrite = false;
  rejectKey = () => false;
  writes = [];
  get length() {
    if (this.failRead) throw new Error("blocked");
    return this.values.size;
  }
  key(index) {
    if (this.failRead) throw new Error("blocked");
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    if (this.failRead) throw new Error("blocked");
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.failWrite || this.rejectKey(key)) throw new Error("quota");
    this.writes.push(key);
    if (!this.dropWrite) this.values.set(key, String(value));
  }
  removeItem(key) {
    if (this.failRemove) throw new Error("blocked");
    this.values.delete(key);
  }
}
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: "scout-a", eventId: "event-a", demo: false };
const payload = (n = 1, overrides = {}) => ({
  id: id(n),
  event_id: scope.eventId,
  kind: "match",
  team_number: 4418,
  match_key: "2026test_qm1",
  data: { schema_version: 1, fuel: 7, notes: "clear observation" },
  ...overrides,
});
function setup(options = {}) {
  const storage = new MemoryStorage();
  let now = 10_000;
  let next = 1_000;
  const config = { now: () => now, uuid: () => id(next++), ...options };
  const store = createScoutingStore(storage, scope, config);
  return {
    storage,
    store,
    config,
    setTime: (time) => {
      now = time;
    },
    reload: () => createScoutingStore(storage, scope, config),
  };
}
const ack = (report) => ({ id: report.id, status: "saved" });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const code = (expected) => (error) =>
  error instanceof ScoutingStorageError && error.code === expected;

// Browser storage, without React, timers that submit, or any server dependency.
test("draft CRUD supports incomplete observations, verified saves, and reload", () => {
  const { store, reload, setTime } = setup();
  const blank = payload(1, {
    team_number: null,
    match_key: null,
    data: { notes: "" },
  });
  const first = store.saveDraft(blank, { expectedRevision: null });
  assert.equal(first.createdAt, 10_000);
  assert.equal(first.team_number, null);
  assert.deepEqual(reload().getDraft(id(1)), first);
  setTime(11_000);
  const second = store.saveDraft(
    { ...blank, team_number: 4418 },
    { expectedRevision: first.revision },
  );
  assert.notEqual(second.revision, first.revision);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.updatedAt, 11_000);
  assert.throws(
    () => store.saveDraft(blank, { expectedRevision: first.revision }),
    code("conflict"),
  );
  assert.throws(
    () => store.deleteDraft(id(1), { expectedRevision: first.revision }),
    code("conflict"),
  );
  store.deleteDraft(id(1), { expectedRevision: second.revision });
  assert.equal(reload().getDraft(id(1)), null);
});

test("returns detached records and protects the immutable report payload", () => {
  const { store } = setup();
  const source = payload();
  const draft = store.saveDraft(source);
  draft.data.fuel = 50;
  assert.equal(store.getDraft(source.id).data.fuel, 7);
  const report = store.queueReport(source);
  source.data.fuel = 100;
  report.payload.data.fuel = 200;
  assert.equal(store.getReport(source.id).payload.data.fuel, 7);
  assert.equal(store.getReport(source.id).status, "queued");
});

test("duplicate queue is idempotent with canonical JSON, collisions fail closed", () => {
  const { store, storage, reload } = setup();
  const first = store.queueReport(payload());
  const duplicate = store.queueReport(
    payload(1, {
      data: { notes: "clear observation", fuel: 7, schema_version: 1 },
      supersedes_id: null,
    }),
  );
  assert.deepEqual(duplicate, first);
  assert.equal(storage.writes.length, 1);
  assert.throws(
    () => store.queueReport(payload(1, { data: { fuel: 99 } })),
    code("conflict"),
  );
  assert.equal(reload().listOutbox().length, 1);
  assert.equal(reload().getReport(id(1)).payload.data.fuel, 7);
});

test("queue persists before deleting its matching draft and preserves newer differing drafts", () => {
  const { store, storage } = setup();
  const draft = store.saveDraft(payload());
  store.queueReport(payload(), { draftId: draft.id });
  assert.equal(store.getDraft(draft.id), null);
  assert.equal(store.getReport(draft.id).status, "queued");
  const newer = store.saveDraft(
    payload(1, { data: { notes: "new observations" } }),
  );
  store.queueReport(payload(), { draftId: draft.id });
  assert.deepEqual(store.getDraft(id(1)), newer);
  const another = store.saveDraft(payload(2));
  storage.failRemove = true;
  assert.equal(
    store.queueReport(payload(2), { draftId: another.id }).status,
    "queued",
  );
  assert.ok(store.getReadIssues().length);
  assert.ok(store.getDraft(another.id));
});

test("quota and silent dropped writes never claim a local save or remove a draft", () => {
  const { store, storage } = setup();
  const draft = store.saveDraft(payload());
  storage.failWrite = true;
  assert.throws(
    () => store.queueReport(payload(), { draftId: draft.id }),
    code("write_failed"),
  );
  assert.equal(store.getReport(id(1)), null);
  assert.deepEqual(store.getDraft(id(1)), draft);
  assert.throws(() => store.saveDraft(payload(2)), code("write_failed"));
  storage.failWrite = false;
  storage.dropWrite = true;
  assert.throws(() => store.saveDraft(payload(2)), code("write_failed"));
  assert.equal(store.getDraft(id(2)), null);
});

test("account, event, and demo scopes cannot see or import each other's records", () => {
  const { store, storage } = setup();
  store.saveDraft(payload());
  store.queueReport(payload(2));
  const backup = store.exportRecords();
  for (const other of [
    { ...scope, actorId: "scout-b" },
    { ...scope, eventId: "event-b" },
    { ...scope, demo: true },
  ]) {
    const isolated = createScoutingStore(storage, other);
    assert.deepEqual(isolated.listDrafts(), []);
    assert.deepEqual(isolated.listOutbox(), []);
    assert.throws(() => isolated.importRecords(backup), code("invalid"));
  }
  assert.equal(createScoutingStore(storage, scope).listOutbox().length, 1);
  const a = createScoutingStore(storage, {
    ...scope,
    actorId: "a:b",
    eventId: "c",
  });
  const b = createScoutingStore(storage, {
    ...scope,
    actorId: "a",
    eventId: "b:c",
  });
  assert.notEqual(a.storagePrefix, b.storagePrefix);
});

test("different tabs write separate keys and preserve all reports and drafts", () => {
  const { store: tabA, reload } = setup();
  const tabB = reload();
  tabA.saveDraft(payload(1));
  tabB.saveDraft(payload(2));
  tabA.queueReport(payload(3));
  tabB.queueReport(payload(4));
  assert.deepEqual(
    tabA.listDrafts().map((x) => x.id),
    [id(1), id(2)],
  );
  assert.deepEqual(
    tabB.listOutbox().map((x) => x.payload.id),
    [id(3), id(4)],
  );
  const a = tabA.getDraft(id(1));
  tabB.saveDraft(payload(1, { data: { fuel: 8 } }), {
    expectedRevision: a.revision,
  });
  assert.throws(
    () => tabA.saveDraft(payload(1), { expectedRevision: a.revision }),
    code("conflict"),
  );
});

test("bad JSON and corrupt scope are retained, reported, and never silently cleared", () => {
  const { store, storage } = setup();
  const badKey = `${store.storagePrefix}report:${id(1)}`;
  const mismatch = `${store.storagePrefix}draft:${id(2)}`;
  storage.values.set(badKey, "{truncated JSON");
  storage.values.set(
    mismatch,
    JSON.stringify({
      version: 1,
      scope: { ...scope, actorId: "other" },
      draft: payload(2),
    }),
  );
  store.queueReport(payload(3));
  assert.equal(store.listOutbox().length, 1);
  assert.deepEqual(store.listDrafts(), []);
  assert.equal(store.getReadIssues().length, 2);
  assert.equal(storage.values.get(badKey), "{truncated JSON");
  assert.throws(() => store.getReport(id(1)), code("corrupt"));
  assert.throws(() => store.queueReport(payload(1)), code("corrupt"));
  assert.throws(() => store.exportRecords(), code("corrupt"));
});

test("storage read denial is a visible error, not an empty list", () => {
  const { store, storage } = setup();
  store.queueReport(payload());
  storage.failRead = true;
  assert.throws(() => store.listOutbox(), code("unavailable"));
  assert.throws(() => store.listDrafts(), code("unavailable"));
  assert.throws(() => store.getReport(id(1)), code("unavailable"));
});

test("structural validation rejects unsafe JSON and invalid report metadata", () => {
  const { store } = setup();
  for (const p of [
    payload(1, { id: "not-a-uuid" }),
    payload(1, { event_id: "other-event" }),
    payload(1, { team_number: null }),
    payload(1, { team_number: -1 }),
    payload(1, { team_number: 1.5 }),
    payload(1, { match_key: null }),
    payload(1, { kind: "pit" }),
    payload(1, { data: [] }),
    payload(1, { data: { fuel: NaN } }),
    payload(1, { data: { fuel: Infinity } }),
    payload(1, { data: { fuel: undefined } }),
    payload(1, { data: { date: new Date() } }),
    payload(1, { data: { values: Array(2) } }),
    payload(1, { data: { bigint: 1n } }),
    payload(1, { data: { note: "x".repeat(64_001) } }),
    payload(1, { supersedes_id: id(1) }),
    payload(1, { created_by: "not-submittable" }),
  ])
    assert.throws(() => store.queueReport(p), code("invalid"));
  const circular = {};
  circular.self = circular;
  assert.throws(
    () => store.queueReport(payload(1, { data: circular })),
    code("invalid"),
  );
  assert.equal(store.listOutbox().length, 0);
  assert.equal(
    store.queueReport(payload(2, { kind: "pit", match_key: null })).payload
      .kind,
    "pit",
  );
  assert.equal(
    store.queueReport(payload(3, { supersedes_id: id(2) })).payload
      .supersedes_id,
    id(2),
  );
  assert.match(newScoutingId(), /^[a-f0-9-]{36}$/);
});

test("injected game schema validator runs on queue and import, while incomplete drafts remain possible", () => {
  const { store } = setup({
    validateReport(p) {
      if (p.data.schema_version !== 1)
        throw new Error("Unsupported form version");
    },
  });
  store.saveDraft(payload(1, { data: {} }));
  assert.throws(
    () => store.queueReport(payload(2, { data: {} })),
    /Unsupported form/,
  );
  const source = JSON.stringify({
    format: "4418-scouting",
    version: 1,
    scope,
    drafts: [],
    reports: [payload(3), payload(4, { data: {} })],
  });
  assert.throws(() => store.importRecords(source), /Unsupported form/);
  assert.equal(store.listOutbox().length, 0);
});

test("sync is explicit, saves a confirmed receipt, preserves reports, and skips synced retries", async () => {
  const { store, reload } = setup();
  store.queueReport(payload());
  let calls = 0;
  assert.equal(reload().getReport(id(1)).status, "queued");
  const changes = [];
  const result = await store.syncReports(
    async (report) => {
      calls++;
      return ack(report);
    },
    { onChange: (record) => changes.push(record.status) },
  );
  assert.deepEqual(result, { synced: 1, failed: 0, skipped: 0 });
  assert.deepEqual(changes, ["syncing", "synced"]);
  assert.equal(reload().getReport(id(1)).status, "synced");
  assert.equal(reload().listOutbox().length, 1);
  await reload().syncReports(async (report) => {
    calls++;
    return ack(report);
  });
  assert.equal(calls, 1);
});

test("no missing, mismatched, or negative acknowledgment can mark a record synced", async () => {
  for (const result of [
    null,
    undefined,
    {},
    { id: id(99), status: "saved" },
    { id: id(1), status: "queued" },
  ]) {
    const { store, reload } = setup();
    store.queueReport(payload());
    const outcome = await store.syncReports(async () => result);
    assert.equal(outcome.failed, 1);
    assert.equal(reload().getReport(id(1)).status, "error");
    assert.equal(reload().getReport(id(1)).syncedAt, null);
    assert.equal(reload().listOutbox().length, 1);
  }
});

test("failure and explicit retry use exactly the same client UUID and bounded error", async () => {
  const { store, reload } = setup();
  store.queueReport(payload());
  const sent = [];
  await store.syncReports(async (report) => {
    sent.push(report);
    report.data.fuel = 100;
    throw new Error("offline\n" + "x".repeat(500));
  });
  const failed = reload().getReport(id(1));
  assert.equal(failed.status, "error");
  assert.equal(failed.payload.data.fuel, 7);
  assert.equal(failed.lastError.length, 240);
  assert.ok(!failed.lastError.includes("\n"));
  await reload().syncReports(async (report) => {
    sent.push(report);
    return ack(report);
  });
  assert.deepEqual(
    sent.map((x) => x.id),
    [id(1), id(1)],
  );
  assert.equal(reload().getReport(id(1)).attempts, 2);
  assert.equal(reload().getReport(id(1)).status, "synced");
});

test("repeated sync clicks share in-flight work and another tab skips the fresh lease", async () => {
  const { store, reload } = setup();
  store.queueReport(payload());
  const pending = deferred();
  let calls = 0;
  const first = store.syncReports(async () => {
    calls++;
    return pending.promise;
  });
  const second = store.syncReports(async () => {
    calls++;
    return ack(payload());
  });
  assert.equal(first, second);
  await tick();
  assert.equal(calls, 1);
  assert.equal(reload().getReport(id(1)).status, "syncing");
  assert.deepEqual(
    await reload().syncReports(async () => {
      calls++;
      return ack(payload());
    }),
    { synced: 0, failed: 0, skipped: 1 },
  );
  pending.resolve(ack(payload()));
  await first;
  assert.equal(calls, 1);
});

test("interrupted sync expires safely; a new tab retries and stale failures cannot erase its receipt", async () => {
  const { store, reload, setTime } = setup({ syncTimeoutMs: 10_000 });
  store.queueReport(payload());
  const pending = deferred();
  const first = store.syncReports(async () => pending.promise);
  await tick();
  setTime(21_001);
  const tabB = reload();
  assert.equal(tabB.getReport(id(1)).status, "error");
  assert.match(tabB.getReport(id(1)).lastError, /interrupted/);
  assert.deepEqual(await tabB.syncReports(async (report) => ack(report)), {
    synced: 1,
    failed: 0,
    skipped: 0,
  });
  pending.reject(new Error("old network request failed late"));
  await first;
  assert.equal(reload().getReport(id(1)).status, "synced");
  assert.equal(reload().getReport(id(1)).lastError, null);
});

test("a hung network request times out without deleting or confirming the report", async () => {
  const { store, reload } = setup({ syncTimeoutMs: 5 });
  store.queueReport(payload());
  assert.equal(
    (await store.syncReports(async () => new Promise(() => {}))).failed,
    1,
  );
  assert.match(reload().getReport(id(1)).lastError, /timed out/);
  assert.equal(reload().getReport(id(1)).status, "error");
  await reload().syncReports(async (report) => ack(report));
  assert.equal(reload().getReport(id(1)).status, "synced");
});

test("switching account/event stops further sends and selected-ID sync leaves other records alone", async () => {
  const { store } = setup();
  store.queueReport(payload(1));
  store.queueReport(payload(2));
  store.queueReport(payload(3));
  let current = true;
  const sent = [];
  const result = await store.syncReports(
    async (report) => {
      sent.push(report.id);
      current = false;
      return ack(report);
    },
    { shouldContinue: () => current },
  );
  assert.deepEqual(sent, [id(1)]);
  assert.deepEqual(result, { synced: 1, failed: 0, skipped: 2 });
  await store.syncReports(
    async (report) => {
      sent.push(report.id);
      return ack(report);
    },
    { ids: [id(3)] },
  );
  assert.deepEqual(sent, [id(1), id(3)]);
  assert.equal(store.getReport(id(2)).status, "queued");
});

test("a failed attempt-state write prevents a server request", async () => {
  const { store, storage } = setup();
  store.queueReport(payload());
  storage.failWrite = true;
  let called = false;
  await assert.rejects(
    store.syncReports(async (report) => {
      called = true;
      return ack(report);
    }),
    code("write_failed"),
  );
  assert.equal(called, false);
  assert.equal(store.getReport(id(1)).status, "queued");
});

test("server success without a durable local receipt is retained for idempotent retry", async () => {
  const { store, storage, reload } = setup();
  store.queueReport(payload());
  storage.rejectKey = (key) => key.includes(":receipt:");
  const result = await store.syncReports(async (report) => ack(report));
  assert.deepEqual(result, { synced: 0, failed: 1, skipped: 0 });
  assert.equal(reload().getReport(id(1)).status, "error");
  assert.equal(reload().getReport(id(1)).syncedAt, null);
  storage.rejectKey = () => false;
  await reload().syncReports(async (report) => ack(report));
  assert.equal(reload().getReport(id(1)).status, "synced");
});

test("corrupt attempt or receipt cannot hide a report or fake a server acknowledgment", () => {
  const { store, storage } = setup();
  store.queueReport(payload());
  storage.values.set(
    `${store.storagePrefix}receipt:${id(1)}`,
    JSON.stringify({
      version: 1,
      scope,
      confirmedAt: 10000,
      payload: "not a report",
    }),
  );
  storage.values.set(`${store.storagePrefix}attempt:${id(1)}`, "{bad json");
  assert.equal(store.getReport(id(1)).status, "error");
  assert.equal(store.getReport(id(1)).syncedAt, null);
  assert.equal(store.listOutbox().length, 1);
  assert.equal(store.getReadIssues().length, 2);
});

test("UI notification failures cannot regress a durable server acknowledgment", async () => {
  const { store } = setup();
  store.queueReport(payload());
  assert.equal(
    (
      await store.syncReports(async (report) => ack(report), {
        onChange() {
          throw new Error("render");
        },
      })
    ).synced,
    1,
  );
  assert.equal(store.getReport(id(1)).status, "synced");
});

test("export/import is scoped, preserves UUIDs, is idempotent, and never automatically sends", async () => {
  const { store } = setup();
  store.saveDraft(payload(1, { team_number: null, match_key: null }));
  store.queueReport(payload(2));
  store.queueReport(payload(3));
  await store.syncReports(async (report) => ack(report), { ids: [id(3)] });
  const backup = store.exportRecords();
  const destination = setup().store;
  assert.deepEqual(destination.importRecords(backup), {
    drafts: 1,
    reports: 2,
  });
  assert.deepEqual(destination.importRecords(backup), {
    drafts: 0,
    reports: 0,
  });
  assert.deepEqual(
    destination.listOutbox().map((x) => x.payload.id),
    [id(2), id(3)],
  );
  assert.ok(destination.listOutbox().every((x) => x.status === "queued"));
  assert.equal(destination.listDrafts()[0].team_number, null);
});

test("import validates all records and duplicate/colliding UUIDs before any writes", () => {
  const { store, storage } = setup();
  const make = (reports, drafts = []) =>
    JSON.stringify({
      format: "4418-scouting",
      version: 1,
      scope,
      drafts,
      reports,
    });
  assert.throws(() => store.importRecords("{"), code("invalid"));
  assert.throws(
    () =>
      store.importRecords(make([payload(1), payload(2, { id: "invalid" })])),
    code("invalid"),
  );
  assert.throws(
    () =>
      store.importRecords(
        make([payload(1), payload(1, { data: { fuel: 10 } })]),
      ),
    code("conflict"),
  );
  assert.equal(storage.length, 0);
  store.queueReport(payload(2));
  assert.throws(
    () =>
      store.importRecords(
        make([payload(1), payload(2, { data: { fuel: 10 } })]),
      ),
    code("conflict"),
  );
  assert.equal(store.getReport(id(1)), null);
  assert.equal(store.getReport(id(2)).payload.data.fuel, 7);
});

test("partially completed import under quota is safe to retry without overwrites", () => {
  const source = setup().store;
  source.queueReport(payload(1));
  source.queueReport(payload(2));
  const { store, storage } = setup();
  storage.rejectKey = (key) => key.endsWith(id(2));
  assert.throws(
    () => store.importRecords(source.exportRecords()),
    /Some records may already be saved/,
  );
  assert.ok(store.getReport(id(1)));
  assert.equal(store.getReport(id(2)), null);
  storage.rejectKey = () => false;
  assert.deepEqual(store.importRecords(source.exportRecords()), {
    drafts: 0,
    reports: 1,
  });
  assert.equal(store.listOutbox().length, 2);
});
