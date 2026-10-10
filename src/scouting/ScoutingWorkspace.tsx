import { useState } from "react";
import { StatboticsComparison } from "../competition/StatboticsComparison";
import "../competition/live-display.css";
import type { Data, Profile } from "../model";
import type { Competition, EventMatch } from "../competition/service";
import { isStale } from "../competition/feed-state";
import type { PitScope } from "../pit-rpc";
import { useScouting } from "./service";
import {
  newScoutingId,
  type ScoutingDraftPayload,
  type StoredScoutingDraft,
} from "./storage";
import {
  choices,
  label,
  initialData,
  normalizeMatchKey,
  currentReports,
  summarize,
  reportsCsv,
  type Kind,
  type Payload,
  type Observation,
  type Summary,
  type Pick,
} from "./model";
import "./scouting.css";
import { optionLabel, fieldHelp, ratingLabel } from "./labels";
import { withEventTeams, type DirectorySummary } from "./directory";

type Props = {
  profile: Profile;
  data: Data;
  competition: Competition;
  demo: boolean;
  scope: PitScope;
  onAccessFailure: () => void;
};
const draftPayload = (d: ScoutingDraftPayload): ScoutingDraftPayload => ({
  id: d.id,
  event_id: d.event_id,
  kind: d.kind,
  team_number: d.team_number,
  match_key: d.match_key,
  data: d.data,
  supersedes_id: d.supersedes_id || null,
});
const fmt = (n: number | null, digits = 1) =>
  n === null ? "—" : n.toFixed(digits);
const percent = (n: number | null) =>
  n === null ? "—" : Math.round(n * 100) + "%";
