import type { Assignment } from "./model";
import type { EventMatch } from "../competition/service";

export type DriverStation = { alliance: "red" | "blue"; station: 1 | 2 | 3 };
export const driverStations: DriverStation[] = ["red", "blue"].flatMap(
  (alliance) =>
    [1, 2, 3].map((station) => ({ alliance, station }) as DriverStation),
);
export function driverStation(value: {
  alliance?: unknown;
  station?: unknown;
}): DriverStation | null {
  return (value.alliance === "red" || value.alliance === "blue") &&
    [1, 2, 3].includes(value.station as number)
    ? { alliance: value.alliance, station: value.station as 1 | 2 | 3 }
    : null;
}
export const stationLabel = (value: DriverStation) =>
  `${value.alliance === "red" ? "Red" : "Blue"} ${value.station}`;
export const stationKey = (value: DriverStation) =>
  `${value.alliance}${value.station}`;
export function isStationAssignment(
  value: Assignment,
): value is Assignment & DriverStation {
  return (
    value.kind === "match" &&
    value.team_number === null &&
    value.match_key === null &&
    !!driverStation(value)
  );
}
export function validAssignment(value: Assignment): boolean {
  if (
    !["match", "pit"].includes(value.kind) ||
    !Number.isInteger(value.version) ||
    value.version < 1
  )
    return false;
  if (isStationAssignment(value)) return true;
  return (
    value.alliance == null &&
    value.station == null &&
    Number.isInteger(value.team_number) &&
    value.team_number! >= 1 &&
    value.team_number! <= 99999 &&
    (value.kind === "pit"
      ? value.match_key === null
      : typeof value.match_key === "string" && !!value.match_key)
  );
}
/** Only a complete ordered alliance can identify a field station safely. */
export function stationTeam(
  match: Pick<EventMatch, "red" | "blue"> | null | undefined,
  station: DriverStation | null,
): number | null {
  if (!match || !station) return null;
  const teams = match[station.alliance];
  if (
    !Array.isArray(teams) ||
    teams.length !== 3 ||
    teams.some(
      (team) => typeof team !== "string" || !/^[1-9]\d{0,4}$/.test(team),
    ) ||
    new Set(teams).size !== 3
  )
    return null;
  return Number(teams[station.station - 1]);
}
export function findStationMatch(schedule: EventMatch[], key: string | null) {
  if (!key) return undefined;
  return schedule.find(
    (match) =>
      match.key === key || match.key.replace(/^[0-9]{4}[a-z0-9]+_/, "") === key,
  );
}
