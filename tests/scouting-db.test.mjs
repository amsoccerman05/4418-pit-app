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
const matchData = () => ({
  schema_version: 1,
  match_label: "Qualification 17",
  alliance: "red",
  station: 1,
  start_position: "trench",
  auto_fuel: 12,
  teleop_fuel: 35,
  auto_climb: "succeeded",
  endgame: "L2",
  accuracy: "70to80",
  role: "cycling",
  traversal: "both",
  intake: "ground",
  driver: 4,
  defense: null,
  disabled: false,
  no_show: false,
  notes: "Strong cycles; scout estimate, not official scoring",
});
const pitData = () => ({
  schema_version: 1,
  drive: "swerve",
  intake: "both",
  capacity: 30,
  traversal: "trench",
  climb: "L2",
  auto_notes: "Two paths",
  notes: "",
});

test("scouting migration: immutable evidence, duplicate-safe sync, event isolation and trusted role boundary", async (t) => {
  const db = new PGlite();
  const as = async (actor = 2) => {
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
  const submit = async (p, actor = 2) => {
    await as(actor);
    return (
      await db.query("select public.pit_scouting_submit($1::jsonb) id", [
        JSON.stringify(p),
      ])
    ).rows[0].id;
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
  const observe = (n, event, overrides = {}) => ({
    id: uid(n),
    event_id: event,
    kind: "match",
    team_number: 4418,
    match_key: "qm17",
    data: matchData(),
    ...overrides,
  });
  const assign = (event, overrides = {}) => ({
    event_id: event,
    kind: "match",
    team_number: 4418,
    match_key: "qm17",
    assignee_id: uid(2),
    notes: "North stands",
    version: 0,
    ...overrides,
  });
  const pick = (event, overrides = {}) => ({
    event_id: event,
    team_number: 4418,
    rank: 1,
    status: "available",
    notes: "Reliable auto",
    version: 0,
    ...overrides,
  });
  const count = async (table) =>
    +(await owner(`select count(*) n from ${table}`)).rows[0].n;
  let event, otherEvent, report, assignmentId, pickId;
  try {
    await db.exec(`
   create role anon; create role authenticated; create schema auth;
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to authenticated;
   -- Exercise hosted-project defaults, not a deceptively permission-free fixture.
   alter default privileges in schema public grant all on tables to public,anon,authenticated;
   alter default privileges in schema public grant all on functions to anon,authenticated;
   create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
   create table public.areas(id uuid primary key,name text,active boolean);
   create table public.team_positions(key text primary key,category text,active boolean);
   create table public.team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
   create table public.inventory_sentinel(id integer primary key,name text);
   insert into public.inventory_sentinel values(1,'unchanged');
   insert into public.team_positions values('scouting_lead','Functional Leads',true),('captain','Program',true);
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
    ]) {
      await db.query("insert into profiles values($1,$2,$3,$4)", [
        uid(n),
        `Test ${n}`,
        role,
        active,
      ]);
    }
    await db.query(
      "insert into team_member_positions values($1,'scouting_lead',null),($2,'captain',null)",
      [uid(4), uid(8)],
    );
    for (const file of [
      "202609090001_pit_operations.sql",
      "202610010001_competition_operations.sql",
      "20261009042627_manual_practice_matches.sql",
    ])
      await db.exec(migration(file));
    event = await pit("save_event", {
      name: "Scouting event",
      start_date: "2026-10-10",
      end_date: "2026-10-12",
    });
    otherEvent = await pit("save_event", {
      name: "Other event",
      start_date: "2026-10-13",
      end_date: "2026-10-15",
    });
    await pit("activate_event", { id: event });
    await as(1);
    await db.query("select public.pit_competition_manage('config',$1::jsonb)", [
      JSON.stringify({
        event_id: event,
        version: 0,
        team_number: 4418,
        tba_event_key: "2026test",
      }),
    ]);
    const originalFunctions = (
      await owner(
        "select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace order by proname",
      )
    ).rows;
    const originalProfiles = (await owner("select * from profiles order by id"))
      .rows;
    await db.exec(migration("20261010013034_competition_scouting.sql"));

    await t.test(
      "additive upgrade preserves Inventory, profiles and all existing public API definitions",
      async () => {
        assert.equal(
          (await owner("select name from inventory_sentinel")).rows[0].name,
          "unchanged",
        );
        assert.deepEqual(
          (await owner("select * from profiles order by id")).rows,
          originalProfiles,
        );
        assert.deepEqual(
          (
            await owner(
              "select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace and proname not like 'pit_scouting_%' order by proname",
            )
          ).rows,
          originalFunctions,
        );
        assert.deepEqual(await context(null), {
          can_scout: true,
          can_manage: false,
          observations: [],
          assignments: [],
          picklist: [],
        });
        assert.equal((await context(event, 5)).can_scout, false);
        assert.equal((await context(event, 4)).can_manage, true);
        assert.equal((await context(event, 8)).can_manage, true);
        assert.equal((await context(event, 9)).can_manage, false);
      },
    );

    await t.test(
      "observations normalize identity, stamp actor and retain exact request receipts",
      async () => {
        report = observe(100, event, { match_key: "  2026test_QM0017  " });
        assert.equal(await submit(report), uid(100));
        const row = (await context(event)).observations[0];
        assert.equal(row.match_key, "qm17");
        assert.equal(row.created_by, uid(2));
        assert.equal(row.scout_id, uid(2));
        assert.equal(row.supersedes_id, null);
        assert.deepEqual(row.data, report.data);
        assert.ok(Date.parse(row.created_at));
        assert.equal(await submit(report), uid(100));
        assert.equal(await count("pit_scouting_observations"), 1);
        assert.equal(await count("pit_private.scouting_receipts"), 1);
        for (const bad of [
          { ...report, data: { ...report.data, teleop_fuel: 36 } },
          { ...report, event_id: otherEvent },
          { ...report, match_key: "qm17" },
          { ...report, created_by: uid(7) },
        ])
          await assert.rejects(submit(bad), /Request ID already used/);
        await assert.rejects(submit(report, 3), /Request ID already used/);
        await assert.rejects(
          submit({ ...report, id: uid(101), match_key: "QM17" }),
          /already submitted/,
        );
        await assert.rejects(
          submit(observe(101, event, { created_by: uid(7) })),
          /Unsupported/,
        );
        await assert.rejects(
          submit(observe(101, event, { created_at: "2000-01-01" })),
          /Unsupported/,
        );
        await assert.rejects(
          submit(observe(101, event, { scout_id: uid(7) })),
          /Unsupported/,
        );
        // Independent scout evidence is legitimate, not a retry or overwrite.
        assert.equal(await submit(observe(102, event), 3), uid(102));
      },
    );

    await t.test(
      "scouting prevents rebinding event identity without rewriting existing configuration APIs",
      async () => {
        await as(1);
        const configure = (p) =>
          db.query("select public.pit_competition_manage('config',$1::jsonb)", [
            JSON.stringify(p),
          ]);
        await assert.rejects(
          configure({
            event_id: event,
            version: 1,
            team_number: 4418,
            tba_event_key: "2026different",
          }),
          /already has scouting data/,
        );
        await configure({
          event_id: event,
          version: 1,
          team_number: 4418,
          tba_event_key: "2026test",
          nexus_event_key: "different-feed",
        });
        const config = (
          await db.query("select * from pit_event_config where event_id=$1", [
            event,
          ])
        ).rows[0];
        assert.equal(config.tba_event_key, "2026test");
        assert.equal(config.nexus_event_key, "different-feed");
        assert.equal(config.version, 2);
      },
    );

    await t.test(
      "match/pit identities, event prefixes, manual match ownership and unknown values",
      async () => {
        const unknown = {
          ...matchData(),
          auto_fuel: null,
          teleop_fuel: null,
          auto_climb: "unknown",
          endgame: "unknown",
          role: "unknown",
          station: null,
          driver: null,
          defense: null,
        };
        assert.equal(
          await submit(
            observe(110, event, { match_key: "p001", data: unknown }),
          ),
          uid(110),
        );
        assert.equal(
          (await context(event)).observations.find((o) => o.id === uid(110))
            .match_key,
          "p1",
        );
        assert.equal(
          await submit(observe(111, event, { match_key: "qf02m03" })),
          uid(111),
        );
        assert.equal(
          (await context(event)).observations.find((o) => o.id === uid(111))
            .match_key,
          "qf2m3",
        );
        assert.equal(
          await submit(
            observe(112, event, { match_key: "practice:afternoon-1" }),
          ),
          uid(112),
        );
        assert.equal(
          await submit(
            observe(113, event, {
              kind: "pit",
              match_key: null,
              data: { ...pitData(), capacity: null },
            }),
          ),
          uid(113),
        );
        await assert.rejects(
          submit(
            observe(114, event, {
              kind: "pit",
              match_key: "qm17",
              data: pitData(),
            }),
          ),
          /cannot have a match/,
        );
        for (const match_key of [
          null,
          "",
          "QM0",
          "qm-1",
          "not a match",
          "2026wrong_qm17",
          `manual:${uid(199)}`,
        ])
          await assert.rejects(
            submit(observe(114, event, { match_key })),
            /match|Match/,
          );
        await as(1);
        const manualId = (
          await db.query(
            "select public.pit_competition_manage('manual_match',$1::jsonb) id",
            [
              JSON.stringify({
                id: uid(199),
                event_id: event,
                manual_label: "Scouting practice",
              }),
            ],
          )
        ).rows[0].id;
        assert.equal(
          await submit(
            observe(114, event, { match_key: `manual:${manualId}` }),
          ),
          uid(114),
        );
        await assert.rejects(
          submit(observe(115, otherEvent, { match_key: `manual:${manualId}` })),
          /active Pit event/,
        );
        await assert.rejects(
          submit(observe(115, uid(999))),
          /active Pit event/,
        );
      },
    );

    await t.test(
      "schema/range/type validation rejects corrupt counts, enums, booleans and incomplete data",
      async () => {
        const badData = [
          { schema_version: 2 },
          { extra: "arbitrary" },
          { auto_fuel: -1 },
          { auto_fuel: 1000 },
          { auto_fuel: 1.5 },
          { auto_fuel: "1" },
          { teleop_fuel: {} },
          { alliance: null },
          { alliance: "green" },
          { station: 0 },
          { station: 4 },
          { station: "1" },
          { driver: 0 },
          { driver: 6 },
          { defense: 1.2 },
          { auto_climb: "L1" },
          { endgame: "complete" },
          { accuracy: "95%" },
          { role: "anything" },
          { traversal: "over" },
          { intake: "human" },
          { disabled: "false" },
          { no_show: 0 },
          { notes: "x".repeat(2001) },
          { notes: null },
          { match_label: " " },
          { match_label: "x".repeat(101) },
        ];
        for (const key of [
          "alliance",
          "start_position",
          "auto_climb",
          "endgame",
          "accuracy",
          "role",
          "traversal",
          "intake",
        ]) {
          for (const value of [null, undefined, 1, false, {}])
            badData.push({ [key]: value });
        }
        for (const data of badData)
          await assert.rejects(
            submit(
              observe(120, event, {
                match_key: "qm120",
                data: { ...matchData(), ...data },
              }),
            ),
            /Scouting|scouting|Invalid|Match label/,
          );
        for (const data of [
          null,
          [],
          {},
          Object.fromEntries(
            Object.entries(matchData()).filter(([k]) => k !== "driver"),
          ),
        ])
          await assert.rejects(
            submit(observe(120, event, { match_key: "qm120", data })),
            /Scouting/,
          );
        for (const data of [
          { capacity: -1 },
          { intake: null },
          { traversal: null },
          { climb: null },
          { capacity: 201 },
          { capacity: 1.5 },
          { capacity: "30" },
          { drive: null },
          { drive: "flying" },
          { climb: "L4" },
          { auto_notes: "x".repeat(2001) },
        ])
          await assert.rejects(
            submit(
              observe(120, event, {
                kind: "pit",
                team_number: 120,
                match_key: null,
                data: { ...pitData(), ...data },
              }),
            ),
            /Scouting|scouting|Invalid/,
          );
        for (const team_number of [0, 100000, 1.1, "4418", null])
          await assert.rejects(
            submit(observe(120, event, { team_number })),
            /Team number/,
          );
        await assert.rejects(
          submit(observe(120, event, { kind: "other" })),
          /match key|kind/,
        );
        await assert.rejects(
          submit(observe(120, event, { kind: null })),
          /match key|kind/,
        );
        await assert.rejects(
          submit({ ...observe(120, event), id: null }),
          /request ID/,
        );
        await assert.rejects(submit(null), /request ID/);
        assert.equal(
          await submit(
            observe(120, event, {
              match_key: "qm120",
              data: {
                ...matchData(),
                auto_fuel: 0,
                teleop_fuel: 999,
                driver: 1,
                defense: 5,
              },
            }),
          ),
          uid(120),
        );
      },
    );

    await t.test(
      "corrections are append-only, owner/leader checked and preserve original scout ownership",
      async () => {
        const correction = observe(130, event, {
          supersedes_id: uid(100),
          data: { ...matchData(), teleop_fuel: 40 },
        });
        await assert.rejects(submit(correction, 3), /original scout or active/);
        await assert.rejects(
          submit({ ...correction, team_number: 254 }),
          /same event, team and match/,
        );
        await assert.rejects(
          submit({ ...correction, match_key: "qm18" }),
          /same event, team and match/,
        );
        await assert.rejects(
          submit({ ...correction, supersedes_id: uid(999) }),
          /not found/,
        );
        assert.equal(await submit(correction), uid(130));
        assert.equal(await submit(correction), uid(130));
        await assert.rejects(
          submit({ ...correction, id: uid(131) }),
          /already corrected/,
        );
        assert.equal(
          await submit(
            { ...correction, id: uid(131), supersedes_id: uid(130) },
            4,
          ),
          uid(131),
        );
        const rows = (await context(event)).observations;
        assert.equal(rows.find((o) => o.id === uid(100)).data.teleop_fuel, 35);
        assert.equal(rows.find((o) => o.id === uid(130)).data.teleop_fuel, 40);
        assert.equal(rows.find((o) => o.id === uid(131)).created_by, uid(4));
        assert.equal(rows.find((o) => o.id === uid(131)).scout_id, uid(2));
        // The initial scout can correct even after a leadership correction.
        assert.equal(
          await submit({
            ...correction,
            id: uid(132),
            supersedes_id: uid(131),
          }),
          uid(132),
        );
        await assert.rejects(
          owner(
            "update pit_scouting_observations set team_number=254 where id=$1",
            [uid(100)],
          ),
          /immutable/,
        );
        await assert.rejects(
          owner("delete from pit_scouting_observations where id=$1", [
            uid(100),
          ]),
          /immutable/,
        );
        await assert.rejects(
          owner(
            "update pit_private.scouting_receipts set request_payload='{}' where id=$1",
            [uid(100)],
          ),
          /immutable/,
        );
      },
    );

    await t.test(
      "duplicate requests and competing corrections have a single winner",
      async () => {
        await as(2);
        // Queue SQL directly so actor state cannot race in the test harness.
        const p = observe(140, event, { match_key: "qm140" });
        const execute = (payload) =>
          db.query("select public.pit_scouting_submit($1::jsonb) id", [
            JSON.stringify(payload),
          ]);
        const retry = await Promise.all([execute(p), execute(p)]);
        assert.deepEqual(
          retry.map((r) => r.rows[0].id),
          [uid(140), uid(140)],
        );
        const conflict = await Promise.allSettled([
          execute({ ...p, id: uid(141), supersedes_id: uid(140) }),
          execute({ ...p, id: uid(142), supersedes_id: uid(140) }),
        ]);
        assert.equal(
          conflict.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.match(
          conflict.find((r) => r.status === "rejected").reason.message,
          /already corrected/,
        );
        const duplicate = await Promise.allSettled([
          execute(observe(143, event, { match_key: "qm143" })),
          execute(observe(144, event, { match_key: "2026test_qm143" })),
        ]);
        assert.equal(
          duplicate.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.match(
          duplicate.find((r) => r.status === "rejected").reason.message,
          /already submitted/,
        );
      },
    );

    await t.test(
      "leadership assignment management is versioned, audited and validates active assignees",
      async () => {
        for (const actor of [2, 3, 5, 6, 9, 10, 11])
          await assert.rejects(
            manage("assignment", assign(event), actor),
            /permissions|leadership/,
          );
        assignmentId = await manage("assignment", assign(event));
        let row = (await context(event, 5)).assignments[0];
        assert.equal(row.id, assignmentId);
        assert.equal(row.updated_by, uid(4));
        assert.equal(row.version, 1);
        assert.equal(row.assignee_id, uid(2));
        await assert.rejects(manage("assignment", assign(event)), /changed/);
        for (const assignee_id of [uid(5), uid(6), uid(10), uid(11), uid(999)])
          await assert.rejects(
            manage("assignment", assign(event, { version: 1, assignee_id })),
            /active scouting team/,
          );
        await assert.rejects(
          manage(
            "assignment",
            assign(event, { version: 1, updated_by: uid(7) }),
          ),
          /Unsupported/,
        );
        assert.equal(
          await manage(
            "assignment",
            assign(event, {
              version: 1,
              match_key: "2026test_qm0017",
              assignee_id: uid(3),
            }),
            8,
          ),
          assignmentId,
        );
        row = (await context(event)).assignments[0];
        assert.equal(row.version, 2);
        assert.equal(row.updated_by, uid(8));
        assert.equal(row.assignee_id, uid(3));
        assert.equal(
          await manage(
            "assignment",
            assign(event, { version: 2, assignee_id: null }),
            1,
          ),
          assignmentId,
        );
        assert.equal((await context(event)).assignments[0].assignee_id, null);
        await assert.rejects(
          manage("assignment", assign(event, { version: 1 })),
          /changed/,
        );
        await assert.rejects(
          manage("assignment", assign(event, { team_number: 123, version: 1 })),
          /changed/,
        );
        await assert.rejects(
          manage("assignment", assign(otherEvent)),
          /active Pit event/,
        );
        const history = (
          await owner(
            "select * from pit_scouting_management_events where action='assignment' order by created_at",
          )
        ).rows;
        assert.deepEqual(
          history.map((h) => h.performed_by),
          [uid(4), uid(8), uid(1)],
        );
        assert.equal(history[0].before_state, null);
        assert.equal(history[1].before_state.version, 1);
        assert.equal(history[1].after_state.version, 2);
        await assert.rejects(
          owner("delete from pit_scouting_management_events"),
          /immutable/,
        );
      },
    );

    await t.test(
      "shared picklist needs current leadership and expected version; ties have deterministic order",
      async () => {
        await assert.rejects(manage("picklist", pick(event), 2), /leadership/);
        pickId = await manage("picklist", pick(event), 7);
        let row = (await context(event, 5)).picklist[0];
        assert.equal(row.updated_by, uid(7));
        assert.equal(row.version, 1);
        await assert.rejects(manage("picklist", pick(event)), /changed/);
        assert.equal(
          await manage(
            "picklist",
            pick(event, { version: 1, rank: 2, status: "picked" }),
          ),
          pickId,
        );
        await manage(
          "picklist",
          pick(event, { team_number: 254, rank: 2, status: "avoid" }),
        );
        assert.deepEqual(
          (await context(event)).picklist.map((p) => p.team_number),
          [254, 4418],
        );
        for (const rank of [0, 100000, -1, 1.5, "1", null])
          await assert.rejects(
            manage("picklist", pick(event, { version: 2, rank })),
            /rank/,
          );
        for (const status of ["", null, "deleted"])
          await assert.rejects(
            manage("picklist", pick(event, { version: 2, status })),
            /status/,
          );
        for (const version of [null, -1, 0.5, "2"])
          await assert.rejects(
            manage("picklist", pick(event, { version })),
            /changed/,
          );
        await assert.rejects(
          manage(
            "picklist",
            pick(event, { version: 2, notes: "x".repeat(2001) }),
          ),
          /notes/,
        );
        await assert.rejects(
          manage("picklist", pick(event, { version: 2, updated_by: uid(1) })),
          /Unsupported/,
        );
        await assert.rejects(manage("unknown", pick(event)), /Unknown/);
        await as(4);
        const sql = "select public.pit_scouting_manage('picklist',$1::jsonb)";
        const saves = await Promise.allSettled([
          db.query(sql, [JSON.stringify(pick(event, { version: 2, rank: 3 }))]),
          db.query(sql, [JSON.stringify(pick(event, { version: 2, rank: 4 }))]),
        ]);
        assert.equal(saves.filter((r) => r.status === "fulfilled").length, 1);
        assert.match(
          saves.find((r) => r.status === "rejected").reason.message,
          /changed/,
        );
      },
    );

    await t.test(
      "new tables close automatic grants; no direct writes, anonymous RPCs, private receipts or role spoofing",
      async () => {
        const tables = [
          "pit_scouting_observations",
          "pit_scouting_assignments",
          "pit_scouting_picklist",
          "pit_scouting_management_events",
        ];
        for (const actor of [1, 2, 4, 5, 7, "anon"]) {
          await as(actor);
          for (const table of tables) {
            for (const sql of [
              `insert into ${table} default values`,
              `update ${table} set event_id=event_id`,
              `delete from ${table}`,
              `truncate ${table}`,
            ])
              await assert.rejects(db.exec(sql), /permission denied/);
            if (actor === "anon")
              await assert.rejects(
                db.exec(`select * from ${table}`),
                /permission denied/,
              );
          }
          await assert.rejects(
            db.exec("select * from pit_private.scouting_receipts"),
            /permission denied/,
          );
        }
        for (const actor of [6, 10, 11, 999]) {
          await as(actor);
          for (const table of tables)
            assert.equal(
              (await db.query(`select * from ${table}`)).rows.length,
              0,
            );
          await assert.rejects(context(event, actor), /permissions/);
          await assert.rejects(
            submit(observe(150, event), actor),
            /permissions/,
          );
        }
        await assert.rejects(submit(observe(150, event), 5), /permissions/);
        await assert.rejects(
          submit(observe(150, event), "anon"),
          /permission denied/,
        );
        await assert.rejects(context(event, "anon"), /permission denied/);
        await assert.rejects(
          manage("picklist", pick(event), "anon"),
          /permission denied/,
        );
        await as(2);
        await db.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({
            sub: uid(2),
            user_metadata: { role: "admin" },
            app_metadata: { role: "admin" },
          }),
        ]);
        await assert.rejects(
          db.query("select public.pit_scouting_manage('picklist',$1::jsonb)", [
            JSON.stringify(pick(event, { version: 3 })),
          ]),
          /leadership/,
        );
        const acl = (
          await owner(
            "select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT') reads,has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') writes,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_access from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",
            [tables],
          )
        ).rows;
        assert.equal(acl.length, 4);
        for (const r of acl)
          assert.deepEqual(
            [r.relrowsecurity, r.reads, r.writes, r.anon_access],
            [true, true, false, false],
          );
        const funcs = (
          await owner(
            "select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon_access from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pit_scouting_%'",
          )
        ).rows;
        assert.equal(funcs.length, 3);
        for (const f of funcs) {
          assert.equal(f.prosecdef, false);
          assert.equal(f.anon_access, false);
          assert.deepEqual(f.proconfig, ['search_path=""']);
        }
      },
    );

    await t.test(
      "role/position revocation immediately removes management and account deactivation blocks retries",
      async () => {
        await owner(
          "update team_member_positions set revoked_at=clock_timestamp() where user_id=$1",
          [uid(4)],
        );
        assert.equal((await context(event, 4)).can_manage, false);
        await assert.rejects(
          manage("picklist", pick(event, { version: 3 })),
          /leadership/,
        );
        await assert.rejects(
          submit(observe(155, event, { supersedes_id: uid(132) }), 4),
          /original scout or active/,
        );
        await owner(
          "update team_positions set active=false where key='captain'",
        );
        assert.equal((await context(event, 8)).can_manage, false);
        await owner("update profiles set active=false where id=$1", [uid(2)]);
        await assert.rejects(submit(report), /permissions/);
        await assert.rejects(context(event), /permissions/);
        await owner("update profiles set active=true where id=$1", [uid(2)]);
      },
    );

    await t.test(
      "event switching isolates context; completed-event retry keeps original receipt while new writes stop",
      async () => {
        await pit("activate_event", { id: otherEvent });
        assert.equal(await submit(report), uid(100));
        await assert.rejects(submit(observe(160, event)), /active Pit event/);
        await assert.rejects(
          submit(observe(161, event, { supersedes_id: uid(132) })),
          /active Pit event/,
        );
        await assert.rejects(
          manage("picklist", pick(event, { version: 3 }), 1),
          /active Pit event/,
        );
        await assert.rejects(
          submit(observe(162, otherEvent, { match_key: `manual:${uid(199)}` })),
          /different event/,
        );
        await assert.rejects(
          submit(observe(162, otherEvent, { match_key: "2026test_qm17" })),
          /different or unconfigured event/,
        );
        assert.equal(await submit(observe(162, otherEvent)), uid(162));
        assert.equal((await context(otherEvent)).observations.length, 1);
        assert.equal((await context(otherEvent)).observations[0].id, uid(162));
        assert.deepEqual((await context(otherEvent)).picklist, []);
        assert.deepEqual((await context(otherEvent)).assignments, []);
        assert.ok((await context(event, 5)).observations.length > 1);
        await assert.rejects(
          submit(observe(163, otherEvent, { supersedes_id: uid(132) })),
          /same event, team and match/,
        );
        // Same team and match at another event is a distinct scouting identity.
        await manage("assignment", assign(otherEvent), 1);
        await manage("picklist", pick(otherEvent), 1);
        assert.equal((await context(otherEvent, 5)).picklist.length, 1);
        assert.equal((await context(otherEvent, 5)).assignments.length, 1);
      },
    );
  } finally {
    await db.close();
  }
});
