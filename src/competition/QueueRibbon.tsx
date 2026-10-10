import { useEffect, useState } from "react";
import type { Competition } from "./service";
import { liveFor } from "./service";
import { isManualMatch, type OperationalMatch } from "./manual";
import { isStale } from "./feed-state";
import { queueTiming } from "./live-display";
export function QueueRibbon({
  c,
  next,
  status,
  stale,
  scheduleStale,
}: {
  c: Competition;
  next: OperationalMatch | null;
  status: string;
  stale: boolean;
  scheduleStale: boolean;
}) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const manual = !!next && isManualMatch(next);
  // Recheck the two independent source clocks every second; a paused polling
  // loop must not keep a countdown looking current.
  const fresh =
    c.liveAvailable &&
    !isStale(c.feed?.nexus?.asOf, clock, 120000) &&
    !isStale(c.feed?.nexusAt, clock, 120000);
  const live =
    next && !manual && fresh
      ? liveFor(next, c.feed?.nexus?.matches || [])
      : null;
  const timing = queueTiming(live, clock);
  return (
    <section className="comp-queue-ribbon" aria-label="Queue and readiness">
      <div
        className={`comp-bumper ${!manual && next ? `comp-bumper-${next.alliance}` : ""}`}
      >
        <small>
          {next?.label || "NEXT MATCH"}
          {!manual && scheduleStale ? " · VERIFY LINEUP" : ""}
        </small>
        <strong>
          {manual
            ? "PRACTICE"
            : next
              ? `${next.alliance.toUpperCase()} BUMPERS`
              : "No match"}
        </strong>
      </div>
      <div className="comp-queue-timer">
        <strong>{manual ? "Manual practice" : timing.headline}</strong>
        <small>
          {manual ? "Confirm timing with field crew" : timing.detail}
          {!manual && timing.at
            ? ` · ${new Date(timing.at).toLocaleTimeString()}`
            : ""}
        </small>
      </div>
      <div className="comp-ribbon-readiness">
        <small>ROBOT</small>
        <strong
          className={
            stale ? "comp-stale" : status === "NOT READY" ? "comp-danger" : ""
          }
        >
          {stale ? "VERIFY STATUS" : status}
        </strong>
      </div>
    </section>
  );
}
