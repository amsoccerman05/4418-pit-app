import type { Feed } from "./service";
import type { OperationalMatch } from "./manual";
import { isManualMatch } from "./manual.ts";
import { isStale } from "./feed-state.ts";
import { validProbability } from "../../supabase/functions/competition-feed/statbotics.ts";

export type SelectedProbability = {
  red: number;
  blue: number;
  provider: "Statbotics" | "Match13";
  fetchedAt: number;
};
// A probability belongs to one official lineup. Never borrow another match's
// estimate, reverse red/blue, or use an EPA/rating as a probability.
export function selectMatchProbability(
  feed: Feed | null,
  match: OperationalMatch,
  eventKey: string | undefined,
  now: number,
  unavailable = false,
): SelectedProbability | null {
  if (
    isManualMatch(match) ||
    match.completed ||
    match.actual ||
    !eventKey ||
    feed?.eventKey !== eventKey ||
    !match.key.startsWith(`${eventKey}_`) ||
    unavailable
  )
    return null;
  const same = (a: string[], b: string[]) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.length >= 2 &&
    a.length <= 3 &&
    new Set(a).size === a.length &&
    [...a].sort().join(",") === [...b].sort().join(",");
  for (const provider of ["Statbotics", "Match13"] as const) {
    const backup = provider === "Match13";
    const at = backup ? feed.match13At : feed.predictionsAt;
    const error = backup ? feed.match13Error : feed.predictionsError;
    if (error || isStale(at, now)) continue;
    // Match13 lacks color fields. Its normalized red/blue must have been bound
    // to this exact six-team TBA roster, and the current schedule must be fresh.
    if (
      backup &&
      (feed.tbaError ||
        isStale(feed.tbaAt, now) ||
        match.red.length !== 3 ||
        match.blue.length !== 3 ||
        new Set([...match.red, ...match.blue]).size !== 6)
    )
      continue;
    const predictions =
      (backup ? feed.match13Predictions : feed.matchPredictions)?.filter(
        (p) => p.event === eventKey && p.key === match.key,
      ) ?? [];
    if (predictions.length !== 1) continue;
    const prediction = predictions[0];
    if (
      backup &&
      (!("rosterVerification" in prediction) ||
        prediction.rosterVerification !== "tba-six-team-set")
    )
      continue;
    if (
      !same(prediction.red, match.red) ||
      !same(prediction.blue, match.blue) ||
      !validProbability(prediction.redWinProbability)
    )
      continue;
    return {
      red: prediction.redWinProbability,
      blue: 1 - prediction.redWinProbability,
      provider,
      fetchedAt: at!,
    };
  }
  return null;
}
export function matchProbability(
  feed: Feed | null,
  match: OperationalMatch,
  eventKey: string | undefined,
  now: number,
  unavailable = false,
): { red: number; blue: number } | null {
  const selected = selectMatchProbability(
    feed,
    match,
    eventKey,
    now,
    unavailable,
  );
  return selected ? { red: selected.red, blue: selected.blue } : null;
}
export function probabilityPercent(value: number): string {
  if (value === 0 || value === 1) return `${value * 100}%`;
  if (value < 0.001) return "<0.1%";
  if (value > 0.999) return ">99.9%";
  return `${(value * 100).toFixed(1)}%`;
}
