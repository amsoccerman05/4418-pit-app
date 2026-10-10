import { test } from "node:test";
import assert from "node:assert/strict";
import {
  driverStations,
  driverStation,
  stationLabel,
  stationTeam,
  findStationMatch,
  isStationAssignment,
  validAssignment,
} from "../src/scouting/stations.ts";
const match = {
  key: "2026test_qm17",
  red: ["4418", "1619", "1339"],
  blue: ["2996", "3648", "4593"],
};
const station = {
  kind: "match",
  team_number: null,
  match_key: null,
  alliance: "red",
  station: 2,
  version: 1,
};
test("six ordered station labels resolve the selected match with no team guessing", () => {
  assert.deepEqual(driverStations.map(stationLabel), [
    "Red 1",
    "Red 2",
    "Red 3",
    "Blue 1",
    "Blue 2",
    "Blue 3",
  ]);
  assert.deepEqual(
    driverStations.map((s) => stationTeam(match, s)),
    [4418, 1619, 1339, 2996, 3648, 4593],
  );
  assert.equal(
    stationTeam({ ...match, red: ["1", "2", "3"] }, driverStation(station)),
    2,
  );
  assert.equal(findStationMatch([match], "qm17"), match);
  assert.equal(findStationMatch([match], "2026test_qm17"), match);
  assert.equal(findStationMatch([match], "2026other_qm17"), undefined);
  for (const invalid of [
    undefined,
    null,
    { ...match, red: [] },
    { ...match, red: ["1", "2"] },
    { ...match, red: ["1", "", "2"] },
    { ...match, red: ["1", "1", "2"] },
    { ...match, red: ["1", "2", "100000"] },
    { ...match, red: ["1", "2", 3] },
  ])
    assert.equal(stationTeam(invalid, driverStation(station)), null);
});
test("station context validation preserves legacy and pit shapes and rejects mixed identities", () => {
  assert.equal(isStationAssignment(station), true);
  assert.equal(validAssignment(station), true);
  assert.equal(
    validAssignment({
      kind: "match",
      team_number: 4418,
      match_key: "qm17",
      version: 1,
    }),
    true,
  );
  assert.equal(
    validAssignment({
      kind: "pit",
      team_number: 4418,
      match_key: null,
      alliance: null,
      station: null,
      version: 1,
    }),
    true,
  );
  for (const invalid of [
    { ...station, team_number: 4418 },
    { ...station, match_key: "qm17" },
    { ...station, station: "2" },
    { ...station, station: 1.5 },
    { ...station, alliance: "unknown" },
    { ...station, kind: "pit" },
    { ...station, version: 0 },
    { ...station, station: 0 },
  ])
    assert.equal(validAssignment(invalid), false);
});
