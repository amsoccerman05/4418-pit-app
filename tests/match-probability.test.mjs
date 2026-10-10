import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMatchPredictions,
  validProbability,
} from "../supabase/functions/competition-feed/statbotics.ts";
import {
  matchProbability,
  probabilityPercent,
} from "../src/competition/match-probability.ts";
import { mergeFeed } from "../src/competition/feed-state.ts";
const event = "2026test",
  now = 1800000000000;
const row = (probability = 0.7345) => ({
  event,
  key: `${event}_qm17`,
  alliances: {
    red: { team_keys: [4418, 1619, 1339] },
    blue: { team_keys: [2996, 3648, 4593] },
  },
  pred: { red_win_prob: probability },
});
const match = {
  key: `${event}_qm17`,
  red: ["4418", "1619", "1339"],
  blue: ["2996", "3648", "4593"],
  completed: false,
  actual: null,
  alliance: "red",
};
const feed = (probability = 0.7345) => ({
  eventKey: event,
  eventId: "event",
  team: 4418,
  configVersion: 1,
  matchPredictions: parseMatchPredictions([row(probability)], event),
  predictionsAt: now,
  predictionsError: null,
});
test("Statbotics probabilities use actual pred.red_win_prob units; zero and one are valid, null stays missing", () => {
  for (const p of [0, 0.5, 0.7345, 1]) {
    assert.equal(
      parseMatchPredictions([row(p)], event)[0].redWinProbability,
      p,
    );
    assert.deepEqual(matchProbability(feed(p), match, event, now), {
      red: p,
      blue: 1 - p,
    });
  }
  for (const p of [null, undefined]) {
    assert.equal(
      parseMatchPredictions([{ ...row(), pred: { red_win_prob: p } }], event)[0]
        .redWinProbability,
      null,
    );
  }
  const empty = row();
  delete empty.pred;
  assert.equal(
    parseMatchPredictions([empty], event)[0].redWinProbability,
    null,
  );
  assert.equal(matchProbability(feed(null), match, event, now), null);
  for (const p of [-0.001, 1.001, NaN, Infinity, "0.75", false, {}, []]) {
    assert.equal(validProbability(p), false);
    assert.throws(() => parseMatchPredictions([row(p)], event));
    assert.equal(
      matchProbability(
        {
          ...feed(),
          matchPredictions: [
            { ...feed().matchPredictions[0], redWinProbability: p },
          ],
        },
        match,
        event,
        now,
      ),
      null,
    );
  }
  assert.equal(probabilityPercent(0.7345), "73.5%");
  assert.equal(probabilityPercent(1 - 0.7345), "26.5%");
  assert.equal(probabilityPercent(0), "0%");
  assert.equal(probabilityPercent(1), "100%");
  assert.equal(probabilityPercent(0.00001), "<0.1%");
  assert.equal(probabilityPercent(0.99999), ">99.9%");
});
test("prediction identity rejects wrong event, invalid keys, duplicate matches, invalid or overlapping rosters and full pages", () => {
  for (const bad of [
    { ...row(), event: "2026other" },
    { ...row(), key: "2026other_qm17" },
    { ...row(), key: `${event}_manual:1` },
    {
      ...row(),
      alliances: { red: { team_keys: [4418] }, blue: { team_keys: [1, 2, 3] } },
    },
    {
      ...row(),
      alliances: {
        red: { team_keys: [4418, 4418, 1] },
        blue: { team_keys: [1, 2, 3] },
      },
    },
    {
      ...row(),
      alliances: {
        red: { team_keys: [4418, 1, 2] },
        blue: { team_keys: [1, 2, 3] },
      },
    },
  ])
    assert.throws(() => parseMatchPredictions([bad], event));
  assert.throws(() => parseMatchPredictions([row(), row()], event));
  assert.throws(() =>
    parseMatchPredictions(
      Array.from({ length: 1000 }, (_, i) => ({
        ...row(),
        key: `${event}_qm${i + 1}`,
      })),
      event,
    ),
  );
  assert.throws(() => parseMatchPredictions({ matches: [] }, event));
  for (const key of ["qm1", "ef1m1", "qf2m1", "sf12m1", "f1m3"])
    assert.equal(
      parseMatchPredictions([{ ...row(), key: `${event}_${key}` }], event)
        .length,
      1,
    );
});
test("only matching upcoming official match and alliance composition gets a probability", () => {
  assert.ok(
    matchProbability(
      feed(),
      { ...match, red: [...match.red].reverse() },
      event,
      now,
    ),
  );
  for (const bad of [
    { ...match, source: "manual" },
    { ...match, completed: true },
    { ...match, actual: now },
    { ...match, key: `${event}_qm18` },
    { ...match, red: match.blue, blue: match.red },
    { ...match, red: ["4418", "1619", "1"] },
  ])
    assert.equal(matchProbability(feed(), bad, event, now), null);
  assert.equal(matchProbability(feed(), match, "2026other", now), null);
  assert.equal(matchProbability(feed(), match, undefined, now), null);
  assert.equal(
    matchProbability({ ...feed(), eventKey: "2026other" }, match, event, now),
    null,
  );
  assert.equal(
    matchProbability(
      {
        ...feed(),
        matchPredictions: [
          ...feed().matchPredictions,
          ...feed().matchPredictions,
        ],
      },
      match,
      event,
      now,
    ),
    null,
  );
  assert.equal(
    matchProbability({ ...feed(), matchPredictions: [] }, match, event, now),
    null,
  );
});
test("missing, stale, future, offline and failed data never show a current prediction", () => {
  for (const at of [null, 0, now - 300001, now + 60001])
    assert.equal(
      matchProbability({ ...feed(), predictionsAt: at }, match, event, now),
      null,
    );
  assert.equal(
    matchProbability(
      { ...feed(), predictionsError: "down" },
      match,
      event,
      now,
    ),
    null,
  );
  assert.equal(matchProbability(feed(), match, event, now, true), null);
  assert.equal(matchProbability(null, match, event, now), null);
});
test("client fallback keeps original age only in the same event/team/config; success empty clears it", () => {
  const prior = feed(),
    failed = {
      ...prior,
      matchPredictions: [],
      predictionsAt: null,
      predictionsError: "unavailable",
    };
  const held = mergeFeed(prior, failed);
  assert.deepEqual(held.matchPredictions, prior.matchPredictions);
  assert.equal(held.predictionsAt, now);
  assert.equal(matchProbability(held, match, event, now), null);
  for (const change of [
    { eventKey: "2026other" },
    { eventId: "other" },
    { team: 1 },
    { configVersion: 2 },
  ])
    assert.deepEqual(
      mergeFeed(prior, { ...failed, ...change }).matchPredictions,
      [],
    );
  assert.deepEqual(
    mergeFeed(prior, {
      ...failed,
      predictionsError: null,
      predictionsAt: now + 1,
    }).matchPredictions,
    [],
  );
});
