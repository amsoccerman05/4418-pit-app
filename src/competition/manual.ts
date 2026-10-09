import type { Match, Ops } from "./service";
import { nextMatch } from "../../supabase/functions/competition-feed/external.ts";

// Manual practice is local operations data, never an invented TBA match/result.
export type ManualMatch = {
  source: "manual";
  key: string;
  label: string;
  scheduled: number | null;
  actual: null;
  completed: boolean;
  finishedAt: number | null;
  archived: boolean;
};
export type OperationalMatch = Match | ManualMatch;
export function isManualMatch(match: OperationalMatch): match is ManualMatch {
  return "source" in match && match.source === "manual";
}
export function manualMatches(
  ops: Ops[],
  includeArchived = false,
): ManualMatch[] {
  return ops
    .filter((o) => o.source === "manual" && (includeArchived || !o.archived_at))
    .map((o) => ({
      source: "manual" as const,
      key: o.match_key,
      label: o.manual_label || "Practice match",
      scheduled: o.scheduled_at ? Date.parse(o.scheduled_at) : null,
      actual: null,
      completed: !!o.finished_at,
      finishedAt: o.finished_at ? Date.parse(o.finished_at) : null,
      archived: !!o.archived_at,
    }))
    .sort(
      (a, b) =>
        (a.scheduled ?? Infinity) - (b.scheduled ?? Infinity) ||
        a.label.localeCompare(b.label, undefined, { numeric: true }) ||
        a.key.localeCompare(b.key),
    );
}
// An open practice is explicit crew work. It stays the preparation target until
// finished or archived; TBA updates cannot silently replace that target.
export function nextOperationalMatch(
  matches: Match[],
  ops: Ops[],
): OperationalMatch | null {
  return manualMatches(ops).find((m) => !m.completed) || nextMatch(matches);
}
export function latestCompletedMatch(
  matches: Match[],
  ops: Ops[],
): OperationalMatch | null {
  const official = matches.filter((m) => m.completed).at(-1);
  const manual = manualMatches(ops, true)
    .filter((m) => m.completed)
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
  if (!manual) return official || null;
  if (!official) return manual;
  return (manual.finishedAt || 0) >=
    (official.actual || official.scheduled || 0)
    ? manual
    : official;
}
export function practiceLabel(ops: Ops) {
  return ops.source === "manual"
    ? ops.manual_label || "Practice match"
    : ops.match_key;
}

// Include finished and archived practices so the suggested label keeps a clear
// sequence. This is only a draft; the server still enforces active uniqueness.
export function nextPracticeLabel(ops: Ops[]): string {
  const labels = ops
    .filter((o) => o.source === "manual")
    .map((o) =>
      (o.manual_label || "").trim().replace(/\s+/g, " ").toLowerCase(),
    );
  const used = new Set(labels);
  const numbers = labels
    .map((label) => /^practice (\d+)$/.exec(label)?.[1])
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  let next = numbers.reduce((max, n) => Math.max(max, n), 0) + 1;
  if (!Number.isSafeInteger(next)) next = 1;
  while (used.has(`practice ${next}`)) next++;
  return `Practice ${next}`;
}
