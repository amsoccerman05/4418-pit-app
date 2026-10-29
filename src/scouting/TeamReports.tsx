import { useEffect, useId, useRef, useState } from "react";
import { canWork, type Profile } from "../model";
import { currentReports, type Observation } from "./model";
import {
  filterReports,
  originalScout,
  reportFields,
  reportTitle,
  scoutName,
} from "./reports";

type Props = {
  team: number;
  name?: string | null;
  eventName: string;
  observations: Observation[];
  profiles: Profile[];
  profile: Profile;
  manager: boolean;
  active: boolean;
  loaded: boolean;
  refreshing: boolean;
  online: boolean;
  error: string;
  updatedAt: number | null;
  refresh: () => void;
  close: () => void;
  correct: (report: Observation) => void;
};
const at = (time: string) => new Date(time).toLocaleString();
export function TeamReports({
  team,
  name,
  eventName,
  observations,
  profiles,
  profile,
  manager,
  active,
  loaded,
  refreshing,
  online,
  error,
  updatedAt,
  refresh,
  close,
  correct,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    const element = dialog.current;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const current = currentReports(observations);
  const currentIds = new Set(current.map((report) => report.id));
  const visible = filterReports(observations, profiles, {
    search,
    kind,
    includeSuperseded,
  });
  const historyCount = observations.length - current.length;
  return (
    <dialog
      ref={dialog}
      className="scout-detail"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        // Native modal inertness protects the page behind us, but Chromium can
        // move focus to browser chrome at a boundary. Keep Tab/Shift+Tab cycling
        // through the currently visible, enabled report controls instead.
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, a[href], summary, [tabindex]",
          ),
        ).filter(
          (control) =>
            control.tabIndex >= 0 &&
            !control.matches(":disabled") &&
            control.getClientRects().length > 0,
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="scout-report-header">
        <div>
          <small>
            {eventName}
            {name ? ` · ${name}` : ""}
          </small>
          <h2 id={titleId}>Team {team} · reports &amp; notes</h2>
        </div>
        <button type="button" onClick={close} autoFocus>
          Close reports
        </button>
      </header>
      <div className="scout-report-body">
        <div className="scout-toolbar">
          <p className="scout-caveat" role="status">
            {loaded
              ? `${current.filter((report) => report.kind === "match").length} current match reports · ${current.filter((report) => report.kind === "pit").length} pit reports${historyCount ? ` · ${historyCount} superseded` : ""}`
              : refreshing || (online && !error)
                ? "Loading scouting reports…"
                : "Scouting reports are unavailable."}
            {updatedAt
              ? ` Last checked ${new Date(updatedAt).toLocaleString()}.`
              : ""}
          </p>
          <button
            type="button"
            disabled={!online || refreshing}
            onClick={refresh}
          >
            {refreshing ? "Refreshing reports…" : "Refresh reports"}
          </button>
        </div>
        {(!online || error) && (
          <p className="connection-stale" role="status">
            {!online ? "Offline. " : ""}
            {error || "Showing last loaded scouting reports."}
            {loaded
              ? " These reports may be outdated."
              : " Reconnect and refresh to load reports."}
          </p>
        )}
        {loaded && (
          <>
            <div className="scout-report-filters">
              <label>
                Search reports
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Match, scout, or notes"
                />
              </label>
              <label>
                Report type
                <select
                  aria-label="Report type"
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  <option value="all">All reports</option>
                  <option value="match">Match reports</option>
                  <option value="pit">Pit reports</option>
                </select>
              </label>
            </div>
            <label className="scout-history-toggle">
              <input
                type="checkbox"
                checked={includeSuperseded}
                onChange={(event) => setIncludeSuperseded(event.target.checked)}
              />
              Include superseded reports
            </label>
            <p className="scout-caveat">
              Only current reports count in team summaries. Fuel counts are
              observations, not official points. Unknown values stay unknown.
            </p>
            {!!observations.length && (
              <p className="scout-result-count" role="status">
                Showing {visible.length}{" "}
                {visible.length === 1 ? "report" : "reports"}
                {search || kind !== "all" ? " matching your filters" : ""}.
              </p>
            )}
            {!observations.length ? (
              <p>
                Not scouted yet. Synced match and pit reports will appear here.
                Device-only reports stay in Device until synced.
              </p>
            ) : !visible.length ? (
              <div className="scout-no-results">
                <p>No reports match your filters.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setKind("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              visible.map((report) => {
                const isCurrent = currentIds.has(report.id);
                const prior = observations.find(
                  (item) => item.id === report.supersedes_id,
                );
                const replacement = observations.find(
                  (item) => item.supersedes_id === report.id,
                );
                const fields = reportFields(report);
                const correctable =
                  isCurrent &&
                  active &&
                  canWork(profile) &&
                  (manager || originalScout(report) === profile.id);
                return (
                  <article className="scout-report" key={report.id}>
                    <div className="scout-toolbar">
                      <h3>{reportTitle(report)}</h3>
                      <span
                        className={`badge ${isCurrent ? "success" : "neutral"}`}
                      >
                        {isCurrent
                          ? report.supersedes_id
                            ? "Corrected"
                            : "Current"
                          : "Superseded"}
                      </span>
                    </div>
                    <p className="scout-report-meta">
                      {report.kind === "pit" ? "Pit report" : "Match report"} ·
                      Team {report.team_number}
                    </p>
                    <p className="scout-report-meta">
                      <strong>
                        Submitted by {scoutName(report.created_by, profiles)}
                      </strong>
                      <br />
                      <time dateTime={report.created_at}>
                        {at(report.created_at)}
                      </time>
                    </p>
                    {originalScout(report) !== report.created_by && (
                      <p className="scout-report-meta">
                        Original scout:{" "}
                        {scoutName(originalScout(report), profiles)}
                      </p>
                    )}
                    {report.supersedes_id && (
                      <p className="scout-correction-note">
                        Corrects{" "}
                        {prior
                          ? `the report submitted by ${scoutName(prior.created_by, profiles)} on ${at(prior.created_at)}.`
                          : "an earlier report whose details are unavailable."}
                      </p>
                    )}
                    {replacement && (
                      <p className="scout-correction-note">
                        Superseded by a correction submitted by{" "}
                        {scoutName(replacement.created_by, profiles)} on{" "}
                        {at(replacement.created_at)}. Excluded from team
                        summaries.
                      </p>
                    )}
                    <dl className="scout-report-metrics">
                      {fields
                        .filter(([field]) =>
                          (report.kind === "match"
                            ? ["AUTO fuel", "TELEOP fuel", "Endgame climb"]
                            : [
                                "Drivetrain",
                                "Fuel capacity",
                                "Climb capability",
                              ]
                          ).includes(field),
                        )
                        .map(([field, value]) => (
                          <div key={field}>
                            <dt>{field}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                    </dl>
                    {report.kind === "pit" && (
                      <div className="scout-report-notes">
                        <h4>AUTO capabilities</h4>
                        <p className="scout-notes">
                          {String(
                            report.data.auto_notes || "No AUTO notes recorded.",
                          )}
                        </p>
                      </div>
                    )}
                    <div className="scout-report-notes">
                      <h4>
                        {report.kind === "pit" ? "Pit notes" : "Match notes"}
                      </h4>
                      <p className="scout-notes">
                        {String(report.data.notes || "No notes recorded.")}
                      </p>
                    </div>
                    <details className="scout-full-observation">
                      <summary>View full observation</summary>
                      <dl className="scout-observation-fields">
                        {fields.map(([field, value]) => (
                          <div key={field}>
                            <dt>{field}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                    {correctable && (
                      <button
                        type="button"
                        className="scout-correct"
                        onClick={() => correct(report)}
                      >
                        Correct this report
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
