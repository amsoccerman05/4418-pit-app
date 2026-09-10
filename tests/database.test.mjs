import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
let db;
const ids = {
  readonly: "00000000-0000-0000-0000-000000000001",
  student: "00000000-0000-0000-0000-000000000002",
  lead: "00000000-0000-0000-0000-000000000003",
  admin: "00000000-0000-0000-0000-000000000004",
  mentor: "00000000-0000-0000-0000-000000000005",
  inactive: "00000000-0000-0000-0000-000000000006",
};
async function as(role, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[role] || "",
  ]);
  await db.exec(`set role ${role === "anon" ? "anon" : "authenticated"}`);
  return db.query(sql, params);
}
async function rpc(role, fn, p) {
  const r = await as(role, `select public.pit_${fn}($1::jsonb) as result`, [
    JSON.stringify(p),
  ]);
  return r.rows[0].result;
}
async function owner(sql, p = []) {
  await db.exec("reset role");
  return db.query(sql, p);
}
async function denied(role, fn, p) {
  await assert.rejects(() => rpc(role, fn, p));
}
let event, battery, issue;
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create table public.profiles(id uuid primary key,display_name text,role text,active boolean);create table public.inventory_sentinel(id int primary key, name text);insert into public.inventory_sentinel values(1,'untouched');`,
  );
  for (const [role, id] of Object.entries(ids))
    await db.query("insert into profiles values($1,$2,$3,$4)", [
      id,
      role,
      role === "inactive" ? "admin" : role,
      role !== "inactive",
    ]);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202609090001_pit_operations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
after(async () => {
  await db.close();
});
test("migration preserves existing Inventory data and enables RLS on every Pit table", async () => {
  assert.equal(
    (await owner("select name from inventory_sentinel")).rows[0].name,
    "untouched",
  );
  const rows = (
    await owner(
      "select relname,relrowsecurity from pg_class where relname in ('pit_events','pit_issues','pit_batteries','pit_issue_events','pit_battery_events')",
    )
  ).rows;
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.relrowsecurity));
});
test("admin creates event and battery; only one active event", async () => {
  event = await rpc("admin", "save_event", {
    name: "Denver",
    start_date: "2027-03-25",
    end_date: "2027-03-27",
  });
  await rpc("admin", "activate_event", { id: event });
  battery = await rpc("mentor", "save_battery", { battery_number: "B07" });
  assert.equal(
    (await as("readonly", "select * from pit_events")).rows.length,
    1,
  );
  await denied("student", "save_event", {
    name: "No",
    start_date: "2027-01-01",
    end_date: "2027-01-02",
  });
  await denied("lead", "save_battery", { battery_number: "B08" });
});
test("student reports robot down with battery link; history actor cannot be forged", async () => {
  issue = await rpc("student", "report_issue", {
    event_id: event,
    subsystem: "Shooter",
    severity: "ROBOT DOWN",
    description: "Shooter wheel stopped after Q41.",
    battery_id: battery,
    reported_by: ids.admin,
  });
  const i = (
    await as("readonly", "select * from pit_issues where id=$1", [issue])
  ).rows[0];
  assert.equal(i.status, "OPEN");
  assert.equal(i.reported_by, ids.student);
  assert.equal(
    (
      await as(
        "readonly",
        "select * from pit_battery_events where issue_id=$1",
        [issue],
      )
    ).rows.length,
    1,
  );
  await denied("readonly", "report_issue", {
    event_id: event,
    subsystem: "Shooter",
    severity: "LOW",
    description: "No",
  });
});
test("lead diagnoses, repairs, tests, resolves; stale saves and student edits fail", async () => {
  let i = (await as("lead", "select * from pit_issues where id=$1", [issue]))
    .rows[0];
  await denied("student", "update_issue", {
    id: issue,
    expected_updated_at: i.updated_at,
    status: "RESOLVED",
  });
  const stale = i.updated_at;
  for (const status of ["DIAGNOSING", "REPAIRING", "TESTING", "RESOLVED"]) {
    i = (await as("lead", "select * from pit_issues where id=$1", [issue]))
      .rows[0];
    await rpc("lead", "update_issue", {
      id: issue,
      expected_updated_at: i.updated_at,
      status,
      root_cause: "Loose motor connector",
      repair_notes: "Reseated and secured connector",
    });
  }
  i = (await as("lead", "select * from pit_issues where id=$1", [issue]))
    .rows[0];
  assert.equal(i.resolved_by, ids.lead);
  assert.ok(i.resolved_at);
  assert.equal(
    (
      await as("lead", "select * from pit_issue_events where issue_id=$1", [
        issue,
      ])
    ).rows.length,
    5,
  );
  await denied("lead", "update_issue", {
    id: issue,
    expected_updated_at: stale,
    status: "OPEN",
  });
});
test("battery cycle stores optional post-match voltage and full transitions", async () => {
  let from = "TESTING";
  for (const status of ["READY", "ON ROBOT", "COOLING", "CHARGING", "READY"]) {
    await rpc("student", "transition_battery", {
      id: battery,
      expected_status: from,
      status,
      event_id: event,
      ...(status === "COOLING"
        ? { voltage: 12.18, voltage_kind: "post-match", match_number: "Q34" }
        : {}),
    });
    from = status;
  }
  const history = (
    await as(
      "readonly",
      "select * from pit_battery_events where battery_id=$1 and event_type='status_changed' order by created_at",
      [battery],
    )
  ).rows;
  assert.equal(history.length, 5);
  const measurement = history.find((e) => e.to_status === "COOLING");
  assert.equal(Number(measurement.voltage), 12.18);
  assert.equal(measurement.voltage_kind, "post-match");
  await denied("student", "transition_battery", {
    id: battery,
    expected_status: "CHARGING",
    status: "READY",
  });
});
test("battery brownout link and flagged release permissions", async () => {
  const brownout = await rpc("student", "report_issue", {
    event_id: event,
    subsystem: "Electrical",
    severity: "HIGH",
    description: "Brownout during Q34",
    battery_id: battery,
  });
  await rpc("student", "transition_battery", {
    id: battery,
    expected_status: "READY",
    status: "FLAGGED",
    event_id: event,
  });
  await denied("student", "transition_battery", {
    id: battery,
    expected_status: "FLAGGED",
    status: "READY",
  });
  assert.equal(
    (
      await as(
        "readonly",
        "select * from pit_battery_events where issue_id=$1",
        [brownout],
      )
    ).rows.length,
    1,
  );
  await rpc("lead", "transition_battery", {
    id: battery,
    expected_status: "FLAGGED",
    status: "TESTING",
  });
  await denied("lead", "transition_battery", {
    id: battery,
    expected_status: "TESTING",
    status: "RETIRED",
  });
});
test("cannot install two batteries or submit invalid voltage; failed writes roll back", async () => {
  await rpc("student", "transition_battery", {
    id: battery,
    expected_status: "TESTING",
    status: "ON ROBOT",
  });
  const other = await rpc("admin", "save_battery", { battery_number: "B08" });
  await denied("student", "transition_battery", {
    id: other,
    expected_status: "TESTING",
    status: "ON ROBOT",
  });
  await denied("student", "transition_battery", {
    id: battery,
    expected_status: "ON ROBOT",
    status: "COOLING",
    voltage: 21,
    voltage_kind: "post-match",
  });
  assert.equal(
    (
      await as("readonly", "select status from pit_batteries where id=$1", [
        battery,
      ])
    ).rows[0].status,
    "ON ROBOT",
  );
});
test("readonly, inactive, anonymous and direct mutations are denied", async () => {
  for (const role of ["readonly", "inactive", "anon"])
    await denied(role, "transition_battery", {
      id: battery,
      expected_status: "ON ROBOT",
      status: "COOLING",
    });
  for (const role of ["student", "admin"]) {
    await assert.rejects(() =>
      as(role, "update pit_batteries set status='READY' where id=$1", [
        battery,
      ]),
    );
    await assert.rejects(() => as(role, "delete from pit_issues"));
    await assert.rejects(() =>
      as(
        role,
        "insert into pit_issue_events(issue_id,performed_by,changes) values($1,$2,'{}')",
        [issue, ids.admin],
      ),
    );
  }
  assert.equal(
    (await as("inactive", "select * from pit_issues")).rows.length,
    0,
  );
  await assert.rejects(() => as("anon", "select * from pit_issues"));
});
test("switching events preserves history and rejects reports into completed event", async () => {
  const next = await rpc("admin", "save_event", {
    name: "Next regional",
    start_date: "2027-04-01",
    end_date: "2027-04-03",
  });
  await rpc("admin", "activate_event", { id: next });
  assert.equal(
    (await as("readonly", "select * from pit_events where status='active'"))
      .rows.length,
    1,
  );
  assert.equal(
    (await as("readonly", "select status from pit_events where id=$1", [event]))
      .rows[0].status,
    "completed",
  );
  assert.ok(
    (
      await as("readonly", "select * from pit_issues where event_id=$1", [
        event,
      ])
    ).rows.length >= 2,
  );
  await denied("student", "report_issue", {
    event_id: event,
    subsystem: "Other",
    severity: "LOW",
    description: "Archived",
  });
});
