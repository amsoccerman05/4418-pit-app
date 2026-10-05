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
