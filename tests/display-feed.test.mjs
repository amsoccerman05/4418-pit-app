import { test } from "node:test";
import assert from "node:assert/strict";
import { createDisplayFeed } from "../supabase/functions/competition-feed/display-feed.ts";
const now = 1800000000000;
function fixture() {
  const state = {
    at: now,
    event: "2026test",
    error: null,
    webcasts: [{ type: "youtube", channel: "dQw4w9WgXcQ", status: "unknown" }],
    epas: [
      { event: "2026test", team: 4418, epa: { total_points: { mean: 41.8 } } },
    ],
    predictions: [],
    map: null,
    mapNotFound: true,
    pits: { 4418: "A1" },
    board: {
      eventKey: "test",
      dataAsOfTime: now,
      announcements: [],
      partsRequests: [
        {
          id: "request",
          parts: "M4 bolts",
          requestedByTeam: "4418",
          postedTime: now,
        },
      ],
    },
    requests: [],
  };
  const cached = async (url, header, key, ttl, options) => {
    state.requests.push({ url, header, key, ttl, options });
    const data = url.includes("/v3/matches?")
      ? state.predictions
      : url.includes("statbotics")
        ? state.epas
        : url.endsWith("/map")
          ? state.map
          : url.endsWith("/pits")
            ? state.pits
            : {
                key: state.event,
                name: "Fixture event",
                webcasts: state.webcasts,
              };
    return {
      data,
      at: state.at,
      error: state.error,
      notFound: url.endsWith("/map") && state.mapNotFound,
    };
  };
  const load = createDisplayFeed(cached);
  return {
    state,
    get: (event = "2026test", nexus = "test") =>
      load(
        event,
        nexus,
        "tba-secret",
        "nexus-secret",
        Promise.resolve({
          data: state.board,
          at: state.at,
          error: state.error,
        }),
      ),
  };
}
test("display feed uses only fixed public URLs, credentials stay at the correct hosts, and maps can be absent", async () => {
  const { state, get } = fixture(),
    feed = await get();
  assert.equal(feed.teamEPAs[0].total, 41.8);
  assert.equal(feed.nexusBoard.partsRequests[0].team, "4418");
  assert.equal(feed.pitMap, null);
  assert.equal(feed.pitMapAt, now);
  assert.equal(feed.pitMapError, null);
  assert.equal(feed.webcasts[0].channel, "dQw4w9WgXcQ");
  const publicRequest = state.requests.find((r) =>
    r.url.includes("statbotics"),
  );
  assert.equal(publicRequest.key, undefined);
  assert.equal(publicRequest.header, null);
  assert.equal(publicRequest.ttl, 300000);
  for (const r of state.requests) {
    assert.ok(!r.url.includes("secret"));
    assert.ok(!r.url.includes("member"));
    if (r.key === "nexus-secret")
      assert.ok(r.url.startsWith("https://frc.nexus/api/v1/event/test/"));
    if (r.key === "tba-secret")
      assert.equal(
        r.url,
        "https://www.thebluealliance.com/api/v3/event/2026test",
      );
  }
  assert.ok(!JSON.stringify(feed).includes("secret"));
});
test("malformed responses retain validated display snapshots and original timestamps; successful empty clears", async () => {
  const { state, get } = fixture(),
    first = await get();
  state.at += 300001;
  state.webcasts = { error: "bad" };
  state.epas = { error: "bad" };
  state.board = {};
  state.pits = [];
  state.map = {};
  const old = await get();
  assert.deepEqual(old.webcasts, first.webcasts);
  assert.equal(old.webcastsAt, now);
  assert.ok(old.webcastsError);
  assert.deepEqual(old.teamEPAs, first.teamEPAs);
  assert.equal(old.epaAt, now);
  assert.ok(old.epaError);
  assert.deepEqual(old.nexusBoard, first.nexusBoard);
  assert.equal(old.nexusBoardAt, now);
  assert.ok(old.pitMapError);
  assert.equal(old.pitMapAt, now);
  state.webcasts = [];
  state.epas = [];
  state.board = {
    eventKey: "test",
    dataAsOfTime: state.at,
    announcements: [],
    partsRequests: [],
  };
  state.pits = {};
  state.map = null;
  const empty = await get();
  assert.deepEqual(empty.webcasts, []);
  assert.deepEqual(empty.teamEPAs, []);
  assert.deepEqual(empty.nexusBoard.partsRequests, []);
  assert.equal(empty.epaAt, state.at);
  assert.equal(empty.epaError, null);
  state.error = "down";
  const down = await get();
  assert.deepEqual(down.teamEPAs, []);
  assert.equal(down.epaAt, empty.epaAt);
  assert.ok(down.epaError);
});
test("event changes and missing Nexus never carry another event data", async () => {
  const { state, get } = fixture();
  await get();
  state.error = "down";
  const changed = await get("2026other", "other");
  assert.deepEqual(changed.webcasts, []);
  assert.equal(changed.epaAt, null);
  assert.equal(changed.nexusBoard, null);
  assert.equal(changed.pitMapAt, null);
  state.requests = [];
  await get("2026other", null);
  assert.ok(state.requests.every((r) => !r.url.includes("frc.nexus")));
  await assert.rejects(() => get("../secret"));
});
test("an older Nexus board cannot replace newer announcements or gain a fresh timestamp", async () => {
  const { state, get } = fixture();
  const first = await get();
  state.at += 30000;
  state.board = {
    ...state.board,
    dataAsOfTime: now - 60000,
    partsRequests: [],
  };
  const older = await get();
  assert.deepEqual(older.nexusBoard, first.nexusBoard);
  assert.equal(older.nexusBoardAt, first.nexusBoardAt);
  assert.ok(older.nexusBoardError);
  state.board = { ...state.board, dataAsOfTime: now + 30000 };
  const current = await get();
  assert.equal(current.nexusBoard.partsRequests.length, 0);
  assert.equal(current.nexusBoardError, null);
  assert.equal(current.nexusBoardAt, state.at);
});
test("future Nexus source clocks cannot poison later valid snapshots", async () => {
  const { state, get } = fixture();
  state.board.dataAsOfTime = now + 60001;
  const invalid = await get();
  assert.equal(invalid.nexusBoard, null);
  assert.equal(invalid.nexusBoardAt, null);
  assert.ok(invalid.nexusBoardError);
  state.board.dataAsOfTime = now;
  const good = await get();
  assert.equal(good.nexusBoard.asOf, now);
  assert.equal(good.nexusBoardError, null);
});

