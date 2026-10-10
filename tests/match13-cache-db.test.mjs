import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  createMatch13Feed,
  createMatch13Store,
} from "../supabase/functions/competition-feed/match13-cache.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261010172105_match13_shared_prediction_cache.sql",
    import.meta.url,
  ),
  "utf8",
);
const event = "2026test";
const prediction = (overrides = {}) => ({
  event,
  key: `${event}_qm17`,
  teams: ["4418", "1619", "1339", "2996", "3648", "4593"],
  redWinProbability: 0.7345,
  ...overrides,
});

test("Match13 shared cache: service-only permissions, quota gate and validated public snapshots", async (t) => {
  // Disposable local PostgreSQL only. This suite uses no network, live project,
  // accounts or keys. PGlite queues parallel calls on its single connection;
  // row-level locking for separate Postgres connections is in the actual SQL.
  const db = new PGlite();
  const role = async (name) => {
    await db.exec("reset role");
    if (name) await db.exec(`set role ${name}`);
  };
  const owner = async (sql, params = []) => {
    await role();
    const result = await db.query(sql, params);
    await role("service_role");
    return result;
  };
  const reset = () => owner("delete from public.pit_match13_cache");
  const expire = () =>
    owner("update public.pit_match13_cache set next_refresh_at = 0");
  const claim = async (key = event) =>
    (await db.query("select public.pit_match13_claim($1) value", [key])).rows[0]
      .value;
  const finish = async (token, overrides = {}) => {
    const args = {
      event,
      data: [prediction()],
      etag: '"v1"',
      at: Date.now(),
      retryAt: Date.now(),
      error: null,
      ...overrides,
    };
    return (
      await db.query(
        "select public.pit_match13_finish($1,$2,$3::jsonb,$4,$5,$6,$7) value",
        [
          args.event,
          token,
          args.data === null ? null : JSON.stringify(args.data),
          args.etag,
          args.at,
          args.retryAt,
          args.error,
        ],
      )
    ).rows[0].value;
  };
  const row = async () =>
    (await db.query("select * from public.pit_match13_cache")).rows[0];

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role untrusted;
      create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, untrusted, service_role;
      alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated;
    `);
    await db.exec(migration);

    await t.test(
      "permissive inherited defaults are revoked; RLS and invoker search paths are locked",
      async () => {
        assert.equal(
          (
            await db.query(
              "select relrowsecurity from pg_class where oid='public.pit_match13_cache'::regclass",
            )
          ).rows[0].relrowsecurity,
          true,
        );
        const functions = (
          await db.query(
            "select proname, prosecdef, proconfig from pg_proc where proname in ('pit_match13_claim','pit_match13_finish')",
          )
        ).rows;
        assert.equal(functions.length, 2);
        for (const fn of functions) {
          assert.equal(fn.prosecdef, false);
          assert.deepEqual(fn.proconfig, ['search_path=""']);
        }
        for (const actor of ["anon", "authenticated", "untrusted"]) {
          await role(actor);
          for (const sql of [
            "select * from public.pit_match13_cache",
            "insert into public.pit_match13_cache(event_key) values('2026test')",
            "update public.pit_match13_cache set next_refresh_at=0",
            "delete from public.pit_match13_cache",
          ])
            await assert.rejects(db.query(sql), /permission denied/);
          await assert.rejects(claim(), /permission denied/);
          await assert.rejects(finish("not-a-token"), /permission denied/);
        }
        await role("service_role");
        assert.equal((await claim()).claimed, true);
        assert.equal((await row()).event_key, event);
        await assert.rejects(
          db.query("delete from public.pit_match13_cache"),
          /permission denied/,
        );
      },
    );

    await t.test(
      "one global singleton allows one refresh and hides lease tokens from followers",
      async () => {
        await reset();
        const before = Date.now();
        const responses = await Promise.all(
          Array.from({ length: 20 }, () => claim()),
        );
        const winners = responses.filter((r) => r.claimed);
        assert.equal(winners.length, 1);
        const winner = winners[0];
        assert.match(winner.token, /^[0-9a-f-]{36}$/);
        assert.ok(winner.until >= before + 60000);
        assert.ok(winner.until <= Date.now() + 60000);
        assert.deepEqual(Object.keys(winner).sort(), [
          "at",
          "claimed",
          "data",
          "error",
          "etag",
          "event",
          "token",
          "until",
        ]);
        assert.equal(winner.data, null);
        assert.equal(winner.at, null);
        for (const follower of responses.filter((r) => !r.claimed)) {
          assert.equal(follower.token, null);
          assert.equal(follower.until, winner.until);
        }
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from public.pit_match13_cache",
            )
          ).rows[0].n,
          1,
        );
        await assert.rejects(
          db.query(
            "insert into public.pit_match13_cache(singleton,event_key) values(false,'2026other')",
          ),
          /check constraint/,
        );
        const other = await claim("2026other");
        assert.equal(other.claimed, false);
        assert.equal(other.event, "2026other");
        assert.equal(other.until, winner.until);
        assert.equal((await row()).lease_token, winner.token);
      },
    );

    await t.test(
      "success caches normalized data and cannot shorten the minimum refresh interval",
      async () => {
        await reset();
        const first = await claim();
        const at = Date.now();
        assert.equal(await finish(first.token, { at, retryAt: 0 }), true);
        const cached = await claim();
        assert.deepEqual(cached, {
          claimed: false,
          token: null,
          event,
          data: [prediction()],
          etag: '"v1"',
          at,
          error: null,
          until: first.until,
        });
        assert.equal((await row()).lease_token, null);
        assert.equal(await finish(first.token, { data: [] }), false);
        assert.deepEqual((await claim()).data, [prediction()]);
      },
    );

    await t.test(
      "failure preserves stale payload, ETag and timestamp, sanitizes errors and honors long backoff",
      async () => {
        await reset();
        const first = await claim();
        const at = Date.now() - 360000;
        await finish(first.token, { at });
        await expire();
        const refresh = await claim();
        assert.equal(refresh.at, at);
        const retryAt = Date.now() + 172800000;
        assert.equal(
          await finish(refresh.token, {
            data: { raw: "must never persist" },
            etag: "private upstream header",
            at: null,
            retryAt,
            error: "raw token and HTTP error body",
          }),
          true,
        );
        const stale = await claim();
        assert.equal(stale.claimed, false);
        assert.deepEqual(stale.data, [prediction()]);
        assert.equal(stale.etag, '"v1"');
        assert.equal(stale.at, at);
        assert.equal(stale.error, "Match13 backup unavailable");
        assert.equal(stale.until, retryAt);
        assert.doesNotMatch(
          JSON.stringify(await row()),
          /private upstream|raw token|must never persist/,
        );
        const other = await claim("2026other");
        assert.deepEqual(other, {
          claimed: false,
          token: null,
          event: "2026other",
          data: null,
          etag: null,
          at: null,
          error: null,
          until: retryAt,
        });
      },
    );

    await t.test(
      "expired leases recover and event switches reject old or mismatched finish tokens",
      async () => {
        await reset();
        const abandoned = await claim();
        await expire();
        const replacement = await claim();
        assert.notEqual(replacement.token, abandoned.token);
        assert.equal(await finish(abandoned.token), false);
        assert.equal(await finish("invalid-token"), false);
        assert.equal(
          await finish(replacement.token, { event: "2026other" }),
          false,
        );
        assert.equal(await finish(replacement.token), true);
        await expire();
        const other = await claim("2026other");
        assert.equal(other.claimed, true);
        assert.equal(other.data, null);
        assert.equal(other.at, null);
        assert.equal(other.etag, null);
        assert.equal(await finish(replacement.token), false);
        assert.equal(await finish(other.token), false);
        assert.equal(
          await finish(other.token, {
            event: "2026other",
            data: [prediction({ event: "2026other", key: "2026other_qm1" })],
          }),
          true,
        );
        const old = await claim();
        assert.equal(old.data, null);
        assert.equal(old.etag, null);
        assert.equal(old.at, null);
        assert.equal(old.claimed, false);
        assert.equal((await row()).event_key, "2026other");
      },
    );

    await t.test(
      "validation rejects non-normalized or cross-event payloads without losing the valid snapshot",
      async () => {
        await reset();
        const first = await claim();
        await finish(first.token);
        await expire();
        const lease = await claim();
        const invalid = [
          null,
          {},
          "raw",
          [null],
          [3],
          [[]],
          [{}],
          [prediction({ event: "2026other" })],
          [prediction({ key: "2026other_qm1" })],
          [prediction({ key: `${event}_manual:1` })],
          [prediction({ key: `${event}_qm0` })],
          [prediction({ redWinProbability: "0.7" })],
          [prediction({ redWinProbability: -0.1 })],
          [prediction({ redWinProbability: 1.1 })],
          [prediction({ redWinProbability: false })],
          [prediction({ teams: {} })],
          [prediction({ teams: [4418, 1619, 1339, 2996, 3648, 4593] })],
          [prediction({ teams: ["4418"] })],
          [
            prediction({
              teams: ["4418", "4418", "1339", "2996", "3648", "4593"],
            }),
          ],
          [
            prediction({
              teams: ["4418", "01619", "1339", "2996", "3648", "4593"],
            }),
          ],
          [
            prediction({
              teams: ["4418", null, "1339", "2996", "3648", "4593"],
            }),
          ],
          [prediction({ rawResponse: "must not be cached" })],
          [prediction(), prediction()],
          Array.from({ length: 2001 }, (_, i) =>
            prediction({ key: `${event}_qm${i + 1}` }),
          ),
          [prediction({ key: `${event}_qm${"1".repeat(1048576)}` })],
        ];
        const missing = prediction();
        delete missing.redWinProbability;
        invalid.push([missing]);
        for (const data of invalid) {
          await assert.rejects(
            finish(lease.token, { data }),
            /Invalid Match13/,
          );
          assert.deepEqual((await row()).payload, [prediction()]);
          assert.equal((await row()).lease_token, lease.token);
        }
        for (const at of [null, 0, -1, Date.now() + 120000])
          await assert.rejects(
            finish(lease.token, { at }),
            /Invalid Match13 fetch time/,
          );
        for (const retryAt of [null, -1, "9007199254740992"])
          await assert.rejects(
            finish(lease.token, { retryAt }),
            /Invalid Match13 retry time/,
          );
        await assert.rejects(
          finish(lease.token, { etag: "x".repeat(513) }),
          /Invalid Match13 ETag/,
        );
        for (const badEvent of [
          null,
          "",
          "2026UPPER",
          "2026test/other",
          "2026test';drop",
        ])
          await assert.rejects(claim(badEvent), /Invalid Match13 event/);
        assert.equal(await finish(lease.token, { data: [] }), true);
        assert.deepEqual((await claim()).data, []);
      },
    );

    await t.test(
      "null, zero, one and playoff predictions survive refresh/304-style revalidation",
      async () => {
        await reset();
        const lease = await claim();
        const data = [
          prediction({ redWinProbability: null }),
          prediction({ key: `${event}_sf1m1`, redWinProbability: 0 }),
          prediction({ key: `${event}_f1m2`, redWinProbability: 1 }),
        ];
        const oldAt = Date.now() - 120000;
        await finish(lease.token, { data, at: oldAt });
        await expire();
        const refresh = await claim();
        assert.deepEqual(refresh.data, data);
        assert.equal(refresh.at, oldAt);
        const at = Date.now();
        assert.equal(
          await finish(refresh.token, {
            data: refresh.data,
            etag: refresh.etag,
            at,
          }),
          true,
        );
        assert.deepEqual((await claim()).data, data);
        assert.equal((await claim()).at, at);
      },
    );
    await t.test(
      "independent Edge adapters share the actual SQL lease and response contract",
      async () => {
        await reset();
        const store = createMatch13Store({
          async rpc(name, args) {
            try {
              const result =
                name === "pit_match13_claim"
                  ? await claim(args.event_key)
                  : await finish(args.lease_token, {
                      event: args.event_key,
                      data: args.payload,
                      etag: args.response_etag,
                      at: args.fetched_at,
                      retryAt: args.retry_at,
                      error: args.failure,
                    });
              return { data: result, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
        });
        let calls = 0;
        const fetcher = async () => {
          calls++;
          return new Response(
            JSON.stringify({
              eventKey: event,
              year: 2026,
              matches: [
                {
                  key: `${event}_qm17`,
                  teams: Object.fromEntries(
                    prediction().teams.map((team) => [team, {}]),
                  ),
                  pred: { winProb: 0.7345 },
                },
              ],
            }),
            { status: 200, headers: { ETag: '"v1"' } },
          );
        };
        const first = await createMatch13Feed(store, fetcher)(
          event,
          "synthetic-test-only",
        );
        const second = await createMatch13Feed(store, fetcher)(
          event,
          "synthetic-test-only",
        );
        assert.equal(calls, 1);
        assert.equal(first.error, null);
        assert.deepEqual(first, second);
        assert.equal(first.data[0].redWinProbability, 0.7345);
        const other = await createMatch13Feed(store, fetcher)(
          "2026other",
          "synthetic-test-only",
        );
        assert.equal(calls, 1);
        assert.deepEqual(other.data, []);
        assert.equal(other.at, null);
      },
    );
  } finally {
    await db.close();
  }
});
