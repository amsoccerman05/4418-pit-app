import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, path) =>
  module._compile(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    path,
  );
const {
  initialData,
  validateReport,
  currentReports,
  summarize,
  reportsCsv,
  csvCell,
  normalizeMatchKey,
} = require("../src/scouting/model.ts");
const report = (id, match = "qm1", data = {}) => ({
  id,
  event_id: "event",
  kind: "match",
  team_number: 4418,
  match_key: match,
  data: { ...initialData("match"), match_label: match, ...data },
  created_by: "synthetic-scout",
  created_at: "2026-10-10T10:00:00Z",
});
test("scouting defaults remain unobserved, not fake counts or ratings", () => {
  const r = report("one");
  validateReport(r);
  assert.equal(r.data.auto_fuel, null);
  assert.equal(r.data.driver, null);
  assert.equal(r.data.endgame, "unknown");
  assert.equal(initialData("pit").capacity, null);
  const s = summarize([r])[0];
  assert.equal(s.auto, null);
  assert.equal(s.teleop, null);
  assert.equal(s.fuel, null);
  assert.equal(s.climbRate, null);
  assert.equal(s.fuelMatches, 0);
});
test("observed zero is data and missing is excluded per metric", () => {
  const s = summarize([
    report("one", "qm1", { auto_fuel: 0, teleop_fuel: 0 }),
    report("two", "qm2", { auto_fuel: 20, teleop_fuel: null }),
  ])[0];
  assert.equal(s.auto, 10);
  assert.equal(s.teleop, 0);
  assert.equal(s.fuel, 0);
  assert.equal(s.autoMatches, 2);
  assert.equal(s.teleopMatches, 1);
  assert.equal(s.fuelMatches, 1);
});
test("averages weight each match equally despite multiple scouts", () => {
  const s = summarize([
    report("one", "qm1", { auto_fuel: 10, teleop_fuel: 20 }),
    report("two", "qm1", { auto_fuel: 30, teleop_fuel: 40 }),
    report("three", "qm2", { auto_fuel: 40, teleop_fuel: 60 }),
  ])[0];
  assert.equal(s.matches, 2);
  assert.equal(s.reports, 3);
  assert.equal(s.auto, 30);
  assert.equal(s.teleop, 45);
  assert.equal(s.fuel, 75);
});
test("corrections exclude superseded reports without deleting history", () => {
  const root = report("one", "qm1", { auto_fuel: 99, teleop_fuel: 99 }),
    correction = {
      ...report("two", "qm1", { auto_fuel: 1, teleop_fuel: 2 }),
      supersedes_id: "one",
    };
  assert.equal(currentReports([root, correction]).length, 1);
  assert.equal(summarize([root, correction])[0].fuel, 3);
  assert.equal(root.data.auto_fuel, 99);
});
test("pit reports stay separate from observed match metrics", () => {
  const p = {
    ...report("pit"),
    kind: "pit",
    match_key: null,
    data: { ...initialData("pit"), drive: "swerve", capacity: 60 },
  };
  validateReport(p);
  const s = summarize([p])[0];
  assert.equal(s.matches, 0);
  assert.equal(s.fuel, null);
  assert.equal(s.pit.id, "pit");
});
test("validation rejects invalid identities, fractions, bounds and malformed data", () => {
  for (const mutate of [
    (r) => (r.team_number = 0),
    (r) => (r.team_number = 1.5),
    (r) => (r.match_key = "bad arbitrary"),
    (r) => (r.data.auto_fuel = -1),
    (r) => (r.data.teleop_fuel = 1000),
    (r) => (r.data.driver = 0),
    (r) => (r.data.station = 4),
    (r) => (r.data.endgame = "park"),
    (r) => (r.data.notes = "x".repeat(2001)),
    (r) => (r.data.schema_version = 2),
  ]) {
    const r = report("one");
    mutate(r);
    assert.throws(() => validateReport(r));
  }
  for (const key of [
    "qm17",
    "p2",
    "sf1m2",
    "f1m1",
    "practice:warmup",
    "2026test_qm17",
    "manual:00000000-0000-4000-8000-000000000001",
  ])
    validateReport(report("one", key));
  assert.equal(normalizeMatchKey(" QM 17 "), "qm17");
});
test("CSV quotes commas/newlines and neutralizes spreadsheet formulas without identities", () => {
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  const csv = reportsCsv([report("one", "qm1", { notes: '\n=bad, "quote"' })]);
  assert.ok(csv.includes('"\'\n=bad, ""quote"""'));
  assert.ok(!csv.includes("synthetic-scout"));
  assert.ok(!csv.includes("undefined"));
  assert.ok(csv.startsWith('"report_id","event_id"'));
});

test("zero match and playoff set numbers are rejected before immutable queueing", () => {
  for (const key of ["qm0", "p0", "sf0m1", "f1m0", "2026test_qm000"])
    assert.throws(() => validateReport(report("one", key)), /positive/);
});
