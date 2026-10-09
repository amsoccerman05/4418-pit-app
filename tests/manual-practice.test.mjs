import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isManualMatch,
  latestCompletedMatch,
  manualMatches,
  nextOperationalMatch,
  nextPracticeLabel,
} from "../src/competition/manual.ts";
import { competitionReadiness } from "../src/competition/readiness.ts";

const at = "2026-10-09T10:00:00.000Z";
const after = "2026-10-09T11:00:00.000Z";
const official = {
  key: "2026test_qm17",
  label: "Q17",
  level: "qm",
  number: 17,
  set: 1,
  red: ["4418", "1619", "1339"],
  blue: ["2996", "3648", "4593"],
  alliance: "red",
  scheduled: Date.parse(at),
  predicted: null,
  actual: null,
  completed: false,
  redScore: null,
  blueScore: null,
  winner: "",
};
const practice = (id = "practice", extra = {}) => ({
  id,
  event_id: "event",
  match_key: `manual:${id}`,
  source: "manual",
  manual_label: "Driver practice",
  scheduled_at: null,
  finished_at: null,
  finished_by: null,
  archived_at: null,
  archived_by: null,
  battery_id: null,
  note: "",
  version: 1,
  ...extra,
});

test("next practice label advances numbered history, includes archives, and does not mutate records", () => {
  assert.equal(nextPracticeLabel([]), "Practice 1");
  const ops = [
    practice("one", { manual_label: "Practice 1", finished_at: at }),
    practice("archived", {
      manual_label: "  PRACTICE   04  ",
      archived_at: at,
    }),
    practice("custom", { manual_label: "Drive-team warmup" }),
    { source: "tba", manual_label: "Practice 99" },
  ];
  const before = structuredClone(ops);
  assert.equal(nextPracticeLabel(ops), "Practice 5");
  assert.deepEqual(ops, before);
  assert.equal(
    nextPracticeLabel([
      practice("large", {
        manual_label: `Practice ${Number.MAX_SAFE_INTEGER}`,
      }),
    ]),
    "Practice 1",
  );
});

test("manual projection is explicit local provenance, with no fabricated alliances, score or match metadata", () => {
  const ops = [
    practice("one", { scheduled_at: at }),
    { id: "official", match_key: official.key },
    { id: "legacy", match_key: "manual:legacy" },
  ];
  const snapshot = structuredClone(ops);
  const [match] = manualMatches(ops);
  assert.deepEqual(match, {
    source: "manual",
    key: "manual:one",
    label: "Driver practice",
    scheduled: Date.parse(at),
    actual: null,
    completed: false,
    finishedAt: null,
    archived: false,
  });
  assert.equal(manualMatches(ops).length, 1);
  assert.equal(isManualMatch(match), true);
  assert.equal(isManualMatch(official), false);
  for (const key of [
    "alliance",
    "red",
    "blue",
    "redScore",
    "blueScore",
    "winner",
    "number",
    "level",
  ]) {
    assert.equal(Object.hasOwn(match, key), false, key);
  }
  assert.deepEqual(ops, snapshot);
});

test("manual ordering is scheduled first, then natural label order with a deterministic identity tie break", () => {
  const ops = [
    practice("same-b", { manual_label: "Practice 2" }),
    practice("ten", { manual_label: "Practice 10" }),
    practice("later", { manual_label: "A", scheduled_at: after }),
    practice("same-a", { manual_label: "Practice 2" }),
    practice("first", { manual_label: "Z", scheduled_at: at }),
    practice("hidden", {
      scheduled_at: "2026-10-09T09:00:00.000Z",
      archived_at: at,
    }),
  ];
  assert.deepEqual(
    manualMatches(ops).map((m) => m.key),
    [
      "manual:first",
      "manual:later",
      "manual:same-a",
      "manual:same-b",
      "manual:ten",
    ],
  );
  assert.equal(manualMatches(ops, true)[0].key, "manual:hidden");
  assert.equal(manualMatches(ops, true)[0].archived, true);
  assert.equal(manualMatches(ops).at(-1).scheduled, null);
});