test("only an actual map 404 clears a validated map, not a malformed HTTP 200 null", async () => {
  const { state, get } = fixture();
  state.map = {
    size: { x: 500, y: 500 },
    pits: {
      A1: { position: { x: 50, y: 50 }, size: { x: 20, y: 20 }, team: "4418" },
    },
  };
  state.mapNotFound = false;
  const first = await get();
  assert.ok(first.pitMap);
  state.at += 300001;
  state.map = null;
  const malformed = await get();
  assert.deepEqual(malformed.pitMap, first.pitMap);
  assert.equal(malformed.pitMapAt, first.pitMapAt);
  assert.ok(malformed.pitMapError);
  state.mapNotFound = true;
  const absent = await get();
  assert.equal(absent.pitMap, null);
  assert.equal(absent.pitMapAt, state.at);
  assert.equal(absent.pitMapError, null);
});

test("Statbotics predictions are independently validated and preserve age on failure, clear on success, and never cross events", async () => {
  const { state, get } = fixture();
  const prediction = {
    event: "2026test",
    key: "2026test_qm17",
    alliances: {
      red: { team_keys: [4418, 1, 2] },
      blue: { team_keys: [3, 4, 5] },
    },
    pred: { red_win_prob: 0.7345 },
  };
  state.predictions = [prediction];
  const good = await get();
  assert.equal(good.matchPredictions[0].redWinProbability, 0.7345);
  assert.equal(good.predictionsAt, now);
  assert.equal(good.predictionsError, null);
  const request = state.requests.find((r) => r.url.includes("/v3/matches?"));
  assert.deepEqual(request, {
    url: "https://api.statbotics.io/v3/matches?event=2026test&limit=1000",
    header: null,
    key: undefined,
    ttl: 60000,
    options: undefined,
  });
  state.at += 60001;
  state.predictions = [{ ...prediction, pred: { red_win_prob: 2 } }];
  const bad = await get();
  assert.deepEqual(bad.matchPredictions, good.matchPredictions);
  assert.equal(bad.predictionsAt, now);
  assert.ok(bad.predictionsError);
  assert.equal(bad.epaError, null);
  const changed = await get("2026other", "other");
  assert.deepEqual(changed.matchPredictions, []);
  assert.equal(changed.predictionsAt, null);
  assert.ok(changed.predictionsError);
  state.predictions = [{ ...prediction, pred: { red_win_prob: null } }];
  const unpublished = await get();
  assert.equal(unpublished.matchPredictions[0].redWinProbability, null);
  assert.equal(unpublished.predictionsAt, state.at);
  assert.equal(unpublished.predictionsError, null);
  state.predictions = [];
  const empty = await get();
  assert.deepEqual(empty.matchPredictions, []);
  assert.equal(empty.predictionsError, null);
  state.error = "down";
  const down = await get();
  assert.deepEqual(down.matchPredictions, []);
  assert.equal(down.predictionsAt, empty.predictionsAt);
  assert.ok(down.predictionsError);
});
