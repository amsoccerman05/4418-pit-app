// Statbotics v3 public team-event API. Event EPA is a model estimate, not an
// official score or an IMPULSE scouting observation. No private data is sent.
export type TeamEPA = {
  team: number;
  total: number | null;
  auto: number | null;
  teleop: number | null;
  endgame: number | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const points = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100000
    ? v
    : null;
export function parseTeamEPAs(raw: unknown, event: string): TeamEPA[] {
  if (!Array.isArray(raw) || raw.length > 1000)
    throw new Error("Invalid Statbotics event response");
  const result = new Map<number, TeamEPA>();
  for (const row of raw) {
    if (
      !object(row) ||
      row.event !== event ||
      !Number.isSafeInteger(row.team) ||
      Number(row.team) < 1 ||
      Number(row.team) > 99999 ||
      result.has(Number(row.team))
    )
      throw new Error("Invalid Statbotics team identity");
    const epa = object(row.epa) ? row.epa : {},
      breakdown = object(epa.breakdown) ? epa.breakdown : {};
    result.set(Number(row.team), {
      team: Number(row.team),
      total: points(
        object(epa.total_points) ? epa.total_points.mean : epa.total_points,
      ),
      auto: points(breakdown.auto_points),
      teleop: points(breakdown.teleop_points),
      endgame: points(breakdown.endgame_points),
    });
  }
  // Exactly a full page could hide more teams. Do not call a truncated page complete.
  if (raw.length === 1000)
    throw new Error("Statbotics event response needs pagination");
  return [...result.values()].sort((a, b) => a.team - b.team);
}

// Public v3 match.pred.red_win_prob is a 0–1 pre-match model probability.
// Statbotics displays blue as 1 - red; it publishes no separate tie probability.
// Source: avgupta456/statbotics frontend/src/pagesContent/match/[match_id]/summary.tsx
export type MatchPrediction = {
  event: string;
  key: string;
  red: string[];
  blue: string[];
  redWinProbability: number | null;
};
export const validProbability = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;
export function parseMatchPredictions(
  raw: unknown,
  event: string,
): MatchPrediction[] {
  if (!Array.isArray(raw) || raw.length >= 1000)
    throw new Error("Invalid or incomplete Statbotics match response");
  const seen = new Set<string>();
  const alliance = (value: unknown): string[] => {
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      value.length > 3 ||
      value.some(
        (team) => !Number.isSafeInteger(team) || team < 1 || team > 99999,
      ) ||
      new Set(value).size !== value.length
    )
      throw new Error("Invalid Statbotics alliance");
    return value.map(String);
  };
  return raw.map((row) => {
    if (
      !object(row) ||
      row.event !== event ||
      typeof row.key !== "string" ||
      !row.key.startsWith(`${event}_`) ||
      !/^(qm[1-9][0-9]*|(?:ef|qf|sf|f)[1-9][0-9]*m[1-9][0-9]*)$/.test(
        row.key.slice(event.length + 1),
      ) ||
      seen.has(row.key) ||
      !object(row.alliances) ||
      !object(row.alliances.red) ||
      !object(row.alliances.blue)
    )
      throw new Error("Invalid Statbotics match identity");
    seen.add(row.key);
    const red = alliance(row.alliances.red.team_keys);
    const blue = alliance(row.alliances.blue.team_keys);
    if (red.some((team) => blue.includes(team)))
      throw new Error("Overlapping alliances");
    if (row.pred != null && !object(row.pred))
      throw new Error("Invalid Statbotics prediction");
    const value = object(row.pred) ? row.pred.red_win_prob : null;
    if (value != null && !validProbability(value))
      throw new Error("Invalid Statbotics probability");
    return { event, key: row.key, red, blue, redWinProbability: value ?? null };
  });
}