test("active unfinished manual practice has preparation priority without mutating the official feed", () => {
  const feed = [structuredClone(official)];
  const snapshot = structuredClone(feed);
  const ops = [
    practice("finished", { finished_at: at }),
    practice("archived", { archived_at: at }),
    practice("active", { scheduled_at: after }),
  ];
  assert.equal(nextOperationalMatch(feed, ops).key, "manual:active");
  assert.deepEqual(feed, snapshot);
  ops[2].finished_at = after;
  assert.equal(nextOperationalMatch(feed, ops), feed[0]);
  assert.equal(nextOperationalMatch([], ops), null);
  ops[2].finished_at = null;
  ops[2].archived_at = after;
  assert.equal(nextOperationalMatch(feed, ops), feed[0]);
});

test("completed selection uses explicit manual finish time and retains archived history", () => {
  const completed = {
    ...official,
    completed: true,
    actual: Date.parse(at),
    redScore: 50,
    blueScore: 30,
    winner: "red",
  };
  const ops = [
    practice("older", { finished_at: "2026-10-09T09:00:00.000Z" }),
    practice("latest", { finished_at: after, archived_at: after }),
    practice("future", { scheduled_at: "2027-01-01T00:00:00.000Z" }),
  ];
  assert.equal(latestCompletedMatch([completed], ops).key, "manual:latest");
  assert.equal(latestCompletedMatch([completed], [ops[0]]), completed);
  assert.equal(latestCompletedMatch([], [ops[1]]).archived, true);
  assert.equal(latestCompletedMatch([official], [ops[2]]), null);
});

function readinessFixture(ops) {
  return {
    d: { matches: ops, runs: [], items: [], config: null },
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
const readiness = (f, feed = []) => competitionReadiness(f.d, f.data, feed);
function completePost(f, id) {
  f.d.runs.push({ id: `post-${id}`, match_id: id, kind: "post" });
  f.d.items.push({
    id: `check-${id}`,
    run_id: `post-${id}`,
    required: true,
    blocking: false,
    completed_at: after,
  });
}

test("manual preflight and assigned physical battery determine readiness without feed configuration", () => {
  const f = readinessFixture([practice("practice", { battery_id: "battery" })]);
  assert.equal(readiness(f).next.key, "manual:practice");
  assert.equal(readiness(f).status, "NEEDS ATTENTION");
  f.d.runs.push({ id: "pre", match_id: "practice", kind: "pre" });
  f.d.items.push({
    id: "pre-check",
    run_id: "pre",
    blocking: true,
    required: true,
    completed_at: null,
  });
  assert.equal(readiness(f).status, "NOT READY");
  f.d.items[0].completed_at = at;
  assert.equal(readiness(f).status, "READY");
  f.data.batteries[0].status = "READY";
  assert.equal(readiness(f).status, "NEEDS ATTENTION");
  assert.ok(
    readiness(f).reasons.some((r) =>
      /Install assigned battery B01/.test(r.text),
    ),
  );
  f.data.batteries[0].status = "ON ROBOT";
  f.d.matches[0].finished_at = after;
  assert.equal(readiness(f).next, null);
  assert.equal(readiness(f).status, "NEEDS ATTENTION");
  assert.equal(f.data.batteries[0].status, "ON ROBOT");
  assert.equal(f.d.runs.length, 1);
  completePost(f, "practice");
  assert.equal(readiness(f).status, "READY");
});

test("every finished manual practice owes postflight even when archived or a later inspection is complete", () => {
  const f = readinessFixture([
    practice("older", { finished_at: at, archived_at: after }),
    practice("latest", { finished_at: after }),
  ]);
  completePost(f, "latest");
  let state = readiness(f);
  assert.equal(state.last.key, "manual:latest");
  assert.equal(state.status, "NEEDS ATTENTION");
  assert.ok(
    state.reasons.some(
      (r) =>
        r.matchKey === "manual:older" && /Post-match inspection/.test(r.text),
    ),
  );
  completePost(f, "older");
  state = readiness(f);
  assert.equal(state.status, "READY");
  assert.equal(state.reasons.length, 0);
  f.d.items.find((i) => i.id === "check-older").completed_at = null;
  assert.equal(readiness(f).status, "NEEDS ATTENTION");
});

test("archiving unfinished practice removes preparation priority but preserves existing blocking work", () => {
  const f = readinessFixture([practice("archived", { archived_at: after })]);
  f.d.runs.push({ id: "old-pre", match_id: "archived", kind: "pre" });
  f.d.items.push({
    id: "old-check",
    run_id: "old-pre",
    blocking: true,
    required: true,
    completed_at: null,
  });
  const snapshot = structuredClone(f);
  const state = readiness(f);
  assert.equal(state.next, null);
  assert.equal(state.status, "NOT READY");
  assert.equal(state.incomplete.length, 1);
  assert.deepEqual(f, snapshot);
});

// Real component markup is separately covered here when local browser launch is
// unavailable. This deliberately does not stand in for the Playwright flows.
const require = createRequire(import.meta.url);
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, path) =>
    module._compile(
      ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      path,
    );
}
require.extensions[".css"] = () => {};
require.cache[require.resolve("../src/client.ts")] = {
  exports: { supabase: null },
};
const { CompetitionWorkspace } = require("../src/competition/Workspace.tsx");
const {
  PracticeControls,
  PracticeEditor,
} = require("../src/competition/ManualPractice.tsx");
const { CompetitionDashboard } = require("../src/competition/Dashboard.tsx");
const { PitDisplay } = require("../src/competition/PitDisplay.tsx");
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));

