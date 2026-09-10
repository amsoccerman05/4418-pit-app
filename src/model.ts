export const subsystems = [
  "Drivetrain",
  "Intake",
  "Shooter",
  "Climber",
  "Electrical",
  "Software",
  "Controls",
  "Structure",
  "Pneumatics",
  "Other",
] as const;
export const severities = ["LOW", "MEDIUM", "HIGH", "ROBOT DOWN"] as const;
export const issueStatuses = [
  "OPEN",
  "DIAGNOSING",
  "REPAIRING",
  "TESTING",
  "RESOLVED",
  "DEFERRED",
] as const;
export const batteryStatuses = [
  "READY",
  "ON ROBOT",
  "COOLING",
  "CHARGING",
  "TESTING",
  "FLAGGED",
  "RETIRED",
] as const;
export type Role = "readonly" | "student" | "lead" | "admin" | "mentor";
export type Profile = {
  id: string;
  display_name: string;
  role: Role;
  active: boolean;
};
export type PitEvent = {
  id: string;
  name: string;
  location: string;
  start_date: string;
  end_date: string;
  status: "upcoming" | "active" | "completed";
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type Issue = {
  id: string;
  issue_number: number;
  event_id: string;
  title: string;
  subsystem: string;
  severity: (typeof severities)[number];
  status: (typeof issueStatuses)[number];
  description: string;
  reported_by: string;
  assigned_to: string | null;
  discovered_match: string;
  root_cause: string;
  repair_notes: string;
  resolution_notes: string;
  resolved_by: string | null;
  resolved_at: string | null;
  battery_id: string | null;
  created_at: string;
  updated_at: string;
};
export type Battery = {
  id: string;
  battery_number: string;
  label: string;
  status: (typeof batteryStatuses)[number];
  notes: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};
export type BatteryEvent = {
  id: string;
  battery_id: string;
  event_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  voltage: number | null;
  voltage_kind: string | null;
  match_number: string;
  issue_id: string | null;
  notes: string;
  performed_by: string;
  created_at: string;
};
export type IssueEvent = {
  id: string;
  issue_id: string;
  performed_by: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  created_at: string;
};
export type Data = {
  events: PitEvent[];
  issues: Issue[];
  batteries: Battery[];
  batteryEvents: BatteryEvent[];
  issueEvents: IssueEvent[];
  profiles: Profile[];
};
export const canWork = (p: Profile) => p.active && p.role !== "readonly";
export const canManage = (p: Profile) =>
  p.active && ["lead", "admin", "mentor"].includes(p.role);
export const isAdmin = (p: Profile) =>
  p.active && ["admin", "mentor"].includes(p.role);
// Deferred remains unresolved, including HIGH / ROBOT DOWN safety blockers.
export const unresolved = (i: Issue) => i.status !== "RESOLVED";
export function readiness(issues: Issue[]) {
  return issues.some((i) => unresolved(i) && i.severity === "ROBOT DOWN")
    ? "NOT READY"
    : issues.some((i) => unresolved(i) && i.severity === "HIGH")
      ? "NEEDS ATTENTION"
      : "READY";
}
export const nextBattery: Partial<
  Record<Battery["status"], { status: Battery["status"]; label: string }>
> = {
  READY: { status: "ON ROBOT", label: "Install on robot" },
  "ON ROBOT": { status: "COOLING", label: "Remove battery" },
  COOLING: { status: "CHARGING", label: "Start charging" },
  CHARGING: { status: "READY", label: "Mark ready" },
  TESTING: { status: "READY", label: "Mark ready" },
};
export const emptyData = (): Data => ({
  events: [],
  issues: [],
  batteries: [],
  batteryEvents: [],
  issueEvents: [],
  profiles: [],
});

// Read the latest usage cycle, never a match from an older installation.
export function batteryMatch(battery: Battery, events: BatteryEvent[]): string {
  const usage = events
    .filter(
      (e) => e.battery_id === battery.id && e.event_type === "status_changed",
    )
    .slice()
    .reverse()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const installed = (e: BatteryEvent) =>
    e.to_status === "ON ROBOT" && e.from_status !== "ON ROBOT";
  if (battery.status === "ON ROBOT")
    return usage.find(installed)?.match_number.trim() || "";
  const removedIndex = usage.findIndex(
    (e) => e.from_status === "ON ROBOT" && e.to_status !== "ON ROBOT",
  );
  if (removedIndex < 0) return "";
  return (
    usage[removedIndex].match_number.trim() ||
    usage
      .slice(removedIndex + 1)
      .find(installed)
      ?.match_number.trim() ||
    ""
  );
}
