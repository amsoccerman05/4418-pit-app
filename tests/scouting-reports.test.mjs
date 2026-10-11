import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the real local component and helpers without a live account or transport.
// Browser tests independently verify dialog focus, interaction, and layout.
const require = createRequire(import.meta.url);
for (const extension of [".ts", ".tsx"])
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
const { initialData } = require("../src/scouting/model.ts");
const {
  scoutName,
  originalScout,
  reportTitle,
  reportFields,
  filterReports,
} = require("../src/scouting/reports.ts");
const { TeamReports } = require("../src/scouting/TeamReports.tsx");
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const profiles = [
  {
    id: id(1),
    display_name: "  Alex Fixture  ",
    role: "student",
    active: true,
  },
  { id: id(2), display_name: "Morgan Fixture", role: "mentor", active: true },
  { id: id(3), display_name: "", role: "student", active: true },
  { id: id(4), display_name: " \n\t ", role: "student", active: true },
  {
    id: id(5),
    display_name: "private@example.invalid",
    role: "student",
    active: true,
  },
  { id: id(6), display_name: id(60), role: "student", active: true },
];
function report(n, kind = "match", fields = {}) {
  return {
    id: id(100 + n),
    event_id: "synthetic-event",
    team_number: 4418,
    kind,
    match_key: kind === "match" ? `manual:${id(300)}` : null,
    data: {
      ...initialData(kind),
      ...(kind === "match" ? { match_label: `Qualification ${n}` } : {}),
      ...fields,
    },
    created_by: id(1),
    created_at: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(),
  };
}
const filter = (reports, options = {}) =>
  filterReports(reports, profiles, {
    kind: "all",
    search: "",
    includeSuperseded: false,
    ...options,
  });
function props(observations = [report(1)], changes = {}) {
  return {
    team: 4418,
    name: "Synthetic team",
    eventName: "Synthetic regional",
    observations,
    profiles,
    profile: profiles[0],
    manager: false,
    active: true,
    loaded: true,
    refreshing: false,
    online: true,
    error: "",
    updatedAt: Date.UTC(2026, 9, 1, 11),
    refresh() {},
    close() {},
    correct() {},
    ...changes,
  };
}
const render = (p) => renderToStaticMarkup(React.createElement(TeamReports, p));
const correctionCount = (p) =>
  (render(p).match(/Correct this report/g) || []).length;

test("scout attribution uses only safe authorized display names and preserves original vs submitting scout", () => {
  assert.equal(scoutName(id(1), profiles), "Alex Fixture");
  assert.equal(scoutName(id(2), profiles), "Morgan Fixture");
  for (const actor of [undefined, "missing", id(3), id(4), id(5), id(6)])
    assert.equal(scoutName(actor, profiles), "Unknown scout");
  const original = report(1);
  assert.equal(originalScout(original), id(1), "legacy records use creator");
  const correction = { ...report(2), scout_id: id(1), created_by: id(2) };
  assert.equal(originalScout(correction), id(1));
  assert.equal(scoutName(correction.created_by, profiles), "Morgan Fixture");
});

test("report titles show readable match labels without exposing an internal manual-match UUID", () => {
  assert.equal(reportTitle(report(1)), "Qualification 1");
  assert.equal(reportTitle(report(1, "pit")), "Pit interview");
  assert.equal(
    reportTitle(report(1, "match", { match_label: "" })),
    "Match report",
  );
});