function componentFixture() {
  const f = readinessFixture([practice()]);
  const profile = {
    id: "crew",
    display_name: "Test Crew",
    active: true,
    role: "mentor",
  };
  Object.assign(f.d, {
    can_manage: true,
    manual_matches_enabled: true,
    templates: [],
    links: [],
    areas: [],
  });
  Object.assign(f.data, { profiles: [profile], batteryEvents: [] });
  const now = Date.now();
  const c = {
    context: f.d,
    contextAt: now,
    tick: now,
    feed: null,
    readOnly: false,
    busy: false,
    refreshing: false,
    liveAvailable: false,
    online: true,
    error: "",
    feedError: "",
    refresh() {},
  };
  return {
    ...f,
    c,
    competition: c,
    profile,
    state: readiness(f),
    dataUpdatedAt: now,
    dataError: "",
    page: "matches",
    team: 4418,
    eventName: "Practice event",
    open() {},
    report() {},
    openIssue() {},
    batteryAction() {},
    close() {},
    go() {},
  };
}

test("rendered Matches exposes manual practice without feed configuration and enforces capability and role gates", () => {
  const props = componentFixture();
  let html = render(CompetitionWorkspace, props);
  for (const text of [
    "Manual practice",
    "Add practice match",
    "Driver practice",
    "Official matches · TBA",
  ]) {
    assert.ok(html.includes(text), text);
  }
  props.d.can_manage = false;
  html = render(CompetitionWorkspace, props);
  assert.ok(!html.includes("Add practice match"));
  assert.ok(html.includes("Driver practice"));
  props.d.can_manage = true;
  props.d.manual_matches_enabled = false;
  html = render(CompetitionWorkspace, props);
  assert.ok(
    html.includes("Manual practice is not enabled on this server yet."),
  );
  assert.ok(!html.includes("Add practice match"));
  props.d.manual_matches_enabled = true;
  props.data.events[0].status = "completed";
  html = render(CompetitionWorkspace, props);
  assert.ok(
    html.includes(
      "Activate a Pit event in Event before adding practice matches.",
    ),
  );
  assert.ok(!html.includes("Add practice match"));
});

test("rendered manual controls preserve completion and archive provenance and disable mutation while busy", () => {
  const f = componentFixture();
  const props = {
    ops: f.d.matches[0],
    d: f.d,
    eventId: "event",
    busy: true,
    act() {},
    profiles: f.data.profiles,
  };
  let html = render(PracticeControls, props);
  for (const name of ["Edit practice", "Finish practice", "Archive practice"]) {
    assert.match(
      html,
      new RegExp(`<button[^>]*disabled=""[^>]*>${name}</button>`),
    );
  }
  assert.ok(!html.includes("Confirm finished"));
  props.ops.finished_at = at;
  props.ops.finished_by = "crew";
  props.ops.archived_at = after;
  props.ops.archived_by = "crew";
  html = render(PracticeControls, props);
  assert.ok(html.includes("Finished by Test Crew"));
  assert.ok(html.includes("Archived by Test Crew"));
  assert.ok(html.includes("Checklist history is retained."));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Restore practice<\/button>/);
  assert.ok(!html.includes("Finish practice"));
  f.d.can_manage = false;
  html = render(PracticeControls, props);
  assert.ok(!html.includes("<button"));
  html = render(PracticeEditor, {
    eventId: "event",
    d: f.d,
    busy: true,
    save() {},
    cancel() {},
  });
  assert.ok(html.includes("Practice label"));
  assert.ok(html.includes('type="datetime-local"'));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Add practice<\/button>/);
});

