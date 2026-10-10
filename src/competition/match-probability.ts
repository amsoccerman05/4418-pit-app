import type { Feed } from "./service";
import type { OperationalMatch } from "./manual";
import { isManualMatch } from "./manual.ts";
import { isStale } from "./feed-state.ts";
import { validProbability } from "../../supabase/functions/competition-feed/statbotics.ts";

// A probability belongs to one official lineup. Never borrow another match's
// estimate, reverse red/blue, or use an EPA value as a probability.
export function matchProbability(
  feed: Feed | null,
  match: OperationalMatch,
  eventKey: string | undefined,
  now: number,
  unavailable = false,
): { red: number; blue: number } | null {
  if (
    isManualMatch(match) ||
    match.completed ||
    match.actual ||
    !eventKey ||
    feed?.eventKey !== eventKey ||
    !match.key.startsWith(`${eventKey}_`) ||
    unavailable ||
    feed.predictionsError ||
    isStale(feed.predictionsAt, now)
  )
    return null;
  const predictions =
    feed.matchPredictions?.filter(
      (p) => p.event === eventKey && p.key === match.key,
    ) ?? [];
  if (predictions.length !== 1) return null;
  const prediction = predictions[0];
  const same = (a: string[], b: string[]) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.length >= 2 &&
    new Set(a).size === a.length &&
    [...a].sort().join(",") === [...b].sort().join(",");
  if (
    !same(prediction.red, match.red) ||
    !same(prediction.blue, match.blue) ||
    !validProbability(prediction.redWinProbability)
  )
    return null;
  return {
    red: prediction.redWinProbability,
    blue: 1 - prediction.redWinProbability,
  };
}
export function probabilityPercent(value: number): string {
  if (value === 0 || value === 1) return `${value * 100}%`;
  if (value < 0.001) return "<0.1%";
  if (value > 0.999) return ">99.9%";
  return `${(value * 100).toFixed(1)}%`;
}
