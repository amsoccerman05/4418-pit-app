import { test } from "node:test";
import assert from "node:assert/strict";
import { competitionReadiness } from "../src/competition/readiness.ts";
const next = { key: "event_qm1", label: "Q1", completed: false, actual: null };
function fixture() {
  return {
    d: {
      matches: [{ id: "ops", match_key: next.key, battery_id: "battery" }],
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
