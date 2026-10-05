import type { Data } from "../model";
import type { Context, Match } from "./service";
import {
  nextMatch,
  operationalReadiness,
} from "../../supabase/functions/competition-feed/external.ts";

export type ReadinessReason = {
  key: string;
  text: string;
  blocking: boolean;
  matchKey?: string;
  batteryId?: string;
  issueId?: string;
  checklists?: boolean;
};
// A single read-only projection for both dashboard and pit display. Feed results
// never complete a checklist or change a battery's recorded physical state.
export function competitionReadiness(d: Context, data: Data, matches: Match[]) {
  const next = nextMatch(matches),
    ops = d.matches.find((o) => o.match_key === next?.key);
  const battery = data.batteries.find((b) => b.id === ops?.battery_id);
  const installed = data.batteries.filter((b) => b.status === "ON ROBOT");
  const readyBatteries = data.batteries.filter(
    (b) => b.active && b.status === "READY",
  );
  const pre = d.runs.filter((r) => r.kind === "pre" && r.match_id === ops?.id);
  const preItems = d.items.filter((i) => pre.some((r) => r.id === i.run_id));
  const incomplete = d.items.filter(
    (i) => !i.completed_at && (i.required || i.blocking),
  );
  const event = data.events.find((e) => e.status === "active");
  const issues = data.issues.filter(
    (i) => i.event_id === event?.id && i.status !== "RESOLVED",
  );
  const last = matches.filter((m) => m.completed).at(-1),
    lastOps = d.matches.find((o) => o.match_key === last?.key);
  const post = d.runs.filter(
    (r) => r.kind === "post" && r.match_id === lastOps?.id,
  );
  const postPending =
    !!last &&
    (!post.length ||
      d.items.some(
        (i) =>
          post.some((r) => r.id === i.run_id) &&
          (i.required || i.blocking) &&
          !i.completed_at,
      ));
  const reasons: ReadinessReason[] = issues
    .filter((i) => ["HIGH", "ROBOT DOWN"].includes(i.severity))
    .map((i) => ({
      key: i.id,
      text: `${i.title} · ${i.subsystem} · ${i.severity}`,
      blocking: i.severity === "ROBOT DOWN",
      issueId: i.id,
    }));
  if (incomplete.length)
    reasons.push({
      key: "checks",
      text: `${incomplete.length} incomplete required checks · View checklists`,
      blocking: incomplete.some((i) => i.blocking),
      checklists: true,
    });
  if (next && !pre.length)
    reasons.push({
      key: "pre",
      text: `Pre-match checklist not started for ${next.label}`,
      blocking: false,
      matchKey: next.key,
    });
  let batteryReadiness: "ready" | "attention" | "blocked" = "ready";
  if (next) {
    if (!battery) {
      batteryReadiness = "attention";
      reasons.push({
        key: "battery",
        text: `Battery not assigned for ${next.label}`,
        blocking: false,
        matchKey: next.key,
      });
    } else if (
      !battery.active ||
      !["READY", "ON ROBOT"].includes(battery.status)
    ) {
      batteryReadiness = "blocked";
      reasons.push({
        key: "battery",
        text: `Battery ${battery.battery_number} · ${!battery.active ? "inactive" : battery.status} · not ready for ${next.label}`,
        blocking: true,
        batteryId: battery.id,
      });
    } else if (battery.status === "READY") {
      batteryReadiness = "attention";
      reasons.push({
        key: "battery",
        text: `Install assigned battery ${battery.battery_number} for ${next.label}`,
        blocking: false,
        batteryId: battery.id,
      });
    }
    if (installed.length > 1 || installed.some((b) => b.id !== battery?.id)) {
      batteryReadiness = "blocked";
      reasons.push({
        key: "battery-mismatch",
        text: `Installed battery ${installed.map((b) => b.battery_number).join(", ")} does not match the single assignment for ${next.label}. Confirm battery swap.`,
        blocking: true,
        matchKey: next.key,
      });
    }
  }
  if (postPending && last)
    reasons.push({
      key: "post",
      text: `Post-match inspection unfinished · ${last.label}`,
      blocking: false,
      matchKey: last.key,
    });
  const status = operationalReadiness(issues, d.items, pre.length > 0, {
    hasNext: !!next,
    battery: batteryReadiness,
    postPending,
  });
  return {
    status,
    reasons,
    next,
    ops,
    battery,
    installed,
    readyBatteries,
    pre,
    preItems,
    incomplete,
    issues,
    last,
    lastOps,
    postPending,
  };
}
export type Readiness = ReturnType<typeof competitionReadiness>;
