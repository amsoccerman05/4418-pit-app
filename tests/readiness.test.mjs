import { test } from "node:test";
import assert from "node:assert/strict";
import { competitionReadiness } from "../src/competition/readiness.ts";
const next = { key: "event_qm1", label: "Q1", completed: false, actual: null };
function fixture() {
  return {
    d: {
      matches: [{ id: "ops", match_key: next.key, battery_id: "battery" }],
      templates: [],
      runs: [{ id: "pre", kind: "pre", match_id: "ops" }],
      items: [
        {
          id: "check",
          run_id: "pre",
          blocking: true,
          required: true,
          completed_at: "done",
        },
      ],
    },
    data: {
      events: [{ id: "event", status: "active" }],
      issues: [],
      batteries: [
        {
          id: "battery",
          battery_number: "B01",
          active: true,
          status: "ON ROBOT",
        },
      ],
    },
  };
}
const state = (f, matches = [next]) =>
  competitionReadiness(f.d, f.data, matches);
test("readiness and reasons agree through assignment and explicit physical battery lifecycle", () => {
  const f = fixture();
  assert.equal(state(f).status, "READY");
  f.d.matches[0].battery_id = null;
  assert.equal(state(f).status, "NOT READY"); // installed battery is unassigned
  f.data.batteries[0].status = "READY";
  assert.equal(state(f).status, "NEEDS ATTENTION");
  f.d.matches[0].battery_id = "battery";
  assert.equal(state(f).status, "NEEDS ATTENTION");
  assert.match(state(f).reasons[0].text, /Install assigned battery/);
  for (const status of [
    "TESTING",
    "FLAGGED",
    "CHARGING",
    "COOLING",
    "RETIRED",
  ]) {
    f.data.batteries[0].status = status;
    assert.equal(state(f).status, "NOT READY");
  }
  f.data.batteries[0].status = "ON ROBOT";
  assert.equal(state(f).status, "READY");
  f.data.batteries.push({
    id: "other",
    battery_number: "B02",
    active: true,
    status: "ON ROBOT",
  });
  assert.equal(state(f).status, "NOT READY");
  f.data.batteries.pop();
  f.data.batteries[0].active = false;
  assert.equal(state(f).status, "NOT READY");
});
test("last completed post-match inspection clears without demanding a nonexistent next preflight", () => {
  const f = fixture(),
    completed = { ...next, completed: true };
  f.d.templates.push({ id: "post-template", kind: "post", active: true });
  assert.equal(state(f, [completed]).status, "NEEDS ATTENTION");
  assert.equal(f.data.batteries[0].status, "ON ROBOT");
  f.d.runs.push({ id: "post", kind: "post", match_id: "ops" });
  f.d.items.push({
    id: "post-check",
    run_id: "post",
    blocking: false,
    required: true,
    completed_at: null,
  });
  assert.equal(state(f, [completed]).status, "NEEDS ATTENTION");
  f.d.items[1].completed_at = "done";
  assert.equal(state(f, [completed]).status, "READY");
  assert.equal(state(f, [completed]).reasons.length, 0);
  f.d.items[0].completed_at = null;
  assert.equal(state(f, [completed]).status, "NOT READY"); // existing incomplete work still blocks
});

const postReasons = (result) =>
  result.reasons.filter((reason) => reason.key.startsWith("post:"));
const finishedPractice = (id, extra = {}) => ({
  id,
  match_key: `manual:${id}`,
  source: "manual",
  manual_label: `Practice ${id}`,
  finished_at: "2026-10-09T10:00:00.000Z",
  archived_at: null,
  ...extra,
});
function addPost(f, matchId = "ops", extra = {}) {
  const runId = `post-${matchId}`;
  f.d.runs.push({ id: runId, kind: "post", match_id: matchId });
  f.d.items.push({
    id: `check-${runId}`,
    run_id: runId,
    required: true,
    blocking: false,
    completed_at: null,
    ...extra,
  });
  return f.d.items.at(-1);
}

for (const templates of [
  [],
  [{ id: "pre-template", kind: "pre", active: true }],
  [{ id: "general-template", kind: "general", active: true }],
  [{ id: "post-template", kind: "post", active: false }],
]) {
  test(`finished official match has no invented postflight obligation with ${templates.length ? `${templates[0].active ? "active" : "inactive"} ${templates[0].kind} template` : "no templates"}`, () => {
    const f = fixture();
    f.d.templates = templates;
    const before = structuredClone(f);
    const result = state(f, [{ ...next, completed: true }]);
    assert.equal(result.status, "READY");
    assert.equal(result.postPending, false);
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(
      f,
      before,
      "readiness never creates runs or changes batteries",
    );
  });
}

