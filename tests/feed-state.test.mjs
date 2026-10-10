import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeFeed,
  isStale,
  feedMatchesConfig,
} from "../src/competition/feed-state.ts";
const old = {
  eventId: "event",
  eventKey: "2026event",
  team: 4418,
  configVersion: 1,
  matches: [{ key: "one" }],
  tbaAt: 1000,
  standings: { rank: 2 },
  standingsAt: 1000,
};
test("independent feed outages retain only same-event standings and schedule", () => {
  const failed = {
    ...old,
    matches: [],
    tbaAt: null,
    tbaError: "offline",
    standings: null,
    standingsAt: null,
    standingsError: "offline",
  };
  const retained = mergeFeed(old, failed);
  assert.equal(retained.standings.rank, 2);
  assert.equal(retained.standingsAt, 1000);
  assert.equal(retained.standingsStale, true);
  assert.equal(retained.matches.length, 1);
  for (const changed of [
    { eventId: "new" },
    { eventKey: "2026new" },
    { team: 9999 },
    { configVersion: 2 },
  ])
    assert.equal(mergeFeed(old, { ...failed, ...changed }).standings, null);
  assert.equal(
    mergeFeed(old, { ...failed, standingsError: null }).standings,
    null,
  );
  assert.equal(mergeFeed(old, { ...failed, tbaError: null }).matches.length, 0);
});
test("freshness rejects missing, old and implausibly future timestamps", () => {
  assert.equal(isStale(null, 1000000), true);
  assert.equal(isStale(999000, 1000000), false);
  assert.equal(isStale(1, 1000000), true);
  assert.equal(isStale(1100000, 1000000), true);
});

test("visible feed must match the current config even before the next provider response", () => {
  const config = {
    event_id: "event",
    tba_event_key: "2026event",
    team_number: 4418,
    version: 1,
  };
  assert.equal(feedMatchesConfig(old, config), true);
  for (const changed of [
    { event_id: "new" },
    { tba_event_key: "2026new" },
    { team_number: 9999 },
    { version: 2 },
  ])
    assert.equal(feedMatchesConfig(old, { ...config, ...changed }), false);
  assert.equal(feedMatchesConfig(old, null), false);
});

test("all-event and pit views keep a coherent same-config snapshot through outages", () => {
  const prior = {
    ...old,
    scoutingMatches: [{ key: "one" }, { key: "other-team" }],
  };
  const failed = {
    ...prior,
    matches: [],
    scoutingMatches: [],
    tbaAt: null,
    tbaError: "TBA unavailable",
  };
  const held = mergeFeed(prior, failed);
  assert.deepEqual(held.matches, prior.matches);
  assert.deepEqual(held.scoutingMatches, prior.scoutingMatches);
  assert.equal(held.tbaAt, prior.tbaAt);
  assert.deepEqual(
    mergeFeed(prior, { ...failed, tbaError: null, tbaAt: 2000 })
      .scoutingMatches,
    [],
  );
  for (const changed of [
    { eventId: "new" },
    { eventKey: "2026new" },
    { team: 1234 },
    { configVersion: 2 },
  ])
    assert.deepEqual(
      mergeFeed(prior, { ...failed, ...changed }).scoutingMatches,
      [],
    );
  const allOnly = {
    ...failed,
    scoutingMatches: [{ key: "other-team" }],
    tbaAt: 2000,
  };
  const coherent = mergeFeed(prior, allOnly);
  assert.deepEqual(coherent.matches, []);
  assert.deepEqual(coherent.scoutingMatches, allOnly.scoutingMatches);
  assert.equal(coherent.tbaAt, 2000);
});

test("older feed deployments do not masquerade as the entire event schedule", () => {
  const prior = {
    ...old,
    scoutingMatches: [{ key: "one" }, { key: "other-team" }],
  };
  const legacy = { ...old, tbaAt: 2000 };
  assert.equal(mergeFeed(prior, legacy).scoutingMatches, undefined);
  const failed = { ...old, matches: [], tbaAt: null, tbaError: "unavailable" };
  assert.deepEqual(
    mergeFeed(prior, failed).scoutingMatches,
    prior.scoutingMatches,
  );
});

test("event roster retains only same-event failed snapshots and clears successful empty or legacy responses", () => {
  const previous = {
    ...old,
    eventTeams: [{ number: 4418, name: "IMPULSE", key: "frc4418" }],
    teamsAt: 1000,
  };
  const failed = {
    ...old,
    eventTeams: [],
    teamsAt: null,
    teamsError: "unavailable",
  };
  const retained = mergeFeed(previous, failed);
  assert.deepEqual(retained.eventTeams, previous.eventTeams);
  assert.equal(retained.teamsAt, 1000);
  assert.equal(retained.teamsError, "unavailable");
  for (const change of [
    { eventId: "new" },
    { eventKey: "2026new" },
    { team: 9999 },
    { configVersion: 2 },
  ])
    assert.deepEqual(
      mergeFeed(previous, { ...failed, ...change }).eventTeams,
      [],
    );
  assert.deepEqual(
    mergeFeed(previous, { ...failed, teamsError: null }).eventTeams,
    [],
  );
  assert.equal(mergeFeed(previous, old).eventTeams, undefined);
});

test('cross-instance older Nexus snapshots preserve current scope clocks and warn without masking event changes',()=>{
 const before={...old,nexus:{asOf:1800000060000,matches:[]},nexusAt:1800000065000,nexusBoard:{asOf:1800000060000,announcements:[{text:'new'}]},nexusBoardAt:1800000065000};
 const incoming={...before,nexus:{asOf:1800000000000,matches:[]},nexusAt:1800000070000,nexusBoard:{asOf:1800000000000,announcements:[]},nexusBoardAt:1800000070000};
 const result=mergeFeed(before,incoming);assert.deepEqual(result.nexus,before.nexus);assert.equal(result.nexusAt,before.nexusAt);assert.ok(result.nexusError);assert.deepEqual(result.nexusBoard,before.nexusBoard);assert.ok(result.nexusBoardError);
 assert.deepEqual(mergeFeed(before,{...incoming,eventId:'different'}).nexusBoard,incoming.nexusBoard);
 const future=mergeFeed(before,{...incoming,nexusBoard:{asOf:1800000070000+60001,announcements:[]}});assert.deepEqual(future.nexusBoard,before.nexusBoard);assert.ok(future.nexusBoardError);
});
