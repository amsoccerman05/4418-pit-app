import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const migration = (name) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );

test("driver station migration: additive targets, six event slots, trusted management and audit", async (t) => {
  // Synthetic auth/profile fixtures in a disposable database only. No network,
  // live credentials or production accounts are involved in this test suite.
  const db = new PGlite();
  const as = async (actor = 4) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor === "anon" ? "" : uid(actor),
    ]);
    await db.exec(`set role ${actor === "anon" ? "anon" : "authenticated"}`);
  };
  const owner = async (sql, params = []) => {
    await db.exec("reset role");
    return db.query(sql, params);
  };
  const manage = async (action, p, actor = 4) => {
    await as(actor);
    return (
      await db.query("select public.pit_scouting_manage($1,$2::jsonb) id", [
        action,
        JSON.stringify(p),
      ])
    ).rows[0].id;
  };
  const context = async (event, actor = 2) => {
    await as(actor);
    return (
      await db.query("select public.pit_scouting_context($1) value", [event])
    ).rows[0].value;
  };
  const pit = async (name, p) => {
    await as(1);
    return (
      await db.query(`select public.pit_${name}($1::jsonb) id`, [
        JSON.stringify(p),
      ])
    ).rows[0].id;
  };
  const station = (event, overrides = {}) => ({
    event_id: event,
    kind: "match",
    team_number: null,
    match_key: null,
    alliance: "red",
    station: 1,
    assignee_id: uid(2),
    notes: "Watch this station throughout the event",
    version: 0,
    ...overrides,
  });
  const legacy = (event, overrides = {}) => ({
    event_id: event,
    kind: "match",
    team_number: 4418,
    match_key: "qm17",
    assignee_id: uid(2),
    notes: "Original target",
    version: 0,
    ...overrides,
  });
  const pick = (event, overrides = {}) => ({
    event_id: event,
    team_number: 4418,
    rank: 1,
    status: "available",
    notes: "Existing picklist",
    version: 0,
    ...overrides,
  });
  const history = async () =>
    (
      await owner(
        "select * from pit_scouting_management_events order by created_at,id",
      )
    ).rows;
  let event, otherEvent, matchId, pitId, pickId;
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      alter default privileges in schema public grant all on tables to public,anon,authenticated;
      alter default privileges in schema public grant all on functions to anon,authenticated;
      create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
      create table public.areas(id uuid primary key,name text,active boolean);
      create table public.team_positions(key text primary key,category text,active boolean);
      create table public.team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
      create table public.inventory_sentinel(id integer primary key,name text);
      insert into inventory_sentinel values(1,'unchanged');
      insert into team_positions values('scouting_lead','Functional Leads',true),('captain','Program',true);
    `);
    for (const [n, role, active] of [
      [1, "mentor", true],
      [2, "student", true],
      [3, "student", true],
      [4, "lead", true],
      [5, "readonly", true],
      [6, "mentor", false],
      [7, "admin", true],
      [8, "student", true],
      [9, "lead", true],
      [10, "parent", true],
      [11, "guest", true],
    ])
      await db.query("insert into profiles values($1,$2,$3,$4)", [
        uid(n),
        `Scout ${n}`,
        role,
        active,
      ]);
    await db.query(
      "insert into team_member_positions values($1,'scouting_lead',null),($2,'captain',null)",
      [uid(4), uid(8)],
    );
    for (const name of [
      "202609090001_pit_operations.sql",
      "202610010001_competition_operations.sql",
      "20261009042627_manual_practice_matches.sql",
      "20261010013034_competition_scouting.sql",
    ])
      await db.exec(migration(name));
    event = await pit("save_event", {
      name: "Station event",
      start_date: "2026-10-10",
      end_date: "2026-10-12",
    });
    otherEvent = await pit("save_event", {
      name: "Second station event",
      start_date: "2026-10-13",
      end_date: "2026-10-15",
    });
    await pit("activate_event", { id: event });
    matchId = await manage("assignment", legacy(event));
    pitId = await manage(
      "assignment",
      legacy(event, { kind: "pit", match_key: null }),
    );
    pickId = await manage("picklist", pick(event));
    const beforeAssignments = (
      await owner("select * from pit_scouting_assignments order by id")
    ).rows;
    const beforeHistory = await history();
    const beforePicklist = (
      await owner("select * from pit_scouting_picklist order by id")
    ).rows;
    const beforeProfiles = (await owner("select * from profiles order by id"))
      .rows;
    const beforePublicFunctions = (
      await owner(
        "select oid,pg_get_functiondef(oid) body,proacl from pg_proc where pronamespace='public'::regnamespace order by oid",
      )
    ).rows;
    await db.exec(
      migration("20261010142916_scouting_driver_station_assignments.sql"),
    );

    await t.test(
      "upgrade preserves all existing assignments, audit JSON, picklist, profiles and public RPC definitions",
      async () => {
        const assignments = (
          await owner("select * from pit_scouting_assignments order by id")
        ).rows;
        assert.deepEqual(
          assignments.map(({ alliance, station, ...row }) => row),
          beforeAssignments,
        );
        for (const row of assignments)
          assert.deepEqual([row.alliance, row.station], [null, null]);
        assert.deepEqual(await history(), beforeHistory);
        assert.deepEqual(
          (await owner("select * from pit_scouting_picklist order by id")).rows,
          beforePicklist,
        );
        assert.deepEqual(
          (await owner("select * from profiles order by id")).rows,
          beforeProfiles,
        );
        assert.deepEqual(
          (
            await owner(
              "select oid,pg_get_functiondef(oid) body,proacl from pg_proc where pronamespace='public'::regnamespace order by oid",
            )
          ).rows,
          beforePublicFunctions,
        );
        assert.equal(
          (await owner("select name from inventory_sentinel")).rows[0].name,
          "unchanged",
        );
      },
    );

    await t.test(
      "six named station slots coexist with legacy targets; one scout may intentionally cover multiple slots",
      async () => {
        const ids = [];
        for (const alliance of ["red", "blue"])
          for (const number of [1, 2, 3])
            ids.push(
              await manage(
                "assignment",
                station(event, { alliance, station: number }),
              ),
            );
        assert.equal(new Set(ids).size, 6);
        const rows = (await context(event, 5)).assignments;
        assert.equal(rows.length, 8);
        assert.deepEqual(
          rows
            .filter((a) => a.station !== null)
            .map((a) => `${a.alliance} ${a.station}`),
          ["red 1", "red 2", "red 3", "blue 1", "blue 2", "blue 3"],
        );
        for (const row of rows.filter((a) => a.station !== null)) {
          assert.deepEqual(
            [
              row.kind,
              row.team_number,
              row.match_key,
              row.assignee_id,
              row.version,
              row.updated_by,
            ],
            ["match", null, null, uid(2), 1, uid(4)],
          );
          assert.ok(Date.parse(row.updated_at));
        }
        assert.deepEqual((await context(otherEvent)).assignments, []);
        assert.equal(
          (await context(event)).assignments.find((a) => a.id === matchId)
            .match_key,
          "qm17",
        );
        assert.equal(
          (await context(event)).assignments.find((a) => a.id === pitId).kind,
          "pit",
        );
      },
    );

    await t.test(
      "station saves detect stale writers and preserve one row; clear and reassign are audited",
      async () => {
        const original = (await context(event)).assignments.find(
          (a) => a.alliance === "red" && a.station === 1,
        );
        await assert.rejects(manage("assignment", station(event)), /changed/);
        await as(4);
        const saves = await Promise.allSettled(
          [3, 8].map((n) =>
            db.query(
              "select public.pit_scouting_manage('assignment',$1::jsonb) id",
              [
                JSON.stringify(
                  station(event, { version: 1, assignee_id: uid(n) }),
                ),
              ],
            ),
          ),
        );
        assert.equal(saves.filter((r) => r.status === "fulfilled").length, 1);
        assert.match(
          saves.find((r) => r.status === "rejected").reason.message,
          /changed/,
        );
        assert.equal(
          await manage(
            "assignment",
            station(event, { version: 2, assignee_id: null }),
            1,
          ),
          original.id,
        );
        const cleared = (await context(event)).assignments.find(
          (a) => a.id === original.id,
        );
        assert.equal(cleared.assignee_id, null);
        assert.equal(cleared.version, 3);
        const minimal = station(event, { version: 3, assignee_id: uid(3) });
        delete minimal.team_number;
        delete minimal.match_key;
        assert.equal(await manage("assignment", minimal, 8), original.id);
        const row = (await context(event)).assignments.find(
          (a) => a.id === original.id,
        );
        assert.equal(row.version, 4);
        assert.equal(row.assignee_id, uid(3));
        const audit = (await history()).filter(
          (h) => h.after_state.id === original.id,
        );
        assert.equal(audit.length, 4);
        assert.deepEqual(
          audit.map((h) => h.performed_by),
          [uid(4), uid(4), uid(1), uid(8)],
        );
        assert.deepEqual(
          audit.map((h) => h.after_state.version),
          [1, 2, 3, 4],
        );
        assert.equal(audit[0].before_state, null);
        assert.equal(audit[2].after_state.assignee_id, null);
        assert.equal(audit[3].before_state.assignee_id, null);
        assert.equal(audit[3].after_state.alliance, "red");
        assert.equal(audit[3].after_state.station, 1);
        assert.equal((await context(event)).assignments.length, 8);
      },
    );

    await t.test(
      "strict station, kind and target validation rejects nulls, strings, fractions and contradictory targets without history",
      async () => {
        const before = await history();
        const bad = [
          ...[0, 4, -1, 1.5, "1", null, undefined, {}, [], true].map(
            (station) => ({ station }),
          ),
          ...["green", "Red", "", null, undefined, 1, false, {}, []].map(
            (alliance) => ({ alliance }),
          ),
          ...["pit", "other", null, undefined, 1].map((kind) => ({ kind })),
          ...[4418, 0, "", "4418", {}, []].map((team_number) => ({
            team_number,
          })),
          ...["qm17", "", 17, {}, []].map((match_key) => ({ match_key })),
          ...[-1, 0.5, "1", null, undefined, 2147483647].map((version) => ({
            version,
          })),
          { alliance: null, station: null },
          { notes: null },
          { notes: "x".repeat(2001) },
          { updated_by: uid(7) },
          { updated_at: "2000-01-01" },
          { id: uid(400) },
        ];
        for (const overrides of bad)
          await assert.rejects(
            manage("assignment", station(event, { version: 1, ...overrides })),
            /Driver station|Team number|Scouting record changed|Scouting notes|Unsupported/,
          );
        for (const assignee_id of [uid(5), uid(6), uid(10), uid(11), uid(999)])
          await assert.rejects(
            manage(
              "assignment",
              station(event, { station: 2, version: 1, assignee_id }),
            ),
            /active scouting team/,
          );
        for (const value of [null, [], "bad", 1])
          await assert.rejects(manage("assignment", value), /object required/);
        await assert.rejects(
          manage("picklist", { ...pick(event), alliance: "red", station: 1 }),
          /Unsupported/,
        );
        assert.deepEqual(await history(), before);
        // JSON numbers with a decimal representation can still be whole.
        await as(4);
        await db.query(
          "select public.pit_scouting_manage('assignment',$1::jsonb)",
          [
            JSON.stringify(
              station(event, { alliance: "blue", station: 3, version: 1 }),
            ).replace('"station":3', '"station":3.0'),
          ],
        );
        assert.equal(
          (await context(event)).assignments.find(
            (a) => a.alliance === "blue" && a.station === 3,
          ).version,
          2,
        );
      },
    );

    await t.test(
      "table constraints reject malformed targets and duplicate stations independently of RPC checks",
      async () => {
        const insert = async (kind, team, key, alliance, number) =>
          owner(
            "insert into pit_scouting_assignments(event_id,kind,team_number,match_key,alliance,station,updated_by) values($1,$2,$3,$4,$5,$6,$7)",
            [event, kind, team, key, alliance, number, uid(1)],
          );
        for (const input of [
          ["match", null, null, null, null],
          ["match", null, null, "red", null],
          ["match", null, null, null, 1],
          ["match", null, null, "green", 1],
          ["match", null, null, "blue", 0],
          ["match", null, null, "blue", 4],
          ["pit", null, null, "red", 1],
          ["match", 123, null, "red", 1],
          ["match", null, "qm1", "red", 1],
          ["match", 123, null, null, null],
          ["pit", null, null, null, null],
          ["pit", 123, "qm1", null, null],
          ["pit", 0, null, null, null],
        ])
          await assert.rejects(insert(...input), /check constraint/);
        // A cleared slot is still one slot; NULL assignee does not allow a duplicate.
        await assert.rejects(
          insert("match", null, null, "red", 1),
          /unique constraint/,
        );
        await assert.rejects(
          insert("match", 4418, "qm17", null, null),
          /unique constraint/,
        );
        await assert.rejects(
          insert("pit", 4418, null, null, null),
          /unique constraint/,
        );
      },
    );

    await t.test(
      "legacy match and pit edits remain compatible and cannot overwrite station rows; picklist behavior is unchanged",
      async () => {
        assert.equal(
          await manage(
            "assignment",
            legacy(event, {
              version: 1,
              match_key: "QM0017",
              assignee_id: null,
              alliance: null,
              station: null,
            }),
          ),
          matchId,
        );
        assert.equal(
          await manage(
            "assignment",
            legacy(event, {
              kind: "pit",
              match_key: null,
              version: 1,
              assignee_id: uid(3),
            }),
          ),
          pitId,
        );
        const rows = (await context(event)).assignments;
        assert.equal(rows.find((a) => a.id === matchId).version, 2);
        assert.equal(rows.find((a) => a.id === pitId).version, 2);
        assert.equal(rows.filter((a) => a.station !== null).length, 6);
        for (const team_number of [null, 0, 100000, 4418.5, "4418"])
          await assert.rejects(
            manage("assignment", legacy(event, { team_number })),
            /Team number/,
          );
        assert.equal(
          await manage(
            "picklist",
            pick(event, { version: 1, rank: 2, status: "picked" }),
            7,
          ),
          pickId,
        );
        await manage("picklist", pick(event, { team_number: 254, rank: 2 }));
        assert.deepEqual(
          (await context(event)).picklist.map((p) => p.team_number),
          [254, 4418],
        );
      },
    );

    await t.test(
      "station management requires current trusted leadership and active assignees",
      async () => {
        const before = await history();
        for (const actor of [2, 3, 5, 6, 9, 10, 11, 999])
          await assert.rejects(
            manage("assignment", station(event, { version: 4 }), actor),
            /permissions|leadership/,
          );
        await assert.rejects(
          manage("assignment", station(event), "anon"),
          /permission denied/,
        );
        await owner(
          "update team_member_positions set revoked_at=clock_timestamp() where user_id=$1",
          [uid(4)],
        );
        assert.equal((await context(event, 4)).can_manage, false);
        await assert.rejects(
          manage("assignment", station(event, { version: 4 })),
          /leadership/,
        );
        await owner(
          "update team_member_positions set revoked_at=null where user_id=$1",
          [uid(4)],
        );
        await owner(
          "update team_positions set active=false where key='captain'",
        );
        await assert.rejects(
          manage("assignment", station(event, { version: 4 }), 8),
          /leadership/,
        );
        await owner("update profiles set active=false where id=$1", [uid(3)]);
        await assert.rejects(
          manage(
            "assignment",
            station(event, { version: 4, assignee_id: uid(3) }),
          ),
          /active scouting team/,
        );
        await owner("update profiles set active=true where id=$1", [uid(3)]);
        assert.deepEqual(await history(), before);
      },
    );

    await t.test(
      "RLS, read-only grants, public invoker wrappers and immutable audit survive the upgrade",
      async () => {
        for (const actor of [1, 2, 4, 5, 7, "anon"]) {
          await as(actor);
          for (const sql of [
            "insert into pit_scouting_assignments default values",
            "update pit_scouting_assignments set station=station",
            "delete from pit_scouting_assignments",
            "truncate pit_scouting_assignments",
            "update pit_scouting_management_events set after_state='{}'",
            "delete from pit_scouting_management_events",
          ])
            await assert.rejects(db.exec(sql), /permission denied/);
          if (actor === "anon")
            await assert.rejects(
              db.exec("select * from pit_scouting_assignments"),
              /permission denied/,
            );
          else
            assert.equal(
              (await db.query("select * from pit_scouting_assignments")).rows
                .length,
              8,
            );
        }
        for (const actor of [6, 10, 11, 999]) {
          await as(actor);
          assert.equal(
            (await db.query("select * from pit_scouting_assignments")).rows
              .length,
            0,
          );
        }
        await assert.rejects(
          owner("update pit_scouting_management_events set after_state='{}'"),
          /immutable/,
        );
        await assert.rejects(
          owner("delete from pit_scouting_management_events"),
          /immutable/,
        );
        const acl = (
          await owner(
            "select relrowsecurity,has_table_privilege('authenticated',oid,'SELECT') reads,has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE') writes,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_access from pg_class where oid='public.pit_scouting_assignments'::regclass",
          )
        ).rows[0];
        assert.deepEqual(acl, {
          relrowsecurity: true,
          reads: true,
          writes: false,
          anon_access: false,
        });
        const funcs = (
          await owner(
            "select n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon_access from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname like 'pit_scouting_%') or (n.nspname='pit_private' and p.proname in ('scouting_context','scouting_manage'))",
          )
        ).rows;
        assert.equal(funcs.length, 5);
        for (const f of funcs) {
          assert.equal(f.prosecdef, f.nspname === "pit_private");
          assert.equal(f.anon_access, false);
          assert.deepEqual(f.proconfig, ['search_path=""']);
        }
      },
    );

    await t.test(
      "station scope follows the active local event and participates in existing event-identity protection",
      async () => {
        await assert.rejects(
          manage("assignment", station(otherEvent)),
          /active Pit event/,
        );
        await assert.rejects(
          manage("assignment", station(uid(999))),
          /active Pit event/,
        );
        await pit("activate_event", { id: otherEvent });
        await assert.rejects(
          manage("assignment", station(event, { version: 4 })),
          /active Pit event/,
        );
        await as(1);
        const creates = await Promise.allSettled(
          [2, 3].map((n) =>
            db.query(
              "select public.pit_scouting_manage('assignment',$1::jsonb) id",
              [JSON.stringify(station(otherEvent, { assignee_id: uid(n) }))],
            ),
          ),
        );
        assert.equal(creates.filter((r) => r.status === "fulfilled").length, 1);
        assert.match(
          creates.find((r) => r.status === "rejected").reason.message,
          /changed/,
        );
        const otherId = creates.find((r) => r.status === "fulfilled").value
          .rows[0].id;
        assert.equal((await context(otherEvent)).assignments.length, 1);
        assert.equal((await context(otherEvent)).assignments[0].id, otherId);
        assert.equal((await context(event)).assignments.length, 8);
        assert.notEqual(
          otherId,
          (await context(event)).assignments.find(
            (a) => a.alliance === "red" && a.station === 1,
          ).id,
        );
        await as(1);
        await db.query(
          "select public.pit_competition_manage('config',$1::jsonb)",
          [
            JSON.stringify({
              event_id: otherEvent,
              version: 0,
              team_number: 4418,
              tba_event_key: "2026other",
            }),
          ],
        );
        await assert.rejects(
          db.query("select public.pit_competition_manage('config',$1::jsonb)", [
            JSON.stringify({
              event_id: otherEvent,
              version: 1,
              team_number: 4418,
              tba_event_key: "2026wrong",
            }),
          ]),
          /already has scouting data/,
        );
        assert.deepEqual((await context(otherEvent)).picklist, []);
        assert.deepEqual((await context(otherEvent)).observations, []);
      },
    );
  } finally {
    await db.close();
  }
});
