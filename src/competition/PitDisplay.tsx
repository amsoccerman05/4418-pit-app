import { batteryReference } from "../model";
import { useEffect, useRef } from "react";
import { issueOwner, type Data } from "../model";
import { liveFor, type Competition } from "./service";
import { isStale } from "./feed-state";
import type { Readiness } from "./readiness";
import { isManualMatch } from "./manual";
import { EventStandings } from "./Standings";
import { EventStream } from "./EventStream";
import { EventBoard } from "./EventBoard";
import { QueueRibbon } from "./QueueRibbon";
import { StatboticsComparison } from "./StatboticsComparison";
import { measuredEventDelay } from "./live-display";
import "./live-display.css";
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
    next && !isManualMatch(next) && c.liveAvailable
      ? liveFor(next, c.feed?.nexus?.matches || [])
      : null;
  const localStale =
    c.readOnly ||
    c.online === false ||
    !!dataError ||
    !!c.error ||
    isStale(dataUpdatedAt, c.tick, 60000) ||
    isStale(c.contextAt, c.tick, 90000);
  const scheduleStale =
    c.online === false ||
    !!c.feedError ||
    !!c.feed?.tbaError ||
    isStale(c.feed?.tbaAt, c.tick);
  const delay = measuredEventDelay(
    c.feed?.scoutingMatches || c.feed?.matches || [],
  );
  const externalStale = c.online === false || !!c.feedError || !!c.error;
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
          {c.online === false
            ? "OFFLINE · READ-ONLY SNAPSHOT"
            : localStale
              ? "PIT DATA MAY BE STALE · verify before queueing"
              : "Pit data connected"}
        </strong>
        <span>
          Issues / batteries: {at(dataUpdatedAt)} · Checklists:{" "}
          {at(c.contextAt)}
        </span>
        <span>
          {c.context?.config ? (
            <>
              {scheduleStale ? "Schedule may be stale" : "TBA schedule"} ·{" "}
              {at(c.feed?.tbaAt)} ·{" "}
              {c.liveAvailable ? "Nexus live" : "Live queue unavailable"}
            </>
          ) : (
            "Official schedule not connected · manual practice uses saved crew data"
          )}
        </span>
        <button disabled={c.refreshing} onClick={() => void c.refresh(true)}>
          Retry schedule / checklists
        </button>
      </div>
      <QueueRibbon
        c={c}
        next={next}
        status={state.status}
        stale={localStale}
        scheduleStale={scheduleStale}
      />
      <div className="comp-display-grid">
        <section className="card comp-display-next">
          <small>NEXT MATCH</small>
          <h2>{next?.label || "Not published"}</h2>
          <p>
            {next
              ? isManualMatch(next)
                ? "Manual practice · confirm timing with field crew"
                : `${next.alliance.toUpperCase()} · ${next[next.alliance].join(" · ")}`
              : "No upcoming match in the loaded schedule."}
          </p>
          <strong>
            {next && isManualMatch(next)
              ? "Finish or archive practice to move on"
              : n?.status ||
                (c.liveAvailable
                  ? "Queue status not available for this match"
                  : "Live queue unavailable")}
          </strong>
          <p>
            {n?.actualQueue
              ? `Actually queued ${at(n.actualQueue)}`
              : n?.queue
                ? `Queue estimate ${at(n.queue)}`
                : next?.scheduled
                  ? `Scheduled ${at(next.scheduled)}`
                  : ""}
          </p>
          {delay && (
            <p className="comp-delay">
              {scheduleStale ? "Stale · " : ""}Last measured event delay:{" "}
              {delay.minutes === 0
                ? "on schedule"
                : `${Math.abs(delay.minutes)} min ${delay.minutes > 0 ? "behind" : "ahead"}`}{" "}
              · {delay.match} actual start {at(delay.at)}. This is not a
              forecast.
            </p>
          )}
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
                ? installed.map((b) => batteryReference(b)).join(", ")
                : "None recorded"}
            </strong>
          </p>
          <p>
            Assigned{next ? ` to ${next.label}` : ""}:{" "}
            <strong>
              {battery
                ? `${batteryReference(battery)} · ${battery.status}`
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
      {c.context?.config && (
        <>
          <div className="comp-display-extras">
            <EventStream
              key={`${c.feed?.eventKey}:${c.feed?.configVersion}`}
              eventKey={c.feed?.eventKey || ""}
              webcasts={c.feed?.webcasts || []}
              fetchedAt={c.feed?.webcastsAt ?? null}
              error={c.feed?.webcastsError ?? null}
              online={c.online !== false}
              stale={
                externalStale || isStale(c.feed?.webcastsAt, c.tick, 600000)
              }
            />
            <EventBoard
              key={`${c.feed?.eventKey}:${c.feed?.configVersion}`}
              board={c.feed?.nexusBoard || null}
              boardAt={c.feed?.nexusBoardAt}
              boardError={c.feed?.nexusBoardError}
              boardStale={
                externalStale ||
                isStale(c.feed?.nexusBoardAt, c.tick, 120000) ||
                isStale(c.feed?.nexusBoard?.asOf, c.tick, 120000)
              }
              map={c.feed?.pitMap || null}
              mapAt={c.feed?.pitMapAt}
              mapError={c.feed?.pitMapError}
              mapStale={
                externalStale || isStale(c.feed?.pitMapAt, c.tick, 600000)
              }
              addresses={c.feed?.pitAddresses}
              addressesAt={c.feed?.pitAddressesAt}
              addressesError={c.feed?.pitAddressesError}
              addressesStale={
                externalStale || isStale(c.feed?.pitAddressesAt, c.tick, 600000)
              }
              now={c.tick}
              team={team}
            />
          </div>
          {next && !isManualMatch(next) && (
            <StatboticsComparison
              feed={c.feed}
              teams={[...next.red, ...next.blue].map(Number)}
              now={c.tick}
              unavailable={externalStale}
            />
          )}
          <EventStandings c={c} team={team} />
        </>
      )}
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
