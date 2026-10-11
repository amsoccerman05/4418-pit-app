import type { Profile } from "../model";
import { currentReports, type Observation } from "./model";
import { optionLabel, ratingLabel } from "./labels";

// Only display names already readable through the app's existing profile query.
// Never fall back to an email address or database identifier.
export function scoutName(id: string | undefined, profiles: Profile[]): string {
  const name = profiles
    .find((profile) => profile.id === id)
    ?.display_name?.trim();
  return name &&
    !name.includes("@") &&
    !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(name)
    ? name
    : "Unknown scout";
}
export const originalScout = (report: Observation) =>
  report.scout_id || report.created_by;
export function reportTitle(report: Observation): string {
  return report.kind === "pit"
    ? "Pit interview"
    : String(report.data.match_label || "Match report");
}
export function reportFields(report: Observation): [string, string][] {
  const data = report.data;
  const number = (field: string) =>
    typeof data[field] === "number"
      ? String(data[field])
      : "Unknown / not recorded";
  const choice = (field: string) =>
    data[field] == null || data[field] === "unknown"
      ? "Unknown / not recorded"
      : optionLabel(field, String(data[field]));
  const rating = (field: string) =>
    typeof data[field] === "number"
      ? ratingLabel(field, data[field])
      : "Not rated";
  return report.kind === "match"
    ? [
        ["Alliance", choice("alliance")],
        ["Driver station", number("station")],
        ["Start position", choice("start_position")],
        ["AUTO fuel", number("auto_fuel")],
        ["TELEOP fuel", number("teleop_fuel")],
        ["AUTO climb", choice("auto_climb")],
        ["Endgame climb", choice("endgame")],
        ["Estimated accuracy", choice("accuracy")],
        ["Main role", choice("role")],
        ["Field traversal", choice("traversal")],
        ["Fuel intake", choice("intake")],
        ["Driver ability", rating("driver")],
        ["Defense effectiveness", rating("defense")],
        [
          "Disabled / breakdown",
          data.disabled === true
            ? "Flagged"
            : data.disabled === false
              ? "Not flagged"
              : "Unknown / not recorded",
        ],
        [
          "No-show",
          data.no_show === true
            ? "Flagged"
            : data.no_show === false
              ? "Not flagged"
              : "Unknown / not recorded",
        ],
      ]
    : [
        ["Drivetrain", choice("drive")],
        ["Fuel intake", choice("intake")],
        ["Fuel capacity", number("capacity")],
        ["Field traversal", choice("traversal")],
        ["Climb capability", choice("climb")],
      ];
}
export function filterReports(
  observations: Observation[],
  profiles: Profile[],
  options: { search: string; kind: string; includeSuperseded: boolean },
): Observation[] {
  const query = options.search.trim().toLowerCase();
  return (
    options.includeSuperseded ? observations : currentReports(observations)
  )
    .filter(
      (report) =>
        (options.kind === "all" || report.kind === options.kind) &&
        (!query ||
          [
            report.team_number,
            reportTitle(report),
            report.kind,
            scoutName(report.created_by, profiles),
            scoutName(originalScout(report), profiles),
            report.data.notes,
            report.data.auto_notes,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
    );
}
