import { useEffect, useRef } from "react";
import { issueOwner, type Data } from "../model";
import { liveFor, type Competition } from "./service";
import { isStale } from "./feed-state";
import type { Readiness } from "./readiness";
import { EventStandings } from "./Standings";
const at = (n: number | null | undefined) =>
  n ? new Date(n).toLocaleString() : "Not loaded";
export function PitDisplay({
  c,
  data,
  state,
  team,
  eventName,
  dataUpdatedAt,
  dataError,
  close,
}: {
  c: Competition;
  data: Data;
  state: Readiness;
  team: number;
  eventName: string;
  dataUpdatedAt: number | null;
  dataError: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    { next, battery, installed, readyBatteries, preItems, reasons } = state;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const n =
    next && c.liveAvailable
      ? liveFor(next, c.feed?.nexus?.matches || [])
      : null;
  const localStale =
    c.readOnly || c.online===false ||
    !!dataError ||
    !!c.error ||
    isStale(dataUpdatedAt, c.tick, 60000) ||
    isStale(c.contextAt, c.tick, 90000);
  const scheduleStale =
    c.online===false || !!c.feedError || !!c.feed?.tbaError || isStale(c.feed?.tbaAt, c.tick);
  return (
    <dialog
      ref={dialog}
      className="comp-pit-display competition"
      aria-label="Pit display"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="comp-feed">
        <div>
          <small>TEAM {team} · PIT DISPLAY</small>
          <h1>{eventName}</h1>
        </div>
        <button onClick={close} autoFocus>
          Close pit display
        </button>
      </header>
      <div className="comp-display-freshness" role="status">
        <strong>
          {c.online===false ? 'OFFLINE · READ-ONLY SNAPSHOT' : localStale
            ? "PIT DATA MAY BE STALE · verify before queueing"
            : "Pit data connected"}
        </strong>
        <span>
          Issues / batteries: {at(dataUpdatedAt)} · Checklists:{" "}
          {at(c.contextAt)}
        </span>
        <span>
          {scheduleStale ? "Schedule may be stale" : "TBA schedule"} ·{" "}
          {at(c.feed?.tbaAt)} ·{" "}
          {c.liveAvailable ? "Nexus live" : "Live queue unavailable"}
        </span>
        <button disabled={c.refreshing} onClick={()=>void c.refresh(true)}>Retry schedule / checklists</button>
      </div>
      <div className="comp-display-grid">
        <section className="card comp-display-next">
          <small>NEXT MATCH</small>
          <h2>{next?.label || "Not published"}</h2>
          <p>
            {next
              ? `${next.alliance.toUpperCase()} · ${next[next.alliance].join(" · ")}`
              : "No upcoming match in the loaded schedule."}
          </p>
          <strong>
            {n?.status ||
              (c.liveAvailable
                ? "Queue status not available for this match"
                : "Live queue unavailable")}
          </strong>
          <p>
            {n?.queue
              ? `Queue estimate ${at(n.queue)}`
              : next?.scheduled
                ? `Scheduled ${at(next.scheduled)}`
                : ""}
          </p>
          {c.liveAvailable && c.feed?.nexus?.nowQueuing && (
            <p>Event queue: {c.feed.nexus.nowQueuing}</p>
          )}
        </section>
        <section className="card comp-display-status">
          <small>{next ? "ROBOT STATUS" : "CHECKLIST / REPAIR STATUS"}</small>
          <h2
            className={
              localStale
                ? "comp-stale"
                : state.status === "NOT READY"
                  ? "comp-danger"
                  : ""
            }
          >
            {localStale
              ? "VERIFY STATUS"
              : state.status === "READY"
                ? next
                  ? "ROBOT READY"
                  : "CHECKS CLEAR"
                : state.status}
          </h2>
          {localStale && <p>Last recorded: {state.status}</p>}
          <p>
            {next
              ? `Pre-match checks: ${preItems.filter((i) => i.completed_at).length}/${preItems.length}`
              : "No next-match preparation required yet."}
          </p>
        </section>
        <section className="card">
          <h2>Batteries</h2>
          <p>
            Installed:{" "}
            <strong>
              {installed.length
                ? installed.map((b) => b.battery_number).join(", ")
                : "None recorded"}
            </strong>
          </p>
          <p>
            Assigned{next ? ` to ${next.label}` : ""}:{" "}
            <strong>
              {battery
                ? `${battery.battery_number} · ${battery.status}`
                : "None"}
            </strong>
          </p>
          <p>
            <strong>{readyBatteries.length}</strong> ready spare
            {readyBatteries.length === 1 ? "" : "s"}
          </p>
          <small>Installation and removal must be recorded by the crew.</small>
        </section>
        <section className="card comp-display-blockers">
          <h2>Needs attention · {reasons.length}</h2>
          {reasons.length ? (
            <ul>
              {reasons.map((reason) => (
                <li key={reason.key}>
                  <strong>
                    {reason.blocking ? "BLOCKER · " : ""}
                    {reason.text}
                  </strong>
                  {reason.issueId && (
                    <span>
                      Owner:{" "}
                      {issueOwner(
                        data.issues.find((i) => i.id === reason.issueId)!,
                        data.profiles,
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No outstanding readiness checks or repair blockers.</p>
          )}
        </section>
      </div>
      <EventStandings c={c} team={team} />
      {state.issues.filter((i) => !["HIGH", "ROBOT DOWN"].includes(i.severity))
        .length > 0 && (
        <section className="card">
          <h2>Other open repairs</h2>
          <ul>
            {state.issues
              .filter((i) => !["HIGH", "ROBOT DOWN"].includes(i.severity))
              .map((i) => (
                <li key={i.id}>
                  {i.title} · {i.severity} · Owner:{" "}
                  {issueOwner(i, data.profiles)}
                </li>
              ))}
          </ul>
        </section>
      )}
      <footer>
        <small>
          Display refreshes while open. Schedule and queue estimates can change;
          confirm with field crew.
        </small>
      </footer>
    </dialog>
  );
}
