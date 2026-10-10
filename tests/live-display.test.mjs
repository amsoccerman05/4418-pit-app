import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTeamEPAs } from "../supabase/functions/competition-feed/statbotics.ts";
import {
  queueTiming,
  measuredEventDelay,
} from "../src/competition/live-display.ts";
import { createCache } from "../supabase/functions/competition-feed/cache.ts";
const now = 1800000000000;
test("EPA parser preserves source numbers, unknown values and public event identity", () => {
  const raw = [
    {
      team: 4418,
      event: "2026test",
      epa: {
        total_points: { mean: 0, sd: 10 },
        breakdown: {
          auto_points: 0,
          teleop_points: 12.4,
          endgame_points: null,
        },
      },
    },
    { team: 123, event: "2026test", epa: { total_points: 25, breakdown: {} } },
  ];
  assert.deepEqual(parseTeamEPAs(raw, "2026test"), [
    { team: 123, total: 25, auto: null, teleop: null, endgame: null },
    { team: 4418, total: 0, auto: 0, teleop: 12.4, endgame: null },
  ]);
  assert.deepEqual(parseTeamEPAs([], "2026test"), []);
  assert.equal(
    parseTeamEPAs(
      [{ team: 4418, event: "2026test", epa: { total_points: "24" } }],
      "2026test",
    )[0].total,
    null,
  );
  for (const bad of [
    null,
    {},
    [{}],
    [{ ...raw[0], event: "2026other" }],
    [raw[0], raw[0]],
    [{ ...raw[0], team: 0 }],
  ])
    assert.throws(() => parseTeamEPAs(bad, "2026test"));
  assert.ok(
    !JSON.stringify(
      parseTeamEPAs(
        [{ ...raw[0], notes: "PRIVATE", token: "SECRET" }],
        "2026test",
      ),
    ).includes("PRIVATE"),
  );
});
test("queue state prefers actual status, and never claims an expired estimate is live", () => {
  const m = { status: "Queuing soon", queue: now + 65000, actualQueue: null };
  assert.equal(queueTiming(m, now).headline, "1:05 to queue");
  assert.equal(
    queueTiming({ ...m, queue: now - 1000 }, now).headline,
    "Queue estimate passed",
  );
  assert.equal(
    queueTiming({ ...m, status: "Now queuing" }, now).headline,
    "NOW QUEUING",
  );
  assert.equal(
    queueTiming({ ...m, status: "On field", actualQueue: now - 1000 }, now)
      .detail,
    "Actually queued",
  );
  assert.equal(
    queueTiming({ ...m, queue: null }, now).headline,
    "Queue time unavailable",
  );
  assert.equal(queueTiming(null, now).headline, "Live queue unavailable");
});
test("delay is derived from the latest actual match, never future estimates", () => {
  assert.equal(
    measuredEventDelay([
      { label: "Q4", actual: null, scheduled: now, predicted: now + 600000 },
    ]),
    null,
  );
  assert.deepEqual(
    measuredEventDelay([
      { label: "Q1", actual: now, scheduled: now - 120000 },
      { label: "Q2", actual: now + 60000, scheduled: now + 120000 },
    ]),
    { match: "Q2", at: now + 60000, minutes: -1 },
  );
});
test("public cache sends no credentials; only explicit map 404 counts as an empty success", async () => {
  let requests = 0;
  const cache = createCache(
    async (url, options) => {
      requests++;
      assert.deepEqual(options.headers, {});
      return new Response(null, { status: 404 });
    },
    () => now,
  );
  const absent = await cache(
    "https://example.test/map",
    null,
    undefined,
    300000,
    { notFoundIsEmpty: true },
  );
  assert.equal(absent.data, null);
  assert.equal(absent.error, null);
  assert.equal(absent.at, now);
  const failed = await cache(
    "https://example.test/events",
    null,
    undefined,
    300000,
  );
  assert.ok(failed.error);
  assert.equal(failed.at, 0);
  assert.equal(requests, 2);
  const auth = await cache(
    "https://example.test/private",
    "Nexus-Api-Key",
    undefined,
    300000,
  );
  assert.ok(auth.error);
  assert.equal(requests, 2);
});