const download = (name: string, text: string, type = "application/json") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function ScoutingWorkspace({
  profile,
  data,
  competition,
  demo,
  scope,
  onAccessFailure,
}: Props) {
  const active = data.events.find((e) => e.status === "active");
  const [eventId, setEventId] = useState(
    active?.id || data.events[0]?.id || "",
  );
  const event = data.events.find((e) => e.id === eventId);
  return (
    <div className="scouting">
      <label className="scout-event">
        Scouting event
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {!eventId && <option value="">Choose an event</option>}
          {data.events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.status === "active" ? " · Active" : ""}
            </option>
          ))}
        </select>
      </label>
      {event ? (
        <ScoutingEvent
          key={`${profile.id}:${eventId}:${demo}`}
          profile={profile}
          data={data}
          competition={competition}
          demo={demo}
          scope={scope}
          onAccessFailure={onAccessFailure}
          eventId={eventId}
          active={event.status === "active"}
        />
      ) : (
        <section className="card">
          <h2>Activate an event to scout</h2>
          <p>
            A mentor or admin can create the event in Event. Scouting does not
            need an official schedule.
          </p>
        </section>
      )}
    </div>
  );
}
function ScoutingEvent({
  profile,
  data,
  competition,
  demo,
  scope,
  onAccessFailure,
  eventId,
  active,
}: Props & { eventId: string; active: boolean }) {
  const s = useScouting(profile, eventId, demo, scope, onAccessFailure);
  const [tab, setTab] = useState("capture"),
    [draft, setDraft] = useState<StoredScoutingDraft | null>(null),
    [notice, setNotice] = useState(""),
    [submittedId, setSubmittedId] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [teamDetail, setTeamDetail] = useState<number | null>(null),
    [assignmentEdit, setAssignmentEdit] = useState<
      import("./model").Assignment | null
    >(null),
    [localError, setLocalError] = useState("");
  const reports = currentReports(s.context?.observations || []);
  const pending = s.outbox.filter((o) => o.status !== "synced");
  const newDraft = (kind: Kind, source?: Observation) => {
    setNotice("");
    setLocalError("");
    const p: ScoutingDraftPayload = {
      id: newScoutingId(),
      event_id: eventId,
      kind,
      team_number: source?.team_number || null,
      match_key: source?.match_key || null,
      data: source ? { ...source.data } : initialData(kind),
      supersedes_id: source?.id || null,
    };
    const saved = s.saveDraft(p);
    if (saved) {
      setDraft(saved);
      setTab("capture");
    }
  };
  const change = (p: ScoutingDraftPayload) => {
    if (!draft) return;
    const saved = s.saveDraft(draftPayload(p), draft.revision);
    if (saved) {
      setDraft(saved);
      setNotice("");
    }
  };
  const queue = () => {
    if (!draft) return;
    const saved = s.queue(
      { ...draftPayload(draft), team_number: draft.team_number! } as Payload,
      draft.id,
    );
    if (saved) {
      setDraft(null);
      setSubmittedId(saved.payload.id);
      setNotice("");
      void s.sync();
    }
  };
  const scheduleFeed =
    eventId === competition.context?.config?.event_id ? competition.feed : null;
  const summaries = withEventTeams(
    summarize(s.context?.observations || []),
    scheduleFeed?.eventTeams,
  );
  const filteredTeams = summaries.filter((x) =>
    `${x.team} ${x.name || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const rosterLoaded =
    Array.isArray(scheduleFeed?.eventTeams) && !!scheduleFeed?.teamsAt;
  const rosterStale =
    !s.online ||
    !!competition.feedError ||
    !!scheduleFeed?.teamsError ||
    isStale(scheduleFeed?.teamsAt, competition.tick);
  const wholeEvent = Array.isArray(scheduleFeed?.scoutingMatches);
  const schedule = scheduleFeed?.scoutingMatches ?? scheduleFeed?.matches ?? [];
  const scheduleStale =
    !s.online ||
    !!competition.feedError ||
    !!scheduleFeed?.tbaError ||
    isStale(scheduleFeed?.tbaAt, competition.tick);
  const practices =
    competition.context?.matches.filter(
      (m) => m.event_id === eventId && m.source === "manual" && !m.archived_at,
    ) || [];
  const manager = !!s.context?.can_manage;
  const submitted = s.outbox.find((o) => o.payload.id === submittedId);
  const exportBackup = () => {
    try {
      if (s.store)
        download(
          `impulse-scouting-device-${eventId}.json`,
          s.store.exportRecords(),
        );
    } catch (e) {
      setLocalError(String(e));
    }
  };
  return (
    <>
      <div className="scout-intro card">
        <div>
          <span className="eyebrow">IMPULSE · 2026 REBUILT</span>
          <h2>Know the field.</h2>
          <p>
            Capture observations, compare teams, and build your alliance
            picklist.
          </p>
        </div>
        <div className="scout-sync">
          <strong>
            {s.online ? "Online" : "Offline"} · {pending.length} awaiting sync
          </strong>
          <small>
            {demo
              ? "Local demo. Nothing is sent to the team."
              : s.updatedAt
                ? `Team data checked ${new Date(s.updatedAt).toLocaleTimeString()}`
                : "Team data has not loaded."}
          </small>
          <button
            className="primary"
            disabled={s.busy || !s.online || !pending.length || !s.canScout}
            onClick={() => void s.sync()}
          >
            {s.busy ? "Syncing…" : demo ? "Save demo reports" : "Sync reports"}
          </button>
        </div>
      </div>
      {(s.error || localError) && (
        <p className="error" role="alert">
          {s.error || localError}{" "}
          <button onClick={() => void s.refresh()}>Refresh scouting</button>
        </p>
      )}
      {s.storageIssues.length > 0 && (
        <p className="error" role="alert">
          Some device records could not be read. Do not clear browser storage.
          Export a device backup before troubleshooting.
        </p>
      )}
      {submitted && (
        <p
          className={
            submitted.status === "synced" ? "success-note" : "connection-stale"
          }
          role="status"
        >
          Team {submitted.payload.team_number} ·{" "}
          {submitted.status === "synced"
            ? demo
              ? "Saved in local demo."
              : "Synced to the team database."
            : submitted.status === "error"
              ? `Not yet confirmed by the team database. Saved on this device. ${submitted.lastError || "Use Sync reports to retry."}`
              : !s.online
                ? "Saved on this device. It will send when you reconnect."
                : "Sending to the team database…"}
        </p>
      )}
      {notice && (
        <p className="success-note" role="status">
          {notice}
        </p>
      )}
      {!active && (
        <p className="connection-stale">
          Historical event. Existing queued reports can retry, but new
          submissions require the active event.
        </p>
      )}
      <nav className="scout-tabs" aria-label="Scouting sections">
        {[
          ["capture", "Scout"],
          ["teams", "Teams"],
          ["compare", "Compare"],
          ["picklist", "Picklist"],
          ["coverage", "Assignments"],
          ["queue", `Device (${pending.length})`],
        ].map(([id, text]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {text}
          </button>
        ))}
      </nav>
      {tab === "capture" && (
        <>
          <div className="scout-toolbar">
            <button
              className="primary"
              disabled={!active || !s.canScout}
              onClick={() => newDraft("match")}
            >
              New match report
            </button>
            <button
              disabled={!active || !s.canScout}
              onClick={() => newDraft("pit")}
            >
              New pit report
            </button>
          </div>
          {!s.canScout && (
            <p>
              View-only account. Active scouts can collect and submit
              observations.
            </p>
          )}
          {draft ? (
            <ScoutForm
              draft={draft}
              change={change}
              queue={queue}
              close={() => setDraft(null)}
              schedule={schedule}
              practices={practices}
              wholeEvent={wholeEvent}
              scheduleStale={scheduleStale}
              scheduleAt={scheduleFeed?.tbaAt ?? null}
              refreshSchedule={() => void competition.refresh(true)}
              refreshingSchedule={competition.refreshing}
              disabled={!active || !s.canScout}
            />
          ) : (
            <section className="card scout-empty">
              <h3>One robot. One clear observation.</h3>
              <p>
                Start a match report before play, or record a team’s stated
                capabilities in the pit. Unobserved values stay unknown.
              </p>
              <p>
                Draft changes save on this device immediately. After reviewing,
                submit to send it to the team database.
              </p>
            </section>
          )}
          {s.drafts.length > 0 && (
            <section className="card">
              <h3>Unfinished drafts · this device</h3>
              {s.drafts.map((d) => (
                <div className="scout-record" key={d.id}>
                  <div>
                    <strong>
                      {d.kind === "match" ? "Match" : "Pit"} ·{" "}
                      {d.team_number
                        ? `Team ${d.team_number}`
                        : "Choose a team"}
                    </strong>
                    <small>
                      {String(d.data.match_label || "Pit capabilities")} · saved{" "}
                      {new Date(d.updatedAt).toLocaleString()}
                    </small>
                  </div>
                  <button
                    disabled={!active || !s.canScout}
                    onClick={() => {
                      setDraft(d);
                      setNotice("");
                    }}
                  >
                    Resume
                  </button>
                </div>
              ))}
            </section>
          )}
          <details className="card">
            <summary>Offline and shared-device notes</summary>
            <p>
              Keep this signed-in tab open before losing service. Drafts and
              queued reports survive a browser reload, but reopening the app or
              signing in still requires a connection. There is no offline
              cold-start mode.
            </p>
            <p>
              Only this account’s device records appear here. Sign-out hides
              them; it does not erase them. Browser storage is not encrypted and
              clearing site data removes unsynced work. Avoid personal details
              in notes. Export a device backup before changing devices.
            </p>
            <button onClick={exportBackup}>Export device backup</button>
          </details>
        </>
      )}
      {tab === "teams" && (
        <>
          <div className="scout-toolbar">
            <label>
              Find a team
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Team number or name"
              />
            </label>
            <button
              disabled={!reports.length}
              onClick={() =>
                download(
                  `impulse-scouting-${eventId}.csv`,
                  reportsCsv(reports),
                  "text/csv;charset=utf-8",
                )
              }
            >
              Export reports CSV
            </button>
            <button
              disabled={competition.refreshing}
              onClick={() => {
                void s.refresh();
                void competition.refresh(true);
              }}
            >
              Refresh team data
            </button>
          </div>
          <p
            className={
              rosterStale && rosterLoaded ? "connection-stale" : "scout-caveat"
            }
            role="status"
          >
            {rosterLoaded
              ? `${scheduleFeed!.eventTeams!.length} teams listed by TBA. ${rosterStale ? "Roster may be outdated; refresh when connected." : "Roster up to date."}`
              : competition.refreshing
                ? "Loading event teams from TBA…"
                : eventId !== competition.context?.config?.event_id
                  ? "No TBA roster is linked to this scouting event. Synced report teams still appear below."
                  : "Event roster unavailable. Refresh to retry; synced report teams still appear below."}
            {scheduleFeed?.teamsAt
              ? ` Last roster update ${new Date(scheduleFeed.teamsAt).toLocaleTimeString()}.`
              : ""}{" "}
            Team names and numbers come from TBA. Performance data comes only
            from our synced scouting reports.
          </p>
          <p className="scout-caveat">
            Observed fuel is not official points: inactive-hub fuel does not
            score. Averages weight each observed match equally, averaging
            multiple scouts within a match. Unknown values are excluded.
          </p>
          <div className="scout-team-grid">
            {filteredTeams.map((x) => (
              <TeamCard
                key={x.team}
                value={x}
                selected={selected.includes(x.team)}
                toggle={() =>
                  setSelected((v) =>
                    v.includes(x.team)
                      ? v.filter((t) => t !== x.team)
                      : v.length < 6
                        ? [...v, x.team]
                        : v,
                  )
                }
                detail={() => setTeamDetail(x.team)}
              />
            ))}
          </div>
          {!filteredTeams.length && (
            <section className="card">
              <h3>
                {summaries.length
                  ? "No teams match your search"
                  : "No event teams loaded yet"}
              </h3>
              <p>
                {summaries.length
                  ? "Try a team number or name."
                  : "Teams appear when TBA publishes the event roster or when a scouting report syncs. You can still enter any team number in Scout."}
              </p>
              <p>Device-only reports are excluded from shared team analysis.</p>
            </section>
          )}
          {teamDetail !== null && (
            <TeamDetail
              value={summaries.find((x) => x.team === teamDetail)}
              profile={profile}
              data={data}
              manager={manager}
              active={active}
              close={() => setTeamDetail(null)}
              correct={(o) => {
                newDraft(o.kind, o);
                setTeamDetail(null);
              }}
            />
          )}
        </>
      )}
      {tab === "compare" && (
        <>
          <section className="card">
            <h3>Compare up to six teams</h3>
            <p>
              Select teams below. Missing data stays blank; small samples are
              not predictions.
            </p>
            {schedule.find((m) => m.alliance && !m.completed && !m.actual) && (
              <button
                className="comp-compare-next"
                onClick={() => {
                  const match = schedule.find(
                    (m) => m.alliance && !m.completed && !m.actual,
                  );
                  if (match)
                    setSelected(
                      [
                        ...new Set([...match.red, ...match.blue].map(Number)),
                      ].slice(0, 6),
                    );
                }}
              >
                Compare next 4418 match
              </button>
            )}
            {!!schedule.length && (
              <label>
                Compare a scheduled match
                <select
                  aria-label="Compare a scheduled match"
                  value=""
                  onChange={(e) => {
                    const match = schedule.find(
                      (m) => m.key === e.target.value,
                    );
                    if (match)
                      setSelected(
                        [
                          ...new Set([...match.red, ...match.blue].map(Number)),
                        ].slice(0, 6),
                      );
                  }}
                >
                  <option value="">Choose a match</option>
                  {schedule.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label} · {m.red.join(", ")} / {m.blue.join(", ")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {scheduleStale && schedule.length > 0 && (
              <p className="comp-stale">
                Match lineups may be stale. Confirm with the field schedule.
              </p>
            )}
            <div className="scout-team-chips">
              {summaries.map((x) => (
                <button
                  key={x.team}
                  aria-pressed={selected.includes(x.team)}
                  className={selected.includes(x.team) ? "selected" : ""}
                  onClick={() =>
                    setSelected((v) =>
                      v.includes(x.team)
                        ? v.filter((n) => n !== x.team)
                        : v.length < 6
                          ? [...v, x.team]
                          : v,
                    )
                  }
                >
                  {x.team}
                </button>
              ))}
            </div>
          </section>
          <StatboticsComparison
            feed={scheduleFeed}
            teams={selected}
            now={competition.tick}
            unavailable={!s.online || !!competition.feedError}
          />
          {selected.length ? (
            <div className="scout-table-wrap">
              <table>
                <caption>Synced match observations</caption>
                <thead>
                  <tr>
                    <th>Metric</th>
                    {selected.map((n) => (
                      <th key={n}>{n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      "matches",
                      "reports",
                      "autoMatches",
                      "auto",
                      "teleopMatches",
                      "teleop",
                      "fuelMatches",
                      "fuel",
                      "climbRate",
                      "disabledRate",
                      "driver",
                      "defense",
                    ] as const
                  ).map((k) => (
                    <tr key={k}>
                      <th>
                        {
                          {
                            matches: "Matches",
                            reports: "Scout reports",
                            autoMatches: "AUTO samples",
                            teleopMatches: "TELEOP samples",
                            fuelMatches: "Total-fuel samples",
                            auto: "Avg AUTO fuel",
                            teleop: "Avg TELEOP fuel",
                            fuel: "Avg total fuel",
                            climbRate: "Endgame climb",
                            disabledRate: "Disabled / no-show",
                            driver: "Driver (1–5)",
                            defense: "Defense (1–5)",
                          }[k]
                        }
                      </th>
                      {selected.map((n) => {
                        const v =
                          summaries.find((t) => t.team === n)?.[k] ?? null;
                        return (
                          <td key={n}>
                            {k.endsWith("Rate")
                              ? percent(v)
                              : fmt(
                                  v,
                                  k === "matches" ||
                                    k === "reports" ||
                                    k.endsWith("Matches")
                                    ? 0
                                    : 1,
                                )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Select teams to compare.</p>
          )}
          <p>
            Endgame climb includes L1/L2/L3 success. Ratings are subjective.
            Fuel counts may be estimates; use match notes and sample size
            alongside averages.
          </p>
        </>
      )}
      {tab === "picklist" && (
        <Picklist
          entries={s.context?.picklist || []}
          summaries={summaries}
          canManage={
            manager && active && s.online && !s.busy && s.managementReady
          }
          save={(p) => s.manage("picklist", p)}
          active={active}
        />
      )}
      {tab === "coverage" && (
        <section className="card">
          <h3>Scouting coverage</h3>
          <p>
            Assign a robot and match to a scout. Completion means that assigned
            scout has synced a report, not merely saved it on a phone.
          </p>
          {manager && active && (
            <AssignmentForm
              key={assignmentEdit?.id || "new"}
              initial={assignmentEdit}
              cancel={() => setAssignmentEdit(null)}
              profiles={data.profiles}
              disabled={!s.online || s.busy || !s.managementReady}
              save={async (p) => {
                const ok = await s.manage("assignment", p);
                if (ok) setAssignmentEdit(null);
                return ok;
              }}
            />
          )}
          <div className="scout-record-list">
            {(s.context?.assignments || []).map((a) => {
              const complete = reports.some(
                (o) =>
                  o.kind === a.kind &&
                  o.team_number === a.team_number &&
                  o.match_key === a.match_key &&
                  ((o as Observation & { scout_id?: string }).scout_id ||
                    o.created_by) === a.assignee_id,
              );
              return (
                <div className="scout-record" key={a.id}>
                  <div>
                    <strong>
                      Team {a.team_number} ·{" "}
                      {a.kind === "pit" ? "Pit" : a.match_key}
                    </strong>
                    <small>
                      {data.profiles.find((p) => p.id === a.assignee_id)
                        ?.display_name || "Unassigned"}{" "}
                      · {complete ? "Submitted" : "Awaiting report"}
                    </small>
                  </div>
                  <span
                    className={"badge " + (complete ? "success" : "warning")}
                  >
                    {complete ? "Covered" : "Open"}
                  </span>
                  {manager && active && (
                    <button
                      disabled={!s.online || s.busy || !s.managementReady}
                      onClick={() => setAssignmentEdit(a)}
                    >
                      Edit assignment
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!s.context?.assignments.length && (
            <p>No assignments yet. Leadership can add one above.</p>
          )}
        </section>
      )}
      {tab === "queue" && (
        <section className="card">
          <h3>This device’s scouting</h3>
          <p>
            Submitted reports send automatically while connected. Queued and
            failed reports are safe to retry: each retains its original ID.
            “Synced” requires a server acknowledgment. Drafts are never uploaded
            automatically.
          </p>
          <div className="scout-toolbar">
            <button onClick={exportBackup}>Export device backup</button>
            <label className="scout-file">
              Restore this account’s backup
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !s.store) return;
                  try {
                    if (file.size > 5000000)
                      throw new Error("Backup exceeds 5 MB.");
                    const result = s.store.importRecords(await file.text());
                    s.changed();
                    void s.sync();
                    setNotice(
                      `Restored ${result.drafts} drafts and ${result.reports} reports. Restored submissions will send when connected.`,
                    );
                  } catch (err) {
                    setLocalError(
                      err instanceof Error ? err.message : String(err),
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {s.outbox.map((o) => (
            <div className="scout-record" key={o.payload.id}>
              <div>
                <strong>
                  Team {o.payload.team_number} ·{" "}
                  {o.payload.kind === "pit"
                    ? "Pit"
                    : String(o.payload.data.match_label || o.payload.match_key)}
                </strong>
                <small>
                  {o.status === "synced"
                    ? demo
                      ? "Saved in local demo"
                      : "Synced to team"
                    : o.status === "syncing"
                      ? "Sync in progress or interrupted. Retry is duplicate-safe."
                      : o.status === "error"
                        ? "Sync not confirmed; retained on this device"
                        : "Saved on this device; awaiting cloud sync"}
                </small>
                {o.lastError && <p className="error">{o.lastError}</p>}
                <small>Report ID: {o.payload.id}</small>
              </div>
              <span
                className={
                  "badge " + (o.status === "synced" ? "success" : "warning")
                }
              >
                {o.status}
              </span>
            </div>
          ))}
          {!s.outbox.length && (
            <p>No queued reports on this account and event.</p>
          )}
        </section>
      )}
    </>
  );
}
function ScoutForm({
  draft,
  change,
  queue,
  close,
  schedule,
  practices,
  wholeEvent,
  scheduleStale,
  scheduleAt,
  refreshSchedule,
  refreshingSchedule,
  disabled,
}: {
  draft: StoredScoutingDraft;
  change: (d: ScoutingDraftPayload) => void;
  queue: () => void;
  close: () => void;
  schedule: EventMatch[];
  practices: NonNullable<Competition["context"]>["matches"];
  wholeEvent: boolean;
  scheduleStale: boolean;
  scheduleAt: number | null;
  refreshSchedule: () => void;
  refreshingSchedule: boolean;
  disabled: boolean;
}) {
  const d = draft.data;
  const set = (key: string, value: unknown) =>
    change({ ...draft, data: { ...d, [key]: value } });
  const select = (key: keyof typeof choices, title: string) => (
    <div>
      <label>
        {title}
        <select
          aria-describedby={fieldHelp[key] ? `scout-help-${key}` : undefined}
          value={String(d[key] ?? "unknown")}
          onChange={(e) => set(key, e.target.value)}
        >
          {choices[key].map((v) => (
            <option key={v} value={v}>
              {optionLabel(key, v)}
            </option>
          ))}
        </select>
      </label>
      {fieldHelp[key] && (
        <small id={`scout-help-${key}`}>
          {draft.kind === "pit" && key === "traversal"
            ? "Which routes the team says its robot can use. None means neither route."
            : draft.kind === "pit" && key === "intake"
              ? "Where the team says its robot can collect fuel. Neither means no intake capability."
              : fieldHelp[key]}
        </small>
      )}
    </div>
  );
  const rating = (key: string, title: string) => (
    <div>
      <label>
        {title}
        <select
          aria-describedby={`scout-help-${key}`}
          value={d[key] === null ? "" : String(d[key])}
          onChange={(e) =>
            set(key, e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">Not rated</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {ratingLabel(key, n)}
            </option>
          ))}
        </select>
      </label>
      <small id={`scout-help-${key}`}>
        {key === "defense"
          ? "Leave unrated if it did not play defense or you could not judge its impact."
          : "Rate only if you saw enough driving. Unrated is excluded from the average."}
      </small>
    </div>
  );
  const count = (key: string, title: string) => (
    <div className="scout-counter">
      <strong>{title}</strong>
      <div>
        <button
          type="button"
          aria-label={`Decrease ${title}`}
          disabled={d[key] === null || Number(d[key]) <= 0}
          onClick={() => set(key, Math.max(0, Number(d[key]) - 1))}
        >
          −
        </button>
        <label>
          <span className="sr-only">{title}</span>
          <input
            inputMode="numeric"
            type="number"
            min="0"
            max="999"
            value={d[key] === null ? "" : String(d[key])}
            placeholder="—"
            onChange={(e) =>
              set(key, e.target.value === "" ? null : Number(e.target.value))
            }
          />
        </label>
        <button
          type="button"
          aria-label={`Increase ${title}`}
          onClick={() => set(key, Math.min(999, Number(d[key] || 0) + 1))}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => set(key, Math.min(999, Number(d[key] || 0) + 5))}
        >
          +5
        </button>
      </div>
      <div>
        <button
          type="button"
          className="scout-text-button"
          onClick={() => set(key, 0)}
        >
          Set 0 fuel
        </button>
        <button
          type="button"
          className="scout-text-button"
          onClick={() => set(key, null)}
        >
          Couldn’t count
        </button>
      </div>
      <small>
        {d[key] === null
          ? "No count recorded. Leave blank if you missed the action."
          : "Fuel count recorded."}{" "}
        Use 0 only if you watched and saw no fuel go in.
      </small>
    </div>
  );
  return (
    <section className="card scout-form">
      <div className="scout-toolbar">
        <h3>
          {draft.supersedes_id
            ? "Correct report"
            : draft.kind === "match"
              ? "Match observation"
              : "Pit capabilities"}
        </h3>
        <span className="badge success">Draft saved on device</span>
        <button type="button" onClick={close}>
          Close draft
        </button>
      </div>
      <small>
        Saved {new Date(draft.updatedAt).toLocaleTimeString()} ·{" "}
        {draft.kind === "pit"
          ? "Record what the team tells you; these are not observed match results."
          : "Record fuel entering the hub, including estimates. These are not official points."}
      </small>
      <p className="scout-caveat">
        Blank or unknown means you haven’t recorded an answer or couldn’t tell.
        It does not mean zero, no attempt, or a poor rating.
      </p>
      <fieldset disabled={disabled}>
        <div className="scout-form-grid">
          <label>
            Team number
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="99999"
              readOnly={!!draft.supersedes_id}
              value={draft.team_number ?? ""}
              onChange={(e) =>
                change({
                  ...draft,
                  team_number: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          {draft.kind === "match" && (
            <>
              <div>
                <label>
                  Choose a loaded match
                  <select
                    aria-describedby="scout-schedule-status"
                    disabled={!!draft.supersedes_id}
                    value=""
                    onChange={(e) => {
                      const m = schedule.find((m) => m.key === e.target.value);
                      const p = practices.find(
                        (m) => m.match_key === e.target.value,
                      );
                      if (m || p)
                        change({
                          ...draft,
                          match_key: normalizeMatchKey(e.target.value),
                          data: {
                            ...d,
                            match_label:
                              m?.label || p?.manual_label || e.target.value,
                          },
                        });
                    }}
                  >
                    <option value="">Manual entry / select…</option>
                    {schedule.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label} · Red {m.red.join("/")} vs Blue{" "}
                        {m.blue.join("/")}
                      </option>
                    ))}
                    {practices.map((m) => (
                      <option key={m.id} value={m.match_key}>
                        {m.manual_label} · Practice
                      </option>
                    ))}
                  </select>
                </label>
                <small id="scout-schedule-status">
                  {wholeEvent
                    ? "All event matches from TBA, plus saved practices."
                    : "Limited schedule: only the pit team’s matches are loaded, plus saved practices."}
                  {scheduleStale
                    ? " Last loaded schedule may be stale."
                    : " Updates from TBA can take about a minute."}
                  {scheduleAt
                    ? ` Last snapshot ${new Date(scheduleAt).toLocaleTimeString()}.`
                    : " No TBA schedule has loaded yet."}{" "}
                  Select the team you are watching separately. You can also
                  enter a match below.
                </small>
                <button
                  type="button"
                  disabled={refreshingSchedule}
                  onClick={refreshSchedule}
                >
                  {refreshingSchedule
                    ? "Refreshing matches…"
                    : "Refresh matches"}
                </button>
              </div>
              <label>
                Match ID
                <input
                  readOnly={!!draft.supersedes_id}
                  value={draft.match_key || ""}
                  maxLength={100}
                  placeholder="qm17 or p1"
                  onChange={(e) =>
                    change({
                      ...draft,
                      match_key: normalizeMatchKey(e.target.value),
                      data: {
                        ...d,
                        match_label: d.match_label || e.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                Match label
                <input
                  value={String(d.match_label)}
                  maxLength={100}
                  placeholder="Qualification 17"
                  onChange={(e) => set("match_label", e.target.value)}
                />
              </label>
              {select("alliance", "Alliance")}
              <label>
                Station
                <select
                  value={d.station === null ? "" : String(d.station)}
                  onChange={(e) =>
                    set(
                      "station",
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                >
                  <option value="">Choose station (if known)</option>
                  {[1, 2, 3].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        {draft.kind === "match" ? (
          <>
            <h4>AUTO</h4>
            <div className="scout-form-grid">
              {count("auto_fuel", "AUTO fuel")}
              {select("start_position", "Starting position")}
              {select("auto_climb", "AUTO climb")}
            </div>
            <h4>TELEOP & endgame</h4>
            <div className="scout-form-grid">
              {count("teleop_fuel", "TELEOP fuel")}
              {select("endgame", "Endgame climb")}
              {select("accuracy", "Estimated shooting accuracy")}
              {select("role", "Primary role")}
              {rating("driver", "Driver ability · 1–5")}
              {rating("defense", "Defense effectiveness · 1–5")}
            </div>
            <div className="scout-checks">
              <label>
                <input
                  type="checkbox"
                  checked={!!d.disabled}
                  onChange={(e) => set("disabled", e.target.checked)}
                />
                Disabled / broke down during match
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!d.no_show}
                  onChange={(e) => set("no_show", e.target.checked)}
                />
                Robot did not play
              </label>
            </div>
          </>
        ) : (
          <div className="scout-form-grid">
            {select("drive", "Drivetrain")}
            <label>
              Hopper capacity · fuel
              <input
                type="number"
                min="0"
                max="200"
                inputMode="numeric"
                placeholder="Unknown"
                value={d.capacity === null ? "" : String(d.capacity)}
                onChange={(e) =>
                  set(
                    "capacity",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </label>
            {select("climb", "Claimed highest climb")}
          </div>
        )}
        <h4>
          {draft.kind === "match"
            ? "Observed capabilities"
            : "Team-reported capabilities"}
        </h4>
        <div className="scout-form-grid">
          {select("intake", "Intake source")}
          {select("traversal", "Field traversal")}
        </div>
        {draft.kind === "pit" && (
          <label>
            AUTO routes and capabilities
            <textarea
              rows={3}
              maxLength={2000}
              value={String(d.auto_notes)}
              onChange={(e) => set("auto_notes", e.target.value)}
              placeholder="Starting position, preload, routes, climb…"
            />
          </label>
        )}
        <label>
          {draft.kind === "match"
            ? "Match notes / breakdown detail"
            : "Strengths, limitations, and strategy notes"}
          <textarea
            rows={3}
            maxLength={2000}
            value={String(d.notes)}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Robot observations only. Avoid personal details."
          />
        </label>
        <div className="scout-review">
          <strong>
            Review: Team {draft.team_number || "?"} ·{" "}
            {draft.kind === "pit" ? "Pit" : String(d.match_label || "?")}
          </strong>
          <p>
            {draft.kind === "match"
              ? `AUTO ${d.auto_fuel ?? "unknown"} fuel · TELEOP ${d.teleop_fuel ?? "unknown"} fuel · Endgame ${optionLabel("endgame", String(d.endgame))}`
              : "Team-reported pit capabilities. Unknown values remain blank."}
          </p>
          <button type="button" className="primary" onClick={queue}>
            Submit report
          </button>
          <small>
            Sends to the team database now, or automatically after reconnecting.
            Submitted corrections preserve the original history.
          </small>
        </div>
      </fieldset>
    </section>
  );
}
function TeamCard({
  value: s,
  selected,
  toggle,
  detail,
}: {
  value: DirectorySummary;
  selected: boolean;
  toggle: () => void;
  detail: () => void;
}) {
  return (
    <section className="card scout-team">
      <div className="scout-toolbar">
        <h3>Team {s.team}</h3>
        <span className="badge neutral">
          {s.matches} matches · {s.reports} reports
        </span>
      </div>
      {s.name && <p className="scout-team-name">{s.name}</p>}
      {!s.observations.length && (
        <p className="scout-caveat">
          <strong>Not scouted yet</strong> · No synced match or pit reports.
        </p>
      )}
      <div className="scout-metrics">
        <div>
          <strong>{fmt(s.fuel)}</strong>
          <small>Avg observed fuel · n={s.fuelMatches}</small>
        </div>
        <div>
          <strong>{percent(s.climbRate)}</strong>
          <small>Endgame climb</small>
        </div>
        <div>
          <strong>{percent(s.disabledRate)}</strong>
          <small>Disabled / no-show</small>
        </div>
      </div>
      <p>
        Driver {fmt(s.driver)} · Defense {fmt(s.defense)} ·{" "}
        {s.pit ? "Pit report available" : "No pit report"}
      </p>
      <div className="scout-toolbar">
        <button onClick={detail}>Reports & notes</button>
        <button aria-pressed={selected} onClick={toggle}>
          {selected ? "Selected" : "Compare"}
        </button>
      </div>
    </section>
  );
}
function TeamDetail({
  value,
  profile,
  data,
  manager,
  active,
  close,
  correct,
}: {
  value: Summary | undefined;
  profile: Profile;
  data: Data;
  manager: boolean;
  active: boolean;
  close: () => void;
  correct: (o: Observation) => void;
}) {
  if (!value) return null;
  return (
    <section className="card scout-detail">
      <div className="scout-toolbar">
        <h3>Team {value.team} · reports & notes</h3>
        <button onClick={close}>Close reports</button>
      </div>
      {!value.observations.length && (
        <p>Not scouted yet. Synced match and pit reports will appear here.</p>
      )}
      {value.observations
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((o) => (
          <article key={o.id} className="scout-report">
            <strong>
              {o.kind === "pit"
                ? "Pit interview"
                : String(o.data.match_label || o.match_key)}
            </strong>
            <small>
              {new Date(o.created_at).toLocaleString()} ·{" "}
              {data.profiles.find((p) => p.id === o.created_by)?.display_name ||
                "Team scout"}
            </small>
            <p>
              {o.kind === "match"
                ? `AUTO ${o.data.auto_fuel ?? "unobserved"} · TELEOP ${o.data.teleop_fuel ?? "unobserved"} fuel · ${label(String(o.data.endgame))}`
                : `${label(String(o.data.drive))} · Capacity ${o.data.capacity ?? "unknown"} · Climb ${label(String(o.data.climb))}`}
            </p>
            <p>{String(o.data.auto_notes || "")}</p>
            <p className="scout-notes">{String(o.data.notes || "No notes.")}</p>
            {active &&
              profile.active &&
              ["student", "lead", "mentor", "admin"].includes(profile.role) &&
              (manager ||
                ((o as Observation & { scout_id?: string }).scout_id ||
                  o.created_by) === profile.id) && (
                <button onClick={() => correct(o)}>Correct this report</button>
              )}
          </article>
        ))}
    </section>
  );
}
function Picklist({
  entries,
  summaries,
  canManage,
  save,
  active,
}: {
  entries: Pick[];
  summaries: Summary[];
  canManage: boolean;
  save: (p: Record<string, unknown>) => Promise<boolean>;
  active: boolean;
}) {
  const [editing, setEditing] = useState<Pick | null>(null),
    [revision, setRevision] = useState(0);
  return (
    <section className="card">
      <h3>Shared alliance picklist</h3>
      <p>
        Leadership sets a deliberate order and notes. Scout averages support the
        discussion; they do not predict alliance scores. Everyone sees the same
        saved list.
      </p>
      {canManage && (
        <form
          key={`${editing?.id || "new"}:${revision}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await save({
              id: editing?.id,
              version: editing?.version || 0,
              team_number: Number(f.get("team")),
              rank: Number(f.get("rank")),
              status: f.get("status"),
              notes: f.get("notes"),
            });
            if (ok) {
              setEditing(null);
              setRevision((x) => x + 1);
            }
          }}
        >
          <div className="scout-form-grid">
            <label>
              Pick team
              <input
                name="team"
                readOnly={!!editing}
                type="number"
                min="1"
                max="99999"
                required
                defaultValue={editing?.team_number || ""}
              />
            </label>
            <label>
              Rank
              <input
                name="rank"
                type="number"
                min="1"
                max="999"
                required
                defaultValue={editing?.rank || entries.length + 1}
              />
            </label>
            <label>
              Availability
              <select
                name="status"
                defaultValue={editing?.status || "available"}
              >
                <option value="available">Available</option>
                <option value="picked">Picked / unavailable</option>
                <option value="avoid">Avoid</option>
              </select>
            </label>
          </div>
          <label>
            Picklist notes
            <textarea
              name="notes"
              maxLength={2000}
              defaultValue={editing?.notes || ""}
            />
          </label>
          <div className="scout-toolbar">
            <button className="primary">
              {editing ? "Update pick" : "Add team to picklist"}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(null)}>
                Cancel edit
              </button>
            )}
          </div>
        </form>
      )}
      {!canManage && (
        <p>
          {active
            ? "Leadership can edit while connected."
            : "Historical picklist."}
        </p>
      )}
      <ol className="scout-picks">
        {entries
          .slice()
          .sort((a, b) => a.rank - b.rank || a.team_number - b.team_number)
          .map((p) => {
            const stats = summaries.find((s) => s.team === p.team_number);
            return (
              <li key={p.id}>
                <div>
                  <strong>
                    #{p.rank} · Team {p.team_number}
                  </strong>
                  <span
                    className={
                      "badge " +
                      (p.status === "available" ? "success" : "neutral")
                    }
                  >
                    {p.status}
                  </span>
                  <small>
                    {stats
                      ? `${stats.matches} observed matches · ${fmt(stats.fuel)} avg fuel`
                      : "No synced match observations"}
                  </small>
                  <p className="scout-notes">{p.notes}</p>
                </div>
                {canManage && (
                  <button onClick={() => setEditing(p)}>
                    Edit team {p.team_number}
                  </button>
                )}
              </li>
            );
          })}
      </ol>
      {!entries.length && <p>No teams ranked yet.</p>}
    </section>
  );
}
function AssignmentForm({
  profiles,
  disabled,
  save,
  initial,
  cancel,
}: {
  profiles: Profile[];
  disabled: boolean;
  save: (p: Record<string, unknown>) => Promise<boolean>;
  initial: import("./model").Assignment | null;
  cancel: () => void;
}) {
  const [kind, setKind] = useState<Kind>(initial?.kind || "match");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          f = new FormData(form);
        if (
          await save({
            id: initial?.id,
            kind,
            team_number: Number(f.get("team")),
            match_key:
              kind === "match"
                ? normalizeMatchKey(String(f.get("match")))
                : null,
            assignee_id: f.get("assignee") || null,
            version: initial?.version || 0,
            notes: initial?.notes || "",
          })
        )
          form.reset();
      }}
    >
      <fieldset disabled={disabled}>
        <div className="scout-form-grid">
          <label>
            Report type
            <select
              disabled={!!initial}
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              <option value="match">Match</option>
              <option value="pit">Pit</option>
            </select>
          </label>
          <label>
            Assigned team
            <input
              name="team"
              readOnly={!!initial}
              type="number"
              min="1"
              max="99999"
              required
              defaultValue={initial?.team_number || ""}
            />
          </label>
          {kind === "match" && (
            <label>
              Assigned match ID
              <input
                name="match"
                readOnly={!!initial}
                placeholder="qm17"
                maxLength={100}
                required
                defaultValue={initial?.match_key || ""}
              />
            </label>
          )}
          <label>
            Scout
            <select
              name="assignee"
              required={!initial}
              defaultValue={initial?.assignee_id || ""}
            >
              <option value="">
                {initial ? "Unassigned" : "Choose teammate"}
              </option>
              {profiles
                .filter(
                  (p) =>
                    p.active &&
                    ["student", "lead", "mentor", "admin"].includes(p.role),
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="scout-toolbar">
          <button className="primary">
            {initial ? "Update assignment" : "Assign scout"}
          </button>
          {initial && (
            <button type="button" onClick={cancel}>
              Cancel assignment edit
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
