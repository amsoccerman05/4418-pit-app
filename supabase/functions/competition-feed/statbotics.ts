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