test("full match fields preserve zero and unknown counts, contextual choices, ratings, and flags", () => {
  const fields = Object.fromEntries(
    reportFields(
      report(1, "match", {
        auto_fuel: 0,
        teleop_fuel: null,
        alliance: "blue",
        station: 3,
        start_position: "trench",
        auto_climb: "not_attempted",
        endgame: "failed",
        accuracy: "70to80",
        role: "feeding",
        traversal: "none",
        intake: "neither",
        driver: 1,
        defense: null,
        disabled: true,
        no_show: false,
      }),
    ),
  );
  assert.deepEqual(fields, {
    Alliance: "Blue",
    "Driver station": "3",
    "Start position": "Trench side",
    "AUTO fuel": "0",
    "TELEOP fuel": "Unknown / not recorded",
    "AUTO climb": "Did not attempt a climb",
    "Endgame climb": "Attempted, but failed",
    "Estimated accuracy": "70–80%",
    "Main role": "Feeding",
    "Field traversal": "None",
    "Fuel intake": "Neither",
    "Driver ability": "1 · Struggled with control",
    "Defense effectiveness": "Not rated",
    "Disabled / breakdown": "Flagged",
    "No-show": "Not flagged",
  });
  const unknown = Object.fromEntries(reportFields(report(2)));
  for (const name of [
    "AUTO fuel",
    "TELEOP fuel",
    "Driver station",
    "Alliance",
    "Start position",
    "AUTO climb",
    "Endgame climb",
    "Estimated accuracy",
    "Main role",
    "Field traversal",
    "Fuel intake",
  ])
    assert.equal(unknown[name], "Unknown / not recorded", name);
  assert.equal(unknown["Driver ability"], "Not rated");
  assert.equal(unknown["Defense effectiveness"], "Not rated");
});

test("full pit fields preserve zero capacity and every collected capability", () => {
  const fields = Object.fromEntries(
    reportFields(
      report(1, "pit", {
        drive: "swerve",
        intake: "both",
        capacity: 0,
        traversal: "bump",
        climb: "L3",
      }),
    ),
  );
  assert.deepEqual(fields, {
    Drivetrain: "Swerve",
    "Fuel intake": "Both",
    "Fuel capacity": "0",
    "Field traversal": "Bump",
    "Climb capability": "L3",
  });
  const unknown = Object.fromEntries(reportFields(report(2, "pit")));
  assert.ok(
    Object.values(unknown).every((value) => value === "Unknown / not recorded"),
  );
});

test("current filtering follows correction chains, sorts newest first, and leaves source observations unchanged", () => {
  const first = report(1),
    second = { ...report(2), supersedes_id: first.id },
    third = { ...report(3), supersedes_id: second.id },
    pit = report(4, "pit");
  const reports = [second, pit, first, third],
    before = structuredClone(reports);
  assert.deepEqual(
    filter(reports).map((r) => r.id),
    [pit.id, third.id],
  );
  assert.deepEqual(
    filter(reports, { includeSuperseded: true }).map((r) => r.id),
    [pit.id, third.id, second.id, first.id],
  );
  assert.deepEqual(
    filter(reports, { kind: "match" }).map((r) => r.id),
    [third.id],
  );
  assert.deepEqual(
    filter(reports, { kind: "pit", includeSuperseded: true }).map((r) => r.id),
    [pit.id],
  );
  assert.deepEqual(reports, before);
});

test("search combines readable label, submitter, original scout, notes, and type without indexing raw identities", () => {
  const first = report(1, "match", { notes: "Archived tally" });
  const correction = {
    ...report(2, "match", {
      match_label: "Qualification 17",
      notes: "Reviewed wheel count",
    }),
    scout_id: id(1),
    created_by: id(2),
    supersedes_id: first.id,
  };
  const pit = {
    ...report(3, "pit", {
      auto_notes: "Left-side autonomous route",
      notes: "Pit capability notes",
    }),
    created_by: id(5),
  };
  const reports = [first, correction, pit];
  for (const search of [
    "  QUALIFICATION 17  ",
    "morgan fixture",
    "alex fixture",
    "reviewed wheel",
  ])
    assert.deepEqual(
      filter(reports, { search }).map((r) => r.id),
      [correction.id],
    );
  for (const search of ["autonomous", "pit capability", "unknown scout"])
    assert.deepEqual(
      filter(reports, { search }).map((r) => r.id),
      [pit.id],
    );
  assert.deepEqual(filter(reports, { search: "archived" }), []);
  assert.deepEqual(
    filter(reports, { search: "archived", includeSuperseded: true }).map(
      (r) => r.id,
    ),
    [first.id],
  );
  assert.deepEqual(
    filter(reports, { search: "autonomous", kind: "match" }),
    [],
  );
  for (const search of [
    id(1),
    first.id,
    correction.match_key,
    "private@example.invalid",
  ])
    assert.deepEqual(filter(reports, { search }), [], search);
});