test("next practice editor prefills a reviewable label but no time or copied preparation", () => {
  const f = componentFixture();
  const html = render(PracticeEditor, {
    initialLabel: "Practice 7",
    eventId: "event",
    d: f.d,
    busy: false,
    save() {},
    cancel() {},
  });
  assert.match(html, /name="label"[^>]*value="Practice 7"/);
  assert.match(html, /name="scheduled"[^>]*value=""/);
  assert.ok(html.includes("Start fresh checklists from your templates"));
  assert.ok(html.includes("earlier inspections stay on their own practice"));
});

test("dashboard and pit display render manual preparation without fabricated teams, scores or standings", () => {
  const props = componentFixture();
  const dashboard = render(CompetitionDashboard, props);
  const display = render(PitDisplay, props);
  assert.ok(dashboard.includes("NEXT MANUAL PRACTICE"));
  assert.ok(dashboard.includes("Driver practice"));
  assert.ok(
    dashboard.includes(
      "Finish or archive this practice to move on to the next match.",
    ),
  );
  assert.ok(
    display.includes("Manual practice · confirm timing with field crew"),
  );
  assert.ok(display.includes("Finish or archive practice to move on"));
  for (const html of [dashboard, display]) {
    assert.ok(!html.includes("QUALIFICATION RANK"));
    assert.ok(!html.includes("Red 0"));
    assert.ok(!html.includes("Blue 0"));
    assert.ok(!html.includes("1619"));
  }
});

test("manual preparation priority retains the official NEXT marker and progress window around the next official match", () => {
  const props = componentFixture();
  const matches = Array.from({ length: 12 }, (_, index) => ({
    ...official,
    key: `2026test_qm${index + 1}`,
    label: `Q${index + 1}`,
    number: index + 1,
    completed: index < 9,
    redScore: index < 9 ? 75 : null,
    blueScore: index < 9 ? 40 : null,
    winner: index < 9 ? "red" : "",
  }));
  props.c.feed = { configured: true, matches, tbaAt: Date.now() };
  props.state = competitionReadiness(props.d, props.data, matches);
  const html = render(CompetitionDashboard, props);
  assert.equal(props.state.next.key, "manual:practice");
  assert.ok(html.includes("NEXT MANUAL PRACTICE"));
  const progress = html.match(
    /<div class="comp-progress">([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(progress, "official progress strip is retained");
  assert.match(
    progress,
    /<button aria-current="step"><strong>Q10<\/strong><small>NEXT<\/small>/,
  );
  for (const number of [8, 9, 10, 11, 12])
    assert.ok(progress.includes(`<strong>Q${number}</strong>`));
  assert.ok(!progress.includes("<strong>Q1</strong>"));
  assert.ok(!progress.includes("Driver practice"));
  assert.ok(
    html.includes("4418: 9 of 12 published qualification matches complete"),
  );
});

test("dashboard retains Report issue when the only practice is archived and unfinished", () => {
  const props = componentFixture();
  props.d.matches[0].archived_at = after;
  props.state = competitionReadiness(props.d, props.data, []);
  assert.equal(props.state.next, null);
  assert.equal(props.state.last, null);
  let html = render(CompetitionDashboard, props);
  assert.equal((html.match(/>Report issue<\/button>/g) || []).length, 1);
  props.c.readOnly = true;
  html = render(CompetitionDashboard, props);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Report issue<\/button>/);
});

test("global checklist history shows the manual practice label instead of its opaque key", () => {
  const props = componentFixture();
  props.page = "checklists";
  props.d.runs.push({
    id: "saved-pre",
    match_id: "practice",
    kind: "pre",
    name: "Saved preflight",
    template_version: 1,
    started_at: at,
  });
  props.d.items.push({
    id: "saved-check",
    run_id: "saved-pre",
    text: "Latch check",
    required: true,
    blocking: true,
    completed_at: at,
    completed_by: "crew",
    version: 1,
  });
  const html = render(CompetitionWorkspace, props);
  assert.ok(html.includes("Saved preflight"));
  assert.ok(html.includes("Driver practice"));
  assert.ok(html.includes("Latch check"));
  assert.ok(!html.includes("manual:practice"));
});
