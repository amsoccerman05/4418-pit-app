import { supabase } from "./client";
import {
  type Data,
  type Profile,
  type Issue,
  type Battery,
  canWork,
  canManage,
  isAdmin,
} from "./model";
import { readDemo, writeDemo } from "./demo";
export async function fetchData(): Promise<Data> {
  if (!supabase) throw new Error("Supabase is not configured.");
  async function all(table: string) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase!
        .from(table)
        .select("*")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  const [events, issues, batteries, batteryEvents, issueEvents, profiles] =
    await Promise.all(
      [
        "pit_events",
        "pit_issues",
        "pit_batteries",
        "pit_battery_events",
        "pit_issue_events",
        "profiles",
      ].map(all),
    );
  return {
    events,
    issues,
    batteries,
    batteryEvents,
    issueEvents,
    profiles,
  } as Data;
}
export async function mutate(
  demo: boolean,
  profile: Profile,
  action: string,
  p: Record<string, unknown>,
): Promise<void> {
  if (!demo) {
    const { error } = await supabase!.rpc(`pit_${action}`, { p });
    if (error) throw error;
    return;
  }
  const d = readDemo(),
    now = new Date().toISOString(),
    id = crypto.randomUUID();
  if (!canWork(profile)) throw new Error("View-only account.");
  const logBattery = (
    b: Battery,
    from: string | null,
    to: string | null,
    issue: string | null = null,
  ) =>
    d.batteryEvents.push({
      id: crypto.randomUUID(),
      battery_id: b.id,
      event_id: String(p.event_id || "") || null,
      event_type: issue
        ? "issue_linked"
        : from === to
          ? "measurement"
          : "status_changed",
      from_status: from,
      to_status: to,
      voltage: p.voltage == null ? null : Number(p.voltage),
      voltage_kind:
        p.voltage == null ? null : String(p.voltage_kind || "pre-match"),
      match_number: String(p.match_number || ""),
      issue_id: issue,
      notes: String(p.notes || ""),
      performed_by: profile.id,
      created_at: now,
    });
  if (action === "report_issue") {
    const i = {
      id,
      issue_number: Math.max(0, ...d.issues.map((i) => i.issue_number)) + 1,
      event_id: p.event_id,
      title: String(p.description).trim().slice(0, 100),
      subsystem: p.subsystem,
      severity: p.severity,
      status: "OPEN",
      description: p.description,
      reported_by: profile.id,
      assigned_to: null,
      discovered_match: p.discovered_match || "",
      root_cause: "",
      repair_notes: "",
      resolution_notes: "",
      resolved_by: null,
      resolved_at: null,
      battery_id: p.battery_id || null,
      created_at: now,
      updated_at: now,
    } as Issue;
    d.issues.push(i);
    d.issueEvents.push({
      id: crypto.randomUUID(),
      issue_id: id,
      performed_by: profile.id,
      changes: { status: { from: null, to: "OPEN" } },
      created_at: now,
    });
    if (i.battery_id)
      logBattery(
        d.batteries.find((b) => b.id === i.battery_id)!,
        null,
        null,
        id,
      );
  } else if (action === "update_issue") {
    if (!canManage(profile)) throw new Error("Lead access required.");
    const i = d.issues.find((i) => i.id === p.id)!;
    if (i.updated_at !== p.expected_updated_at)
      throw new Error(
        "This issue changed on another device. Close and reopen it before saving.",
      );
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of [
      "status",
      "assigned_to",
      "root_cause",
      "repair_notes",
      "resolution_notes",
      "battery_id",
      "severity",
      "title",
    ] as const) {
      if (k in p && p[k] !== i[k]) {
        changes[k] = { from: i[k], to: p[k] };
        Object.assign(i, { [k]: p[k] });
      }
    }
    if (changes.status) {
      i.resolved_at = i.status === "RESOLVED" ? now : null;
      i.resolved_by = i.status === "RESOLVED" ? profile.id : null;
    }
    i.updated_at = now;
    d.issueEvents.push({
      id,
      issue_id: i.id,
      performed_by: profile.id,
      changes,
      created_at: now,
    });
    if (changes.battery_id && i.battery_id)
      logBattery(
        d.batteries.find((b) => b.id === i.battery_id)!,
        null,
        null,
        i.id,
      );
  } else if (action === "transition_battery") {
    const b = d.batteries.find((b) => b.id === p.id)!;
    if (b.status !== p.expected_status)
      throw new Error("Battery status changed. Refresh and try again.");
    if (!b.active || b.status === "RETIRED" || p.status === "RETIRED") {
      if (!isAdmin(profile))
        throw new Error("Admin access required for retired batteries.");
    }
    if (b.status === "FLAGGED" && !canManage(profile) && p.status !== "FLAGGED")
      throw new Error("A lead must release a flagged battery.");
    if (
      p.status === "ON ROBOT" &&
      d.batteries.some((x) => x.id !== b.id && x.status === "ON ROBOT")
    )
      throw new Error("Remove the current battery before installing another.");
    logBattery(b, b.status, String(p.status));
    b.status = p.status as Battery["status"];
    b.updated_at = now;
  } else if (action === "save_event") {
    if (!isAdmin(profile)) throw new Error("Admin access required.");
    const existing = d.events.find((e) => e.id === p.id);
    if (existing) Object.assign(existing, p, { updated_at: now });
    else
      d.events.push({
        id,
        name: String(p.name),
        location: String(p.location || ""),
        start_date: String(p.start_date),
        end_date: String(p.end_date),
        status: "upcoming",
        notes: String(p.notes || ""),
        created_by: profile.id,
        created_at: now,
        updated_at: now,
      });
  } else if (action === "activate_event") {
    if (!isAdmin(profile)) throw new Error("Admin access required.");
    d.events.forEach((e) => {
      if (e.status === "active") e.status = "completed";
      if (e.id === p.id) e.status = "active";
    });
  } else if (action === "save_battery") {
    if (!isAdmin(profile)) throw new Error("Admin access required.");
    if (
      d.batteries.some(
        (b) =>
          b.battery_number === String(p.battery_number).toUpperCase() &&
          b.id !== p.id,
      )
    )
      throw new Error("Battery number already exists.");
    const b = d.batteries.find((b) => b.id === p.id);
    if (b) Object.assign(b, p, { updated_at: now });
    else
      d.batteries.push({
        id,
        battery_number: String(p.battery_number).toUpperCase(),
        label: String(p.label || ""),
        status: "TESTING",
        notes: String(p.notes || ""),
        active: true,
        created_at: now,
        updated_at: now,
      });
  } else throw new Error("Unknown operation.");
  writeDemo(d);
}
