import type { EventTeam } from "../competition/service";
import type { Summary } from "./model";

export type DirectorySummary = Summary & {
  name: string | null;
  listed: boolean;
};
// A roster entry is identity, never a scouting observation. Missing metrics stay null.
export function withEventTeams(
  summaries: Summary[],
  teams: EventTeam[] = [],
): DirectorySummary[] {
  const byNumber = new Map<number, DirectorySummary>(
    summaries.map((s) => [s.team, { ...s, name: null, listed: false }]),
  );
  for (const team of teams) {
    const existing = byNumber.get(team.number);
    byNumber.set(team.number, {
      ...(existing || {
        team: team.number,
        reports: 0,
        matches: 0,
        autoMatches: 0,
        teleopMatches: 0,
        fuelMatches: 0,
        auto: null,
        teleop: null,
        fuel: null,
        climbRate: null,
        disabledRate: null,
        driver: null,
        defense: null,
        pit: null,
        observations: [],
      }),
      name: team.name,
      listed: true,
    });
  }
  return [...byNumber.values()].sort((a, b) => a.team - b.team);
}
