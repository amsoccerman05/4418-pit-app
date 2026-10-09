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

test("manual practice migration: production-style grants, lifecycle, snapshots and safe RPC boundary", async (t) => {
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
  const rpc = async (action, p, actor = 2) => {
    await as(actor);
    return (
      await db.query("select public.pit_competition_manage($1,$2::jsonb) id", [
        action,
        JSON.stringify(p),
      ])
    ).rows[0].id;
  };
  const pit = async (name, p) => {
    await as(1);
    return (
      await db.query(`select public.pit_${name}($1::jsonb) id`, [
        JSON.stringify(p),
      ])
    ).rows[0].id;
  };
  const context = async (event, actor = 2) => {
    await as(actor);
    return (
      await db.query("select public.pit_competition_context($1) value", [event])
    ).rows[0].value;
  };
  const match = async (id) => {
    await as();
    return (
      await db.query(
        "select to_jsonb(m) value from public.pit_match_ops m where id=$1",
        [id],
      )
    ).rows[0]?.value;
  };
  const audit = async (id) => {
    await as(5);
    return (
      await db.query(
        "select * from public.pit_manual_match_events where match_id=$1 order by created_at,id",
        [id],
      )
    ).rows;
  };
  const createEvent = async (name) =>
    pit("save_event", {
      name,
      start_date: "2026-10-01",
      end_date: "2026-10-03",
    });
  const template = (kind, name = kind) => ({
    name,
    kind,
    items: [
      {
        text: `${kind} safety check`,
        required: true,
        blocking: true,
        area_id: null,
      },
      {
        text: "Optional observation",
        required: false,
        blocking: false,
        area_id: null,
      },
    ],
  });
  let event, officialEvent, officialId, battery, pre, post, general;
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      -- Hosted projects can grant new public tables automatically. The new
      -- migration must revoke these grants, rather than relying on RLS alone.
      alter default privileges in schema public grant all on tables to anon,authenticated;
      create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
      create table public.areas(id uuid primary key,name text,active boolean);
      create table public.team_positions(key text primary key,category text,active boolean);
      create table public.team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
      create table public.inventory_sentinel(id integer primary key,name text);
      insert into public.inventory_sentinel values(1,'unchanged');
      insert into public.team_positions values('software_lead','Functional Leads',true),('captain','Program',true);
    `);
    for (const [n, role, active] of [
      [1, "mentor", true],
      [2, "student", true],
      [3, "student", true],
      [4, "lead", true],
      [5, "readonly", true],
      [6, "mentor", false],
      [7, "admin", true],
      [8, "lead", true],
    ]) {
      await db.query("insert into profiles values($1,$2,$3,$4)", [
        uid(n),
        `Test ${role}`,
        role,
        active,
      ]);
    }
    await db.query(
      "insert into team_member_positions values($1,'software_lead',null),($2,'captain',null)",
      [uid(2), uid(8)],
    );
    await db.exec(migration("202609090001_pit_operations.sql"));
    await db.exec(migration("202610010001_competition_operations.sql"));
    officialEvent = await createEvent("Official event before migration");
    await pit("activate_event", { id: officialEvent });
    battery = await pit("save_battery", { battery_number: "B01" });
    await rpc("config", {
      event_id: officialEvent,
      version: 0,
      team_number: 4418,
      tba_event_key: "2026test",
    });
    officialId = await rpc("match", {
      event_id: officialEvent,
      match_key: "2026test_qm17",
    });
    await rpc("match", {
      match_id: officialId,
      version: 1,
      battery_id: battery,
      note: "Original official preparation",
    });
    pre = await rpc("template", template("pre"));
    post = await rpc("template", template("post"));
    general = await rpc("template", template("general"));
    await rpc(
      "run",
      {
        id: uid(90),
        match_id: officialId,
        template_id: pre,
        template_version: 1,
      },
      3,
    );
    const previous = await context(officialEvent);
    const originalFunctions = (
      await owner(
        "select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace and proname in ('pit_report_issue','pit_update_issue','pit_transition_battery','pit_save_event','pit_activate_event','pit_save_battery') order by proname",
      )
    ).rows;
    await db.exec(migration("20261009042627_manual_practice_matches.sql"));

    await t.test(
      "upgrade preserves official data, existing APIs and snapshots",
      async () => {
        const next = await context(officialEvent);
        assert.equal(next.manual_matches_enabled, true);
        assert.deepEqual(next.config, previous.config);
        for (const key of ["templates", "runs", "items", "links", "areas"])
          assert.deepEqual(next[key], previous[key]);
        const upgraded = next.matches.find((m) => m.id === officialId);
        for (const [key, value] of Object.entries(previous.matches[0]))
          assert.deepEqual(upgraded[key], value);
        assert.equal(upgraded.source, "tba");
        for (const key of [
          "manual_label",
          "scheduled_at",
          "finished_at",
          "finished_by",
          "archived_at",
          "archived_by",
        ])
          assert.equal(upgraded[key], null);
        assert.deepEqual(
          (
            await owner(
              "select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace and proname in ('pit_report_issue','pit_update_issue','pit_transition_battery','pit_save_event','pit_activate_event','pit_save_battery') order by proname",
            )
          ).rows,
          originalFunctions,
        );
        assert.equal(
          (await owner("select name from inventory_sentinel")).rows[0].name,
          "unchanged",
        );
        await assert.rejects(
          rpc("config", {
            event_id: officialEvent,
            version: 1,
            team_number: 4418,
            tba_event_key: "2026other",
          }),
          /already has match/,
        );
        await assert.rejects(
          rpc("manual_match", {
            match_id: officialId,
            version: 2,
            manual_label: "Not manual",
          }),
          /manual practice/,
        );
        await assert.rejects(
          rpc("finish_manual_match", { match_id: officialId, version: 2 }),
          /manual practice/,
        );
        await assert.rejects(
          rpc("archive_manual_match", {
            match_id: officialId,
            version: 2,
            archived: true,
          }),
          /manual practice/,
        );
        assert.equal(
          await rpc("match", {
            event_id: officialEvent,
            match_key: "2026test_qm17",
          }),
          officialId,
        );
        await assert.rejects(
          rpc("match", {
            event_id: officialEvent,
            match_key: `manual:${uid(99)}`,
          }),
          /Match key/,
        );
      },
    );

    event = await createEvent(
      "Practice event without an external configuration",
    );
    await pit("activate_event", { id: event });

    await t.test(
      "manual create needs only active event and stable request ID; retries never overwrite",
      async () => {
        const payload = {
          id: uid(100),
          event_id: event,
          manual_label: "  Practice 1  ",
          scheduled_at: "2026-10-01T10:00:00-06:00",
          note: "Local test",
          source: "tba",
          updated_by: uid(7),
          finished_by: uid(7),
          finished_at: "2000-01-01T00:00:00Z",
        };
        const id = await rpc("manual_match", payload);
        assert.equal(id, uid(100));
        assert.equal((await context(event)).config, null);
        let row = await match(id);
        assert.equal(row.source, "manual");
        assert.equal(row.match_key, `manual:${id}`);
        assert.equal(row.manual_label, "Practice 1");
        assert.equal(
          Date.parse(row.scheduled_at),
          Date.parse(payload.scheduled_at),
        );
        assert.equal(row.updated_by, uid(2));
        assert.equal(row.finished_at, null);
        assert.equal(row.finished_by, null);
        assert.equal(row.version, 1);
        assert.equal(await rpc("manual_match", payload), id);
        assert.equal((await audit(id)).length, 1);
        await assert.rejects(
          rpc("manual_match", { ...payload, manual_label: "Different" }),
          /Request ID already used/,
        );
        await assert.rejects(
          rpc("manual_match", { ...payload, note: "Different" }),
          /Request ID already used/,
        );
        await assert.rejects(
          rpc("manual_match", { ...payload, scheduled_at: null }),
          /Request ID already used/,
        );
        await assert.rejects(
          rpc("manual_match", payload, 1),
          /Request ID already used/,
        );
        await assert.rejects(
          rpc("manual_match", { ...payload, id: officialId }),
          /Request ID already used/,
        );
        await rpc("match", {
          match_id: id,
          version: 1,
          battery_id: battery,
          note: "Updated after creation",
          source: "tba",
          match_key: "2026test_qm1",
        });
        assert.equal(await rpc("manual_match", payload), id);
        row = await match(id);
        assert.equal(row.note, "Updated after creation");
        assert.equal(row.source, "manual");
        assert.equal(row.match_key, `manual:${id}`);
        assert.equal(row.version, 2);
        assert.equal((await audit(id)).length, 2);
        await as();
        assert.equal(
          (
            await db.query(
              "select match_number from pit_battery_events where battery_id=$1 and notes='Assigned to match; physical battery status unchanged' order by created_at desc limit 1",
              [battery],
            )
          ).rows[0].match_number,
          "Manual: Practice 1",
        );
        await assert.rejects(
          rpc("match", { event_id: event, match_key: "2026test_qm1" }),
          /Configure this event/,
        );
        await assert.rejects(
          rpc("manual_match", {
            ...payload,
            id: uid(101),
            event_id: officialEvent,
          }),
          /active Pit event/,
        );
        await assert.rejects(
          rpc("match", { event_id: officialEvent, match_id: id, version: 2 }),
          /different event/,
        );
        await assert.rejects(
          rpc("match", { match_id: id, version: 1, note: "Stale" }),
          /changed/,
        );
      },
    );

    await t.test(
      "label validation, duplicate normalization, metadata versioning and identity constraints",
      async () => {
        for (const manual_label of [
          undefined,
          null,
          "",
          " \t\n ",
          "x".repeat(81),
          1,
          {},
        ]) {
          await assert.rejects(
            rpc("manual_match", {
              id: uid(110),
              event_id: event,
              manual_label,
            }),
            /practice label/,
          );
        }
        await assert.rejects(
          rpc("manual_match", { event_id: event, manual_label: "Needs ID" }),
          /request ID/,
        );
        await assert.rejects(
          rpc("manual_match", {
            id: uid(110),
            event_id: event,
            manual_label: "Bad time",
            scheduled_at: "infinity",
          }),
          /valid practice time/,
        );
        await assert.rejects(
          rpc("manual_match", {
            id: uid(110),
            event_id: event,
            manual_label: "Bad time",
            scheduled_at: "invalid",
          }),
          /date|time/i,
        );
        await assert.rejects(
          rpc("manual_match", {
            id: uid(110),
            event_id: event,
            manual_label: "Bad note",
            note: "x".repeat(2001),
          }),
          /check constraint/,
        );
        await assert.rejects(
          rpc("manual_match", {
            id: uid(110),
            event_id: event,
            manual_label: " practice    1 ",
          }),
          /already exists/,
        );
        const id = await rpc("manual_match", {
          id: uid(111),
          event_id: event,
          manual_label: `\t${"x".repeat(80)}\n`,
        });
        assert.equal((await match(id)).manual_label.length, 80);
        await assert.rejects(
          rpc("manual_match", {
            match_id: id,
            version: 1,
            manual_label: "PRACTICE 1",
          }),
          /already exists/,
        );
        await rpc("manual_match", {
          match_id: id,
          version: 1,
          manual_label: "Practice 2",
          scheduled_at: "2026-10-01T17:00:00Z",
          updated_by: uid(7),
        });
        let row = await match(id);
        assert.equal(row.version, 2);
        assert.equal(row.updated_by, uid(2));
        assert.equal(row.manual_label, "Practice 2");
        assert.equal(
          Date.parse(row.scheduled_at),
          Date.parse("2026-10-01T17:00:00Z"),
        );
        await assert.rejects(
          rpc("manual_match", {
            match_id: id,
            version: 1,
            manual_label: "Stale",
          }),
          /changed/,
        );
        await assert.rejects(
          rpc("manual_match", {
            match_id: id,
            manual_label: "Missing version",
          }),
          /changed/,
        );
        await rpc("manual_match", {
          match_id: id,
          version: 2,
          manual_label: "Practice 2",
          scheduled_at: null,
        });
        assert.equal((await match(id)).scheduled_at, null);
        assert.deepEqual(
          (await audit(id)).map((e) => e.action),
          ["created", "metadata_updated", "metadata_updated"],
        );
        await assert.rejects(
          owner(
            "insert into pit_match_ops(id,event_id,match_key,updated_by) values($1,$2,$3,$4)",
            [uid(112), event, `manual:${uid(112)}`, uid(1)],
          ),
          /check constraint/,
        );
        await assert.rejects(
          owner(
            "insert into pit_match_ops(id,event_id,match_key,source,manual_label,updated_by) values($1,$2,'wrong','manual','Wrong identity',$3)",
            [uid(112), event, uid(1)],
          ),
          /check constraint/,
        );
      },
    );

    await t.test(
      "double submissions share a receipt and competing stale saves have one winner",
      async () => {
        const payload = {
          id: uid(114),
          event_id: event,
          manual_label: "Duplicate submit test",
        };
        const ids = await Promise.all([
          rpc("manual_match", payload),
          rpc("manual_match", payload),
        ]);
        assert.deepEqual(ids, [uid(114), uid(114)]);
        assert.equal((await audit(uid(114))).length, 1);
        const edits = await Promise.allSettled([
          rpc("manual_match", {
            match_id: uid(114),
            version: 1,
            manual_label: "First competing save",
          }),
          rpc("manual_match", {
            match_id: uid(114),
            version: 1,
            manual_label: "Second competing save",
          }),
        ]);
        assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(edits.filter((r) => r.status === "rejected").length, 1);
        assert.match(
          edits.find((r) => r.status === "rejected").reason.message,
          /changed/,
        );
        assert.equal((await match(uid(114))).version, 2);
        assert.equal((await audit(uid(114))).length, 2);
        const duplicates = await Promise.allSettled([
          rpc("manual_match", {
            id: uid(115),
            event_id: event,
            manual_label: "Racing duplicate label",
          }),
          rpc("manual_match", {
            id: uid(116),
            event_id: event,
            manual_label: " racing   DUPLICATE label ",
          }),
        ]);
        assert.equal(
          duplicates.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.equal(
          duplicates.filter((r) => r.status === "rejected").length,
          1,
        );
        assert.match(
          duplicates.find((r) => r.status === "rejected").reason.message,
          /already exists/,
        );
      },
    );

    await t.test(
      "current leadership is rechecked and inactive, readonly and anonymous writes fail",
      async () => {
        for (const actor of [3, 4, 5, 6, "anon"]) {
          await assert.rejects(
            rpc(
              "manual_match",
              { id: uid(120), event_id: event, manual_label: "Unauthorized" },
              actor,
            ),
            /leadership|permissions|permission denied/,
          );
        }
        for (const action of [
          "manual_match",
          "finish_manual_match",
          "archive_manual_match",
        ]) {
          await assert.rejects(
            rpc(
              action,
              {
                match_id: uid(100),
                version: 2,
                manual_label: "Unauthorized edit",
                archived: true,
              },
              3,
            ),
            /leadership/,
          );
        }
        assert.equal((await context(event, 4)).can_manage, false);
        assert.equal((await context(event, 8)).can_manage, true);
        await rpc(
          "manual_match",
          { id: uid(121), event_id: event, manual_label: "Assigned lead" },
          8,
        );
        await rpc(
          "manual_match",
          { id: uid(122), event_id: event, manual_label: "Admin practice" },
          7,
        );
        await rpc(
          "manual_match",
          { id: uid(123), event_id: event, manual_label: "Mentor practice" },
          1,
        );
        await owner(
          "update team_member_positions set revoked_at=clock_timestamp() where user_id=$1",
          [uid(2)],
        );
        assert.equal((await context(event)).can_manage, false);
        await assert.rejects(
          rpc("manual_match", {
            id: uid(120),
            event_id: event,
            manual_label: "Revoked",
          }),
          /leadership/,
        );
        await owner(
          "update team_member_positions set revoked_at=null where user_id=$1;",
          [uid(2)],
        );
        await owner(
          "update team_positions set active=false where key='software_lead'",
        );
        await assert.rejects(
          rpc("manual_match", {
            id: uid(120),
            event_id: event,
            manual_label: "Inactive position",
          }),
          /leadership/,
        );
        await owner(
          "update team_positions set active=true where key='software_lead'",
        );
        await owner("update profiles set active=false where id=$1", [uid(2)]);
        await assert.rejects(context(event), /Active team/);
        await assert.rejects(
          rpc("manual_match", {
            id: uid(120),
            event_id: event,
            manual_label: "Inactive profile",
          }),
          /permissions/,
        );
        await as(2);
        assert.equal(
          (await db.query("select * from pit_manual_match_events")).rows.length,
          0,
        );
        await owner("update profiles set active=true where id=$1", [uid(2)]);
      },
    );

    await t.test(
      "manual pre/post lifecycle, run retries, immutable snapshots and explicit finishing",
      async () => {
        const id = uid(130),
          rid = uid(131);
        await rpc("manual_match", {
          id,
          event_id: event,
          manual_label: "Finish safety test",
        });
        await rpc("match", {
          match_id: id,
          version: 1,
          battery_id: battery,
          note: "Keep this preparation",
        });
        await assert.rejects(
          rpc(
            "run",
            {
              id: uid(132),
              match_id: id,
              template_id: post,
              template_version: 1,
            },
            3,
          ),
          /Finish this practice/,
        );
        await rpc(
          "run",
          { id: rid, match_id: id, template_id: pre, template_version: 1 },
          3,
        );
        const before = await context(event),
          snapshot = before.items.filter(
            (i) => before.runs.find((r) => r.id === i.run_id)?.id === rid,
          );
        assert.equal(snapshot.length, 2);
        await rpc("template", {
          ...template("pre"),
          id: pre,
          version: 1,
          active: true,
          items: [
            {
              text: "New checklist revision",
              required: true,
              blocking: true,
              area_id: null,
            },
          ],
        });
        const afterTemplate = await context(event);
        assert.deepEqual(
          afterTemplate.items.filter((i) => i.run_id === rid),
          snapshot,
        );
        assert.equal(
          afterTemplate.runs.find((r) => r.id === rid).template_version,
          1,
        );
        const batteriesBefore = (
          await owner(
            "select to_jsonb(b) value from pit_batteries b order by id",
          )
        ).rows;
        const batteryHistoryBefore = (
          await owner(
            "select to_jsonb(e) value from pit_battery_events e order by id",
          )
        ).rows;
        await rpc("finish_manual_match", {
          match_id: id,
          version: 2,
          finished_at: "2000-01-01T00:00:00Z",
          finished_by: uid(7),
        });
        const row = await match(id);
        assert.equal(row.finished_by, uid(2));
        assert.ok(Date.parse(row.finished_at) > Date.parse("2020-01-01"));
        assert.equal(row.version, 3);
        assert.equal(row.battery_id, battery);
        assert.equal(row.note, "Keep this preparation");
        assert.equal(Object.hasOwn(row, "score"), false);
        assert.deepEqual(
          (
            await owner(
              "select to_jsonb(b) value from pit_batteries b order by id",
            )
          ).rows,
          batteriesBefore,
        );
        assert.deepEqual(
          (
            await owner(
              "select to_jsonb(e) value from pit_battery_events e order by id",
            )
          ).rows,
          batteryHistoryBefore,
        );
        assert.deepEqual(
          (await context(event)).items.filter((i) => i.run_id === rid),
          snapshot,
        );
        await assert.rejects(
          rpc("finish_manual_match", { match_id: id, version: 2 }),
          /changed/,
        );
        await assert.rejects(
          rpc("finish_manual_match", { match_id: id, version: 3 }),
          /already finished/,
        );
        await assert.rejects(
          rpc(
            "run",
            {
              id: uid(132),
              match_id: id,
              template_id: pre,
              template_version: 2,
            },
            3,
          ),
          /Practice is finished/,
        );
        // Same original run ID is never duplicated, even after lifecycle changes.
        assert.equal(
          await rpc(
            "run",
            { id: rid, match_id: id, template_id: pre, template_version: 2 },
            3,
          ),
          rid,
        );
        await assert.rejects(
          rpc(
            "run",
            { id: rid, match_id: id, template_id: pre, template_version: 2 },
            1,
          ),
          /Request ID already used/,
        );
        await rpc(
          "run",
          {
            id: uid(132),
            match_id: id,
            template_id: post,
            template_version: 1,
          },
          3,
        );
        await rpc(
          "item",
          {
            id: snapshot[0].id,
            version: 1,
            complete: true,
            completed_by: uid(7),
          },
          3,
        );
        const item = (await context(event)).items.find(
          (i) => i.id === snapshot[0].id,
        );
        assert.equal(item.completed_by, uid(3));
        assert.ok(item.completed_at);
        await assert.rejects(
          rpc("item", { id: item.id, version: 1, complete: false }, 3),
          /changed/,
        );
        assert.deepEqual(
          (await audit(id)).map((e) => e.action),
          ["created", "preparation_updated", "finished"],
        );
      },
    );

    await t.test(
      "archive preserves incomplete work; restore conflicts safely; archived finished matches allow post inspection",
      async () => {
        const id = uid(140),
          rid = uid(141);
        await rpc("manual_match", {
          id,
          event_id: event,
          manual_label: "Archived practice",
        });
        await rpc(
          "run",
          { id: rid, match_id: id, template_id: pre, template_version: 2 },
          3,
        );
        const before = await context(event),
          item = before.items.find((i) => i.run_id === rid);
        await assert.rejects(
          rpc("archive_manual_match", {
            match_id: id,
            version: 1,
            archived: "true",
          }),
          /archive or restore/,
        );
        await rpc("archive_manual_match", {
          match_id: id,
          version: 1,
          archived: true,
          archived_by: uid(7),
          archived_at: "2000-01-01T00:00:00Z",
        });
        let row = await match(id);
        assert.equal(row.archived_by, uid(2));
        assert.ok(Date.parse(row.archived_at) > Date.parse("2020-01-01"));
        assert.equal(row.version, 2);
        assert.equal(
          (await context(event)).runs.some((r) => r.id === rid),
          true,
        );
        assert.deepEqual(
          (await context(event)).items.find((i) => i.id === item.id),
          item,
        );
        assert.equal(
          await rpc(
            "run",
            { id: rid, match_id: id, template_id: pre, template_version: 2 },
            3,
          ),
          rid,
        );
        for (const tid of [pre, general, post])
          await assert.rejects(
            rpc(
              "run",
              {
                id: uid(142),
                match_id: id,
                template_id: tid,
                template_version: tid === pre ? 2 : 1,
              },
              3,
            ),
            /archived/,
          );
        await assert.rejects(
          rpc("match", { match_id: id, version: 2, note: "Hidden update" }),
          /Restore this practice/,
        );
        await assert.rejects(
          rpc("manual_match", {
            match_id: id,
            version: 2,
            manual_label: "Hidden update",
          }),
          /Restore this practice/,
        );
        await assert.rejects(
          rpc("finish_manual_match", { match_id: id, version: 2 }),
          /Restore this practice/,
        );
        await rpc("item", { id: item.id, version: 1, complete: true }, 3);
        assert.equal(
          (await context(event)).items.find((i) => i.id === item.id)
            .completed_by,
          uid(3),
        );
        await assert.rejects(
          rpc("archive_manual_match", {
            match_id: id,
            version: 1,
            archived: false,
          }),
          /changed/,
        );
        // Archived labels can be reused, but restore must not create duplicates.
        await rpc("manual_match", {
          id: uid(143),
          event_id: event,
          manual_label: "ARCHIVED   PRACTICE",
        });
        await assert.rejects(
          rpc("archive_manual_match", {
            match_id: id,
            version: 2,
            archived: false,
          }),
          /already exists/,
        );
        assert.equal((await match(id)).version, 2);
        await rpc("archive_manual_match", {
          match_id: uid(143),
          version: 1,
          archived: true,
        });
        await rpc("archive_manual_match", {
          match_id: id,
          version: 2,
          archived: false,
        });
        row = await match(id);
        assert.equal(row.archived_at, null);
        assert.equal(row.archived_by, null);
        assert.equal(row.version, 3);
        await rpc("finish_manual_match", { match_id: id, version: 3 });
        await rpc("archive_manual_match", {
          match_id: id,
          version: 4,
          archived: true,
        });
        await rpc(
          "run",
          {
            id: uid(144),
            match_id: id,
            template_id: post,
            template_version: 1,
          },
          3,
        );
        const postItem = (await context(event)).items.find(
          (i) => i.run_id === uid(144),
        );
        await rpc("item", { id: postItem.id, version: 1, complete: true }, 3);
        assert.equal(
          (await context(event)).items.find((i) => i.id === postItem.id)
            .completed_by,
          uid(3),
        );
        await assert.rejects(
          rpc(
            "run",
            {
              id: uid(145),
              match_id: id,
              template_id: pre,
              template_version: 2,
            },
            3,
          ),
          /archived/,
        );
        await assert.rejects(
          rpc(
            "run",
            {
              id: uid(145),
              match_id: id,
              template_id: general,
              template_version: 1,
            },
            3,
          ),
          /archived/,
        );
        assert.deepEqual(
          (await audit(id)).map((e) => e.action),
          ["created", "archived", "restored", "finished", "archived"],
        );
      },
    );

    await t.test(
      "configuration remains independent until official operations exist",
      async () => {
        const before = (await context(event)).matches;
        await rpc("config", {
          event_id: event,
          version: 0,
          team_number: 4418,
          tba_event_key: "2026local",
        });
        await rpc("config", {
          event_id: event,
          version: 1,
          team_number: 4419,
          tba_event_key: "2026other",
        });
        assert.deepEqual((await context(event)).matches, before);
        const id = await rpc("match", {
          event_id: event,
          match_key: "2026other_qm1",
        });
        assert.equal((await match(id)).source, "tba");
        await assert.rejects(
          rpc("config", {
            event_id: event,
            version: 2,
            team_number: 4418,
            tba_event_key: "2026local",
          }),
          /already has match/,
        );
        // Official preparation keeps its established behavior alongside practices.
        await rpc("match", {
          match_id: id,
          version: 1,
          battery_id: battery,
          note: "Official operation",
        });
        await rpc(
          "run",
          {
            id: uid(151),
            match_id: id,
            template_id: post,
            template_version: 1,
          },
          3,
        );
        const issue = await rpc(
          "report_issue",
          {
            match_id: uid(100),
            subsystem: "Intake",
            severity: "HIGH",
            description: "Practice chain slipped",
          },
          3,
        );
        assert.equal(
          (await context(event)).links.find((l) => l.issue_id === issue)
            .match_id,
          uid(100),
        );
        await as();
        assert.equal(
          (
            await db.query(
              "select discovered_match from pit_issues where id=$1",
              [issue],
            )
          ).rows[0].discovered_match,
          "Manual: Practice 1",
        );
      },
    );

    await t.test(
      "history is server-stamped and append-only; direct writes and anonymous APIs remain denied",
      async () => {
        const events = await audit(uid(100));
        assert.equal(events[0].performed_by, uid(2));
        assert.equal(events[0].before_state, null);
        assert.equal(events[0].after_state.source, "manual");
        assert.equal(events[1].before_state.version, 1);
        assert.equal(events[1].after_state.version, 2);
        assert.ok(events.every((e) => e.created_at && e.event_id === event));
        const security = (
          await owner(
            "select relname,relrowsecurity from pg_class where relname in ('pit_match_ops','pit_manual_match_events')",
          )
        ).rows;
        assert.equal(security.length, 2);
        assert.ok(security.every((r) => r.relrowsecurity));
        for (const actor of [2, 5, "anon"]) {
          await as(actor);
          for (const sql of [
            "update pit_match_ops set source='tba'",
            "delete from pit_match_ops",
            "insert into pit_match_ops(event_id,match_key,updated_by) values(gen_random_uuid(),'fake',gen_random_uuid())",
            "update pit_manual_match_events set action='finished'",
            "delete from pit_manual_match_events",
            "insert into pit_manual_match_events(event_id,match_id,action,after_state,performed_by) values(gen_random_uuid(),gen_random_uuid(),'created','{}',gen_random_uuid())",
            "truncate pit_manual_match_events",
          ])
            await assert.rejects(db.query(sql), /permission denied/);
          await assert.rejects(
            db.query("select pit_private.preserve_manual_match_history()"),
            /permission denied/,
          );
        }
        await as("anon");
        await assert.rejects(
          db.query("select * from pit_manual_match_events"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select pit_competition_context(null)"),
          /permission denied/,
        );
        await assert.rejects(
          owner("update pit_manual_match_events set action=action"),
          /append-only/,
        );
        await assert.rejects(
          owner("delete from pit_manual_match_events"),
          /append-only/,
        );
      },
    );

    await t.test(
      "completed or changed events reject every manual mutation and checklist completion",
      async () => {
        const old = await context(event),
          active = await createEvent("Next event");
        await pit("activate_event", { id: active });
        for (const [action, p] of [
          [
            "manual_match",
            { id: uid(160), event_id: event, manual_label: "Too late" },
          ],
          [
            "manual_match",
            { match_id: uid(100), version: 2, manual_label: "Too late" },
          ],
          ["match", { match_id: uid(100), version: 2, note: "Too late" }],
          ["finish_manual_match", { match_id: uid(100), version: 2 }],
          [
            "archive_manual_match",
            { match_id: uid(100), version: 2, archived: true },
          ],
          [
            "run",
            {
              id: uid(161),
              match_id: uid(100),
              template_id: pre,
              template_version: 2,
            },
          ],
        ])
          await assert.rejects(rpc(action, p), /active Pit event/);
        const item = old.items[0];
        await assert.rejects(
          rpc(
            "item",
            { id: item.id, version: item.version, complete: true },
            3,
          ),
          /no longer active/,
        );
        assert.deepEqual(await context(event), old);
        await rpc("manual_match", {
          id: uid(162),
          event_id: active,
          manual_label: "Practice 1",
        });
        await assert.rejects(
          rpc("manual_match", {
            id: uid(100),
            event_id: active,
            manual_label: "Practice 1",
            note: "Local test",
            scheduled_at: "2026-10-01T16:00:00Z",
          }),
          /Request ID already used/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
