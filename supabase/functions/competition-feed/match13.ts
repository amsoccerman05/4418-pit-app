import { validProbability, type MatchPrediction } from "./statbotics.ts";
import type { Match } from "./external.ts";

// Official contract: https://www.match13.com/docs/api. winProb is RED's 0–1
// chance. The teams dictionary has no alliance colors and no model timestamp.
export type Match13Record = {
  event: string;
  key: string;
  teams: string[];
  redWinProbability: number | null;
};
export type Match13Prediction = MatchPrediction & {
  rosterVerification: "tba-six-team-set";
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keyFor = (key: unknown, event: string): key is string =>
  typeof key === "string" &&
  key.startsWith(`${event}_`) &&
  /^(qm[1-9][0-9]*|(?:ef|qf|sf|f)[1-9][0-9]*m[1-9][0-9]*)$/.test(
    key.slice(event.length + 1),
  );
const same = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
const validTeams = (teams: unknown): teams is string[] =>
  Array.isArray(teams) &&
  teams.length === 6 &&
  teams.every((t) => typeof t === "string" && /^[1-9][0-9]{0,4}$/.test(t)) &&
  new Set(teams).size === 6;
export function parseMatch13(raw: unknown, event: string): Match13Record[] {
  if (
    !object(raw) ||
    raw.eventKey !== event ||
    raw.year !== Number(event.slice(0, 4)) ||
    !Array.isArray(raw.matches) ||
    raw.matches.length > 2000
  )
    throw new Error("Invalid Match13 event response");
  const seen = new Set<string>();
  const rows: Match13Record[] = [];
  for (const row of raw.matches) {
    if (
      !object(row) ||
      !keyFor(row.key, event) ||
      seen.has(row.key) ||
      !object(row.teams) ||
      (row.bye !== undefined && typeof row.bye !== "boolean")
    )
      throw new Error("Invalid Match13 match identity");
    seen.add(row.key);
    if (row.bye) continue;
    const teams = Object.keys(row.teams);
    if (!validTeams(teams)) throw new Error("Invalid Match13 roster");
    if (row.pred != null && !object(row.pred))
      throw new Error("Invalid Match13 prediction");
    const value = object(row.pred) ? row.pred.winProb : null;
    if (value != null && !validProbability(value))
      throw new Error("Invalid Match13 probability");
    rows.push({
      event,
      key: row.key,
      teams: teams.sort(),
      redWinProbability: value ?? null,
    });
  }
  return rows;
}
// The database contains only these normalized public fields, never headers,
// credentials, raw problem responses, or private scouting/operational records.
export function validateMatch13Records(
  raw: unknown,
  event: string,
): Match13Record[] {
  if (!Array.isArray(raw) || raw.length > 2000)
    throw new Error("Invalid cached Match13 response");
  const seen = new Set<string>();
  return raw.map((row) => {
    if (
      !object(row) ||
      row.event !== event ||
      !keyFor(row.key, event) ||
      seen.has(row.key) ||
      !validTeams(row.teams) ||
      (row.redWinProbability !== null &&
        !validProbability(row.redWinProbability))
    )
      throw new Error("Invalid cached Match13 prediction");
    seen.add(row.key);
    return {
      event,
      key: row.key,
      teams: [...row.teams],
      redWinProbability: row.redWinProbability,
    };
  });
}
export const currentTime = (at: number | null | undefined, now: number) =>
  typeof at === "number" &&
  Number.isSafeInteger(at) &&
  at > 0 &&
  now - at <= 300000 &&
  at <= now + 60000;
export function trustedUpcoming(match: Match, event: string): boolean {
  return (
    keyFor(match.key, event) &&
    !match.completed &&
    !match.actual &&
    match.red.length === 3 &&
    match.blue.length === 3 &&
    validTeams([...match.red, ...match.blue])
  );
}
export function hasPrimaryPrediction(
  predictions: MatchPrediction[],
  match: Match,
  event: string,
): boolean {
  const rows = predictions.filter(
    (row) => row.event === event && row.key === match.key,
  );
  return (
    rows.length === 1 &&
    same(rows[0].red, match.red) &&
    same(rows[0].blue, match.blue) &&
    validProbability(rows[0].redWinProbability)
  );
}
export function bindMatch13(
  records: Match13Record[],
  matches: Match[],
  event: string,
): Match13Prediction[] {
  // TBA supplies red/blue, not object iteration order. Reject ambiguous schedule
  // keys, byes, incomplete rosters, changed teams, and started/completed matches.
  const seen = new Map<string, number>();
  for (const match of matches)
    seen.set(match.key, (seen.get(match.key) ?? 0) + 1);
  return records.flatMap((row) => {
    const match = matches.find((m) => m.key === row.key);
    if (
      !match ||
      seen.get(row.key) !== 1 ||
      !trustedUpcoming(match, event) ||
      !same(row.teams, [...match.red, ...match.blue]) ||
      !validProbability(row.redWinProbability)
    )
      return [];
    return [
      {
        event,
        key: row.key,
        red: [...match.red],
        blue: [...match.blue],
        redWinProbability: row.redWinProbability,
        rosterVerification: "tba-six-team-set" as const,
      },
    ];
  });
}
