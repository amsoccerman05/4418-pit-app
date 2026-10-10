import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMatch13,
  bindMatch13,
  validateMatch13Records,
  hasPrimaryPrediction,
} from "../supabase/functions/competition-feed/match13.ts";
import {
  createMatch13Feed,
  createMatch13Store,
  retryDelay,
} from "../supabase/functions/competition-feed/match13-cache.ts";
import { selectMatchProbability } from "../src/competition/match-probability.ts";
import { mergeFeed } from "../src/competition/feed-state.ts";
const event = "2026test",
  now = 1800000000000;
const match = {
  key: `${event}_qm17`,
  red: ["4418", "1619", "1339"],
  blue: ["2996", "3648", "4593"],
  completed: false,
  actual: null,
  alliance: "red",
};
const raw = (p = 0.72) => ({
  eventKey: event,
  year: 2026,
  matches: [
    {
      key: match.key,
      pred: { winProb: p },
      teams: Object.fromEntries(
        [...match.blue, ...match.red].map((t) => [t, {}]),
      ),
    },
  ],
});
const records = (p = 0.72) => parseMatch13(raw(p), event);
const backup = () => ({
  eventKey: event,
  eventId: "event",
  team: 4418,
  configVersion: 1,
  tbaAt: now,
  tbaError: null,
  matchPredictions: [],
  predictionsAt: now,
  predictionsError: "down",
  match13Predictions: bindMatch13(records(), [match], event),
  match13At: now,
  match13Error: null,
});
test("Match13 uses documented envelope, RED winProb, explicit six-team set, never dictionary order or rating", () => {
  for (const p of [0, 0.5, 0.72, 1, null, undefined]) {
    const payload = raw();
    payload.matches[0].pred.winProb = p;
    assert.equal(parseMatch13(payload, event)[0].redWinProbability, p ?? null);
  }
  const result = bindMatch13(records(), [match], event)[0];
  assert.deepEqual(result.red, match.red);
  assert.deepEqual(result.blue, match.blue);
  assert.equal(result.rosterVerification, "tba-six-team-set");
  for (const data of [
    { ...raw(), eventKey: "2026other" },
    { ...raw(), year: 2025 },
    { matches: [] },
    [],
    { ...raw(), matches: Array(2001).fill(raw().matches[0]) },
  ])
    assert.throws(() => parseMatch13(data, event));
  for (const p of [-1, 1.01, NaN, Infinity, "0.75", false, {}, []])
    assert.throws(() => records(p));
  for (const row of [
    { ...raw().matches[0], key: "2026other_qm17" },
    { ...raw().matches[0], key: `${event}_manual:1` },
    { ...raw().matches[0], teams: { 4418: {} } },
    { ...raw().matches[0], bye: "true" },
    { ...raw().matches[0], pred: 2 },
  ])
    assert.throws(() => parseMatch13({ ...raw(), matches: [row] }, event));
  assert.throws(() =>
    parseMatch13(
      { ...raw(), matches: [raw().matches[0], raw().matches[0]] },
      event,
    ),
  );
  assert.deepEqual(
    parseMatch13(
      { ...raw(), matches: [{ ...raw().matches[0], bye: true, teams: {} }] },
      event,
    ),
    [],
  );
  assert.deepEqual(parseMatch13({ ...raw(), matches: [] }, event), []);
  for (const changed of [
    { ...match, key: `event_qm17` },
    { ...match, red: ["4418", "1619", "1"] },
    { ...match, red: ["4418", "1619", "1339"], blue: ["4418", "3648", "4593"] },
    { ...match, actual: now },
    { ...match, completed: true },
    { ...match, red: ["4418", "1619"] },
  ])
    assert.deepEqual(bindMatch13(records(), [changed], event), []);
  assert.deepEqual(bindMatch13(records(), [match, match], event), []);
  assert.throws(() =>
    validateMatch13Records([{ ...records()[0], event: "2026other" }], event),
  );
  assert.throws(() =>
    validateMatch13Records([...records(), ...records()], event),
  );
});
test("frontend picks valid Statbotics first, falls back for failed/missing/stale primary, recovers without blending", () => {
  const feed = backup();
  const expected = {
    red: 0.72,
    blue: 1 - 0.72,
    provider: "Match13",
    fetchedAt: now,
  };
  assert.deepEqual(selectMatchProbability(feed, match, event, now), expected);
  feed.predictionsError = null;
  assert.deepEqual(selectMatchProbability(feed, match, event, now), expected);
  feed.matchPredictions = [
    {
      event,
      key: match.key,
      red: match.red,
      blue: match.blue,
      redWinProbability: 0.6,
    },
  ];
  assert.equal(hasPrimaryPrediction(feed.matchPredictions, match, event), true);
  assert.deepEqual(selectMatchProbability(feed, match, event, now), {
    red: 0.6,
    blue: 0.4,
    provider: "Statbotics",
    fetchedAt: now,
  });
  for (const p of [null, NaN, "0.6", -1, 2]) {
    feed.matchPredictions[0].redWinProbability = p;
    assert.deepEqual(selectMatchProbability(feed, match, event, now), expected);
  }
  feed.matchPredictions[0].redWinProbability = 0.6;
  feed.predictionsAt = now - 300001;
  assert.deepEqual(selectMatchProbability(feed, match, event, now), expected);
  feed.predictionsAt = now;
  feed.matchPredictions[0].red = ["4418", "1619", "1"];
  assert.deepEqual(selectMatchProbability(feed, match, event, now), expected);
});
test("fallback never bypasses missing/stale schedule, manual practice, exact roster, provider marker, or source freshness gates", () => {
  for (const changed of [
    { match13Error: "down" },
    { match13At: null },
    { match13At: now - 300001 },
    { match13At: now + 60001 },
    { tbaError: "down" },
    { tbaAt: null },
    { tbaAt: now - 300001 },
    { eventKey: "2026other" },
    { match13Predictions: [] },
    {
      match13Predictions: [
        ...backup().match13Predictions,
        ...backup().match13Predictions,
      ],
    },
    {
      match13Predictions: [
        { ...backup().match13Predictions[0], rosterVerification: undefined },
      ],
    },
  ])
    assert.equal(
      selectMatchProbability({ ...backup(), ...changed }, match, event, now),
      null,
    );
  for (const changed of [
    { source: "manual" },
    { completed: true },
    { actual: now },
    { key: `${event}_qm18` },
    { red: match.blue, blue: match.red },
    { red: ["4418", "1619", "1"] },
  ])
    assert.equal(
      selectMatchProbability(backup(), { ...match, ...changed }, event, now),
      null,
    );
  assert.equal(selectMatchProbability(backup(), match, event, now, true), null);
  const failed = {
    ...backup(),
    match13Predictions: [],
    match13At: null,
    match13Error: "down",
  };
  const held = mergeFeed(backup(), failed);
  assert.equal(held.match13At, now);
  assert.equal(selectMatchProbability(held, match, event, now), null);
  assert.deepEqual(
    mergeFeed(backup(), { ...failed, eventKey: "other" }).match13Predictions,
    [],
  );
  assert.deepEqual(
    mergeFeed(backup(), { ...failed, match13Error: null, match13At: now + 1 })
      .match13Predictions,
    [],
  );
});
function fixture() {
  let time = now,
    cache = { event, data: null, etag: null, at: null, error: null, until: 0 },
    requests = [],
    finishes = [],
    fetchImpl = async () =>
      new Response(JSON.stringify(raw()), {
        headers: { etag: "v1", "cache-control": "private,max-age=60" },
      });
  const store = {
    async claim(e) {
      if (cache.until > time)
        return {
          claimed: false,
          token: null,
          ...(cache.event === e
            ? cache
            : {
                event: e,
                data: null,
                etag: null,
                at: null,
                error: null,
                until: cache.until,
              }),
        };
      if (cache.event !== e)
        cache = {
          event: e,
          data: null,
          etag: null,
          at: null,
          error: null,
          until: 0,
        };
      cache.until = time + 60000;
      return { claimed: true, token: "lease", ...cache };
    },
    async finish(e, token, data, etag, at, until, error) {
      finishes.push({ e, token, data, etag, at, until, error });
      cache = {
        ...cache,
        ...(!error ? { data, etag, at } : {}),
        error,
        until: Math.max(cache.until, until),
      };
      return true;
    },
  };
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return fetchImpl(url, options);
  };
  return {
    store,
    requests,
    finishes,
    get: createMatch13Feed(store, fetcher, () => time),
    getSecond: () => createMatch13Feed(store, fetcher, () => time),
    advance: (ms) => (time += ms),
    setFetch: (f) => (fetchImpl = f),
    cache: () => cache,
  };
}
test("all clients/isolates share one event fetch per minute, ETag revalidates with 304 and server TTL is respected", async () => {
  const f = fixture();
  const first = await f.get(event, "test-only-key");
  assert.equal(first.error, null);
  assert.equal(first.at, now);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(
    request.url,
    "https://actions.match13.com/v1/events/2026test/matches?scope=all",
  );
  assert.deepEqual(request.options.headers, {
    Authorization: "Bearer test-only-key",
  });
  assert.equal(request.options.redirect, "error");
  assert.ok(request.options.signal instanceof AbortSignal);
  await Promise.all(
    Array.from({ length: 20 }, () => f.getSecond()(event, "test-only-key")),
  );
  assert.equal(f.requests.length, 1);
  f.advance(60000);
  f.setFetch(
    async () =>
      new Response(null, {
        status: 304,
        headers: { etag: "v1", "cache-control": "private,max-age=60" },
      }),
  );
  const second = await f.getSecond()(event, "test-only-key");
  assert.deepEqual(second.data, first.data);
  assert.equal(second.at, now + 60000);
  assert.equal(f.requests[1].options.headers["If-None-Match"], "v1");
  f.advance(60000);
  f.setFetch(
    async () =>
      new Response(JSON.stringify(raw()), {
        headers: { "cache-control": "private,max-age=86400" },
      }),
  );
  await f.get(event, "test-only-key");
  f.advance(300001);
  const stale = await f.get(event, "test-only-key");
  assert.ok(stale.error);
  assert.equal(f.requests.length, 3);
  assert.ok(!JSON.stringify(f.cache()).includes("test-only-key"));
});
test("missing keys/database failures never make an unshared request; blank initial 304 is unavailable", async () => {
  const f = fixture();
  assert.ok((await f.get(event, undefined)).error);
  assert.equal(f.requests.length, 0);
  const get = createMatch13Feed(
    {
      claim: async () => {
        throw new Error("db unavailable");
      },
      finish: async () => true,
    },
    () => {
      throw new Error("must not fetch");
    },
    () => now,
  );
  assert.ok((await get(event, "key")).error);
  f.setFetch(async () => new Response(null, { status: 304 }));
  assert.ok((await f.get(event, "key")).error);
  assert.equal(f.cache().at, null);
});
test("429 Retry-After and failures preserve original timestamp, back off globally, sanitize errors, then recover", async () => {
  const f = fixture();
  const good = await f.get(event, "test-only-key");
  f.advance(60000);
  f.setFetch(
    async () =>
      new Response("test-only-key internal detail", {
        status: 429,
        headers: { "retry-after": "3600" },
      }),
  );
  const down = await f.get(event, "test-only-key");
  assert.deepEqual(down.data, good.data);
  assert.equal(down.at, now);
  assert.equal(down.error, "Match13 backup unavailable");
  f.advance(3599999);
  await f.getSecond()(event, "test-only-key");
  assert.equal(f.requests.length, 2);
  f.advance(1);
  f.setFetch(async () => new Response(JSON.stringify(raw(0.9))));
  const recovered = await f.get(event, "test-only-key");
  assert.equal(recovered.error, null);
  assert.equal(recovered.data[0].redWinProbability, 0.9);
  assert.ok(!JSON.stringify(f.finishes).includes("test-only-key"));
  assert.ok(!JSON.stringify(f.finishes).includes("internal detail"));
  assert.equal(retryDelay("120", now), 120000);
  assert.equal(retryDelay(new Date(now + 180000).toUTCString(), now), 180000);
  assert.equal(retryDelay("invalid", now), 60000);
  for (const bad of [
    async () => {
      throw new DOMException("timeout secret", "TimeoutError");
    },
    async () => new Response("{}"),
    async () => new Response(JSON.stringify(raw(2))),
    async () => new Response("down", { status: 500 }),
  ]) {
    f.advance(60000);
    f.setFetch(bad);
    const value = await f.get(event, "key");
    assert.ok(value.error);
    assert.equal(value.at, recovered.at);
  }
});
test("cache misses never cross event identities and conditional writes must succeed", async () => {
  const f = fixture();
  await f.get(event, "key");
  const changed = await f.get("2026other", "key");
  assert.deepEqual(changed.data, []);
  assert.equal(changed.at, null);
  assert.equal(f.requests.length, 1);
  let finishes = 0;
  const get = createMatch13Feed(
    {
      claim: async () => ({
        claimed: true,
        token: "lease",
        event,
        data: null,
        etag: null,
        at: null,
        error: null,
        until: now + 60000,
      }),
      finish: async () => {
        finishes++;
        return false;
      },
    },
    async () => new Response(JSON.stringify(raw())),
    () => now,
  );
  assert.ok((await get(event, "key")).error);
  assert.equal(finishes, 1);
});
test("Supabase store contract uses no credentials and throws sanitized errors", async () => {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: name.endsWith("claim")
          ? {
              claimed: false,
              event,
              data: null,
              etag: null,
              at: null,
              error: null,
              until: now,
            }
          : true,
        error: null,
      };
    },
  };
  const store = createMatch13Store(db);
  await store.claim(event);
  await store.finish(event, "lease", records(), "etag", now, now + 60000, null);
  assert.deepEqual(
    calls.map((c) => c.name),
    ["pit_match13_claim", "pit_match13_finish"],
  );
  assert.deepEqual(calls[0].args, { event_key: event });
  assert.equal(calls[1].args.fetched_at, now);
  assert.equal(calls[1].args.payload[0].event, event);
});