test("report rendering labels author and correction provenance, escapes notes, and omits raw IDs and hidden fields", () => {
  const original = report(1);
  const correction = {
    ...report(2, "match", {
      notes: '<script>alert("fixture")</script>\nSecond line',
      unexpected_private_field: "NEVER RENDER THIS FIELD",
    }),
    scout_id: id(1),
    created_by: id(2),
    supersedes_id: original.id,
  };
  const html = render(props([original, correction]));
  for (const text of [
    "Team 4418",
    "reports &amp; notes",
    "Submitted by Morgan Fixture",
    "Original scout:",
    "Alex Fixture",
    "Corrects",
    "Corrected",
    "View full observation",
    "scout-observation-fields",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(
    html.includes(`dateTime="${correction.created_at}"`) ||
      html.includes(`datetime="${correction.created_at}"`),
  );
  assert.ok(html.includes("&lt;script&gt;"));
  for (const text of [
    "<script>",
    "NEVER RENDER THIS FIELD",
    "schema_version",
    original.id,
    correction.id,
    id(1),
    id(2),
    correction.match_key,
  ])
    assert.ok(!html.includes(text), text);
});

test("correction controls preserve original-scout permissions and require current, active authorized scope", () => {
  const original = report(1);
  const ownCorrectedByOther = {
    ...report(2),
    created_by: id(2),
    scout_id: id(1),
    supersedes_id: original.id,
  };
  const otherCorrectedBySelf = {
    ...report(3),
    created_by: id(1),
    scout_id: id(2),
  };
  const observations = [original, ownCorrectedByOther, otherCorrectedBySelf];
  assert.equal(correctionCount(props(observations)), 1);
  assert.equal(correctionCount(props(observations, { manager: true })), 2);
  for (const role of ["readonly", "parent", "future-role"])
    assert.equal(
      correctionCount(
        props(observations, {
          profile: { ...profiles[0], role },
          manager: true,
        }),
      ),
      0,
    );
  assert.equal(
    correctionCount(props(observations, { active: false, manager: true })),
    0,
  );
  assert.equal(
    correctionCount(
      props(observations, {
        profile: { ...profiles[0], active: false },
        manager: true,
      }),
    ),
    0,
  );
});

test("loading, unavailable, empty, and last-loaded report states remain distinct", () => {
  const loading = render(
    props([], { loaded: false, refreshing: true, updatedAt: null }),
  );
  assert.match(loading, /Loading scouting reports/);
  assert.doesNotMatch(loading, /Not scouted yet/);
  const unavailable = render(
    props([], {
      loaded: false,
      error: "Synthetic first load failed",
      updatedAt: null,
    }),
  );
  assert.match(unavailable, /Scouting reports are unavailable/);
  assert.match(unavailable, /Synthetic first load failed/);
  assert.doesNotMatch(unavailable, /Not scouted yet/);
  const empty = render(props([]));
  assert.match(empty, /Not scouted yet/);
  const stale = render(
    props([report(1, "match", { notes: "Cached notes stay available" })], {
      online: false,
      error: "Synthetic refresh failed",
    }),
  );
  assert.match(stale, /Offline/);
  assert.match(stale, /may be outdated/);
  assert.match(stale, /Cached notes stay available/);
  assert.match(stale, /Synthetic refresh failed/);
});