test("an active post template requires the latest finished official inspection even before preparation is saved", () => {
  const f = fixture();
  f.d.matches = [];
  f.d.runs = [];
  f.d.items = [];
  f.d.templates.push({ id: "post-template", kind: "post", active: true });
  const result = state(f, [{ ...next, completed: true }]);
  assert.equal(result.status, "NEEDS ATTENTION");
  assert.equal(result.postPending, true);
  assert.deepEqual(postReasons(result), [
    {
      key: `post:${next.key}`,
      text: "Post-match inspection unfinished · Q1",
      blocking: false,
      matchKey: next.key,
    },
  ]);
});

for (const templateState of ["absent", "inactive", "active"]) {
  test(`existing postflight keeps required and blocking work, then clears when complete, with ${templateState} template`, () => {
    const f = fixture();
    if (templateState !== "absent")
      f.d.templates.push({
        id: "post-template",
        kind: "post",
        active: templateState === "active",
      });
    const item = addPost(f);
    const completed = [{ ...next, completed: true }];
    let result = state(f, completed);
    assert.equal(result.status, "NEEDS ATTENTION");
    assert.equal(result.postPending, true);
    assert.equal(postReasons(result).length, 1);
    item.required = false;
    item.blocking = true;
    result = state(f, completed);
    assert.equal(result.status, "NOT READY");
    assert.equal(result.postPending, true);
    item.completed_at = "done";
    result = state(f, completed);
    assert.equal(result.status, "READY");
    assert.equal(result.postPending, false);
    assert.deepEqual(result.reasons, []);
  });
}

test("empty and optional-only existing post runs keep completed inspection semantics", () => {
  const f = fixture();
  f.d.templates.push({ id: "post-template", kind: "post", active: true });
  const completed = [{ ...next, completed: true }];
  f.d.runs.push({ id: "empty-post", kind: "post", match_id: "ops" });
  assert.equal(state(f, completed).postPending, false);
  assert.equal(state(f, completed).status, "READY");
  addPost(f, "ops", { required: false });
  assert.equal(state(f, completed).postPending, false);
  assert.equal(state(f, completed).status, "READY");
});

test("finished and archived manual practices owe postflight only when configured or already started", () => {
  const f = fixture();
  f.d.matches = [
    finishedPractice("1", { archived_at: "2026-10-09T10:15:00.000Z" }),
    finishedPractice("2", { finished_at: "2026-10-09T11:00:00.000Z" }),
  ];
  f.d.runs = [];
  f.d.items = [];
  let result = state(f, []);
  assert.equal(result.last.key, "manual:2");
  assert.equal(result.status, "READY");
  assert.equal(result.postPending, false);
  assert.deepEqual(postReasons(result), []);
  f.d.templates.push({ id: "post-template", kind: "post", active: false });
  assert.equal(state(f, []).status, "READY");
  f.d.templates[0].active = true;
  result = state(f, []);
  assert.equal(result.status, "NEEDS ATTENTION");
  assert.deepEqual(
    postReasons(result).map((reason) => reason.matchKey),
    ["manual:1", "manual:2"],
  );
  f.d.templates[0].active = false;
  const oldInspection = addPost(f, "1");
  result = state(f, []);
  assert.equal(result.status, "NEEDS ATTENTION");
  assert.equal(
    result.postPending,
    false,
    "latest practice has no inspection obligation",
  );
  assert.deepEqual(
    postReasons(result).map((reason) => reason.matchKey),
    ["manual:1"],
  );
  oldInspection.completed_at = "done";
  result = state(f, []);
  assert.equal(result.status, "READY");
  assert.deepEqual(result.reasons, []);
});
test("optional checks do not block; unresolved robot-down and high issues retain priority", () => {
  const f = fixture();
  f.d.items.push({
    run_id: "pre",
    blocking: false,
    required: false,
    completed_at: null,
  });
  assert.equal(state(f).status, "READY");
  f.data.issues.push({
    id: "issue",
    event_id: "event",
    status: "DEFERRED",
    severity: "ROBOT DOWN",
    title: "Repair",
  });
  assert.equal(state(f).status, "NOT READY");
  f.data.issues[0].severity = "HIGH";
  assert.equal(state(f).status, "NEEDS ATTENTION");
  f.data.issues[0].status = "RESOLVED";
  assert.equal(state(f).status, "READY");
});
