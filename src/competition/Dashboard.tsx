import { useState } from "react";
import { isStale } from "./feed-state";
import { PitDisplay } from "./PitDisplay";
import { EventStandings } from "./Standings";
import type { Readiness } from "./readiness";
import { canWork, issueOwner, type Data, type Profile } from "../model";
import { liveFor, nextMatch, type Competition, type Context } from "./service";
import { isManualMatch } from "./manual";
const at = (n: number | null) =>
  n
    ? new Date(n).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Not published";
export function CompetitionDashboard({
  c,
  d,
  data,
  profile,
  state,
  dataUpdatedAt,
  dataError,
  open,
  openIssue,
  batteryAction,
  go,
  report,
}: {
  c: Competition;
  d: Context;
  data: Data;
  profile: Profile;
  state: Readiness;
  dataUpdatedAt: number | null;
  dataError: string;
  open: (key: string) => void;
  openIssue: (id: string) => void;
  batteryAction: (id: string) => void;
  go: (page: any) => void;
  report: () => void;
}) {
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
  const matches = c.feed?.matches || [],
    next = state.next,
    team = d.config?.team_number || 4418;
  const live = c.liveAvailable ? c.feed?.nexus : null,
    n =
      next && !isManualMatch(next) && live ? liveFor(next, live.matches) : null;
  const [display, setDisplay] = useState(false);
  const {
    status: readiness,
    ops,
    battery,
    pre,
    preItems,
    incomplete,
    issues,
    last,
    lastOps,
    postPending,
    reasons,
  } = state;
  const blocking = issues.filter((i) => i.severity === "ROBOT DOWN"),
    attention = reasons.length > 0;
  const actOnReason = (reason: Readiness["reasons"][number]) => {
    if (reason.issueId) openIssue(reason.issueId);
    else if (reason.batteryId) batteryAction(reason.batteryId);
    else if (reason.matchKey) open(reason.matchKey);
    else if (reason.checklists) go("checklists");
  };
  const strong = n && ["Now queuing", "On deck", "On field"].includes(n.status),
    warn = n?.status === "Queuing soon";
  const queueMinutes = n?.queue
      ? Math.ceil((n.queue - Date.now()) / 60000)
      : null,
    scheduledMinutes = next?.scheduled
      ? Math.ceil((next.scheduled - Date.now()) / 60000)
      : null;
  const officialNext = nextMatch(matches);
  const index = officialNext
      ? matches.findIndex((m) => m.key === officialNext.key)
      : matches.length - 1,
    near = matches.slice(Math.max(0, index - 2), Math.max(0, index - 2) + 6),
    qual = matches.filter((m) => m.level === "qm");
  return (
    <div className="comp-dashboard">
      <div className="comp-display-toolbar">
        <button onClick={() => setDisplay(true)}>Open pit display</button>
        <small>Large text for a pit tablet or monitor</small>
        {d.can_manage && d.manual_matches_enabled && (
          <button onClick={() => go("matches")}>Manage practice matches</button>
        )}
      </div>
      {display && (
        <PitDisplay
          c={c}
          data={data}
          state={state}
          team={team}
          eventName={
            c.feed?.eventName ||
            data.events.find((e) => e.status === "active")?.name ||
            "Competition"
          }
          dataUpdatedAt={dataUpdatedAt}
          dataError={dataError}
          close={() => setDisplay(false)}
        />
      )}
      {d.config && <EventStandings c={c} team={team} />}

      <div className="comp-dashboard-primary">
        <section className="card comp-next">
          <small>
            {next && isManualMatch(next)
              ? "NEXT MANUAL PRACTICE"
              : scheduleStale
                ? "LAST LOADED NEXT MATCH"
                : "NEXT MATCH"}{" "}
            · TEAM {team}
          </small>
          {next ? (
            <>
              <div className="comp-match-title">
                <h2>{next.label}</h2>
                {isManualMatch(next) ? (
                  <span className="badge info">Manual</span>
                ) : (
                  <span
                    className={
                      "badge " + (next.alliance === "red" ? "danger" : "info")
                    }
                  >
                    {next.alliance.toUpperCase()}
                  </span>
                )}
              </div>
              {isManualMatch(next) ? (
                <p>
                  Finish or archive this practice to move on to the next match.
                  Confirm timing with the field crew.
                </p>
              ) : (
                <>
                  <p className="comp-alliance">
                    {next[next.alliance].map((t, i) => (
                      <span key={t}>
                        {i > 0 ? " · " : ""}
                        {t === String(team) ? <strong>{t}</strong> : t}
                      </span>
                    ))}
                  </p>
                  <p>
                    vs{" "}
                    {next[next.alliance === "red" ? "blue" : "red"].join(" · ")}
                  </p>
                </>
              )}
              <div
                className={
                  "comp-timing " +
                  (strong
                    ? "comp-timing-strong"
                    : warn
                      ? "comp-timing-warning"
                      : "")
                }
              >
                {n && <strong>{n.status}</strong>}
                {n?.queue && (
                  <p>
                    {queueMinutes! > 0
                      ? `Queue in ~${queueMinutes} min`
                      : `Queue estimate ${at(n.queue)} · check live status`}
                  </p>
                )}
                {!n?.queue && scheduledMinutes !== null && (
                  <p>
                    {scheduledMinutes > 0
                      ? `Scheduled in ${scheduledMinutes} min`
                      : "Scheduled time has passed · awaiting update"}
                  </p>
                )}
                <small>
                  {isManualMatch(next) && !next.scheduled
                    ? "No scheduled start time"
                    : `Scheduled ${at(next.scheduled)}`}
                  {n?.estimated
                    ? ` · Nexus estimate ${at(n.estimated)}`
                    : !isManualMatch(next) && next.predicted
                      ? ` · TBA estimate ${at(next.predicted)}`
                      : ""}
                </small>
              </div>
            </>
          ) : (
            <h2>No upcoming match published</h2>
          )}
          {live &&
            (live.nowQueuing || live.matches.some((m) => !m.committed)) && (
              <div className="comp-live-strip">
                <small>LIVE EVENT · NEXUS</small>
                {live.nowQueuing && <p>Now queuing: {live.nowQueuing}</p>}
                {live.matches
                  .filter(
                    (m) => !m.committed && m.status !== "Status unavailable",
                  )
                  .slice(0, 3)
                  .map((m) => (
                    <p key={m.label}>
                      {m.label} · <strong>{m.status}</strong>
                    </p>
                  ))}
              </div>
            )}
        </section>
        <section className="card comp-readiness">
          <small>ROBOT STATUS</small>
          <h2
            className={
              localStale
                ? "comp-stale"
                : readiness === "NOT READY"
                  ? "comp-danger"
                  : ""
            }
          >
            {localStale
              ? "VERIFY STATUS"
              : readiness === "READY"
                ? next
                  ? "ROBOT READY"
                  : "CHECKS CLEAR"
                : readiness === "NOT READY"
                  ? "ROBOT NOT READY"
                  : "NEEDS ATTENTION"}
          </h2>
          <p>
            {localStale && `Last recorded: ${readiness} · `}
            {battery
              ? `Battery ${battery.battery_number} · ${battery.status}`
              : "Battery not assigned"}
            {next ? ` for ${next.label}` : ""}
          </p>
          {next && (
            <p>
              Pre-match{" "}
              {pre.length
                ? `${preItems.filter((i) => i.completed_at).length}/${preItems.length}`
                : "not started"}
            </p>
          )}
          {incomplete.length > 0 && (
            <p>
              {incomplete.length} required checks remaining ·{" "}
              {incomplete.filter((i) => i.blocking).length} blocking
            </p>
          )}
          <p>
            {blocking.length} blocking issues ·{" "}
            {issues.length - blocking.length} other open
          </p>
          {attention && readiness !== "READY" && (
            <button
              onClick={() =>
                document
                  .getElementById("comp-attention")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              View blockers
            </button>
          )}
        </section>
      </div>
      {next && (
        <div className="comp-primary-action">
          <button className="primary" onClick={() => open(next.key)}>
            {strong
              ? `Open ${next.label}`
              : pre.length
                ? `Continue checklist · ${next.label}`
                : `Prepare for ${next.label}`}
          </button>
          {d.can_manage && (
            <button onClick={() => open(next.key)}>
              {battery ? "Change battery" : "Assign battery"}
            </button>
          )}
          {canWork(profile) && (
            <button disabled={c.readOnly} onClick={report}>
              Report issue
            </button>
          )}
        </div>
      )}
      {!next && !last && canWork(profile) && (
        <button disabled={c.readOnly} onClick={report}>
          Report issue
        </button>
      )}
      {attention && (
        <section className="card comp-attention" id="comp-attention">
          <h2>Needs attention</h2>
          {reasons.map((reason) => (
            <button
              className="comp-row"
              key={reason.key}
              onClick={() => actOnReason(reason)}
            >
              {reason.text}
              {reason.issueId && (
                <small className="issue-owner">
                  Owner:{" "}
                  {issueOwner(
                    data.issues.find((i) => i.id === reason.issueId)!,
                    data.profiles,
                  )}
                </small>
              )}
            </button>
          ))}
        </section>
      )}
      {near.length > 0 && (
        <section className="card">
          <h2>Team {team} match progress</h2>
          <div className="comp-progress">
            {near.map((m) => (
              <button
                key={m.key}
                aria-current={m.key === officialNext?.key ? "step" : undefined}
                onClick={() => open(m.key)}
              >
                <strong>{m.label}</strong>
                <small>
                  {m.completed
                    ? m.winner
                      ? m.winner === m.alliance
                        ? "Won"
                        : "Lost"
                      : m.redScore === m.blueScore
                        ? "Tie"
                        : "Result pending"
                    : m.actual
                      ? "In progress"
                      : m.key === officialNext?.key
                        ? "NEXT"
                        : "Upcoming"}
                </small>
                {m.completed && (
                  <small>
                    Red {m.redScore} · Blue {m.blueScore}
                  </small>
                )}
              </button>
            ))}
          </div>
          {qual.length > 0 && (
            <small>
              {team}: {qual.filter((m) => m.completed).length} of {qual.length}{" "}
              published qualification matches complete
            </small>
          )}
        </section>
      )}
      {last && (
        <section className="card comp-after">
          <h2>After {last.label}</h2>
          <div className="comp-inline">
            <button onClick={() => open(last.key)}>
              {postPending
                ? "Start post-match inspection"
                : "Open completed match"}
            </button>
            {lastOps?.battery_id && canWork(profile) && (
              <button onClick={() => batteryAction(lastOps.battery_id!)}>
                Battery actions
              </button>
            )}
          </div>
          {!next && canWork(profile) && (
            <button disabled={c.readOnly} onClick={report}>
              Report issue
            </button>
          )}
          <small>
            Inspection and battery handling require your confirmation.
          </small>
        </section>
      )}
      {!!live?.announcements.length && (
        <section className="card">
          <h2>Event update</h2>
          {[...live.announcements]
            .sort((a, b) => (b.at || 0) - (a.at || 0))
            .slice(0, 2)
            .map((a) => (
              <p key={a.id}>
                {a.text} <small>{at(a.at)}</small>
              </p>
            ))}
        </section>
      )}
    </div>
  );
}
