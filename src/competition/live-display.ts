import type { EventMatch, LiveMatch } from "./service";
export function queueTiming(live: LiveMatch | null, now: number) {
  if (!live)
    return {
      headline: "Live queue unavailable",
      detail: "Confirm with field crew",
      at: null,
    };
  if (["Now queuing", "On deck", "On field"].includes(live.status))
    return {
      headline: live.status.toUpperCase(),
      detail: live.actualQueue ? "Actually queued" : "Nexus queue status",
      at: live.actualQueue ?? null,
    };
  if (live.actualQueue)
    return {
      headline: "QUEUED",
      detail: "Actually queued",
      at: live.actualQueue,
    };
  if (!live.queue)
    return {
      headline: "Queue time unavailable",
      detail: live.status,
      at: null,
    };
  const remaining = live.queue - now;
  if (remaining <= 0)
    return {
      headline: "Queue estimate passed",
      detail: "Confirm with field crew",
      at: live.queue,
    };
  const seconds = Math.ceil(remaining / 1000),
    minutes = Math.floor(seconds / 60);
  return {
    headline: `${minutes}:${String(seconds % 60).padStart(2, "0")} to queue`,
    detail: "Estimated · may change",
    at: live.queue,
  };
}
export function measuredEventDelay(matches: EventMatch[]) {
  const latest = matches
    .filter((m) => m.actual && m.scheduled)
    .sort((a, b) => b.actual! - a.actual!)[0];
  return latest
    ? {
        match: latest.label,
        at: latest.actual!,
        minutes: Math.round((latest.actual! - latest.scheduled!) / 60000),
      }
    : null;
}
