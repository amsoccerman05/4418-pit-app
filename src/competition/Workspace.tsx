import { competitionReadiness } from "./readiness";
import { CompetitionDashboard } from "./Dashboard";
import { useEffect, useRef, useState } from "react";
import { isStale } from "./feed-state";
import {
  canManage,
  canWork,
  issueOwner,
  type Data,
  type Profile,
} from "../model";
import {
  liveFor,
  nextMatch,
  type Competition,
  type Context,
  type Match,
  type Ops,
  type Template,
  type TemplateItem,
} from "./service";
import "./competition.css";
import { manualMatches, nextPracticeLabel, practiceLabel } from "./manual";
import { PracticeEditor, PracticeControls } from "./ManualPractice";
import { CrewQuickStart } from "./CrewQuickStart";
const when = (n: number | string | null | undefined) =>
  n
    ? new Date(n).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Not published";
const blank: TemplateItem = {
  text: "",
  required: true,
  blocking: false,
  area_id: null,
};
type Props = {
  page: string;
  competition: Competition;
  data: Data;
  profile: Profile;
  dataUpdatedAt: number | null;
  dataError: string;
  report: (id?: string) => void;
  openIssue: (id: string) => void;
  batteryAction: (id: string) => void;
  go: (page: any) => void;
};
export function CompetitionWorkspace({
  page,
  competition: c,
  data,
  profile,
  dataUpdatedAt,
  dataError,
  report,
  openIssue,
  batteryAction,
  go,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<Partial<Template> | null>(null),
    [filter, setFilter] = useState("all"),
    [addingPractice, setAddingPractice] = useState<string | null>(null);
  const practiceGeneration = useRef(0);
  const addPractice = (value: string | null) => {
    practiceGeneration.current++;
    setAddingPractice(value);
  };
  const editVersion = useRef(0);
  const editTemplate = (value: Partial<Template> | null) => {
    editVersion.current++;
    setEditing(value);
  };
  const d = c.context,
    event = data.events.find((e) => e.status === "active"),
    feed = c.feed;
  useEffect(() => {
    setSelected(null);
    editTemplate(null);
    addPractice(null);
  }, [event?.id, d?.config?.version, d?.config?.team_number]);
  useEffect(() => {
    if (page !== "matches") addPractice(null);
  }, [page]);
  if (!d)
    return (
      <section className="card competition">
        <p role={c.error ? "alert" : "status"}>
          {c.error || "Loading competition operations…"}
        </p>
        <button onClick={() => void c.refresh(true)}>Refresh</button>
      </section>
    );
  const external = feed?.configured ? feed.matches : [],
    next = nextMatch(external),
    ops = selected
      ? d.matches.find((m) => m.match_key === selected)
      : undefined,
    match = external.find((m) => m.key === selected);
  const act = (
    action: string,
    p: Record<string, unknown>,
    done?: (id: string) => void,
  ) =>
    void c
      .run(action, p)
      .then((id) => done?.(id))
      .catch(() => {});
  const open = (key: string) => {
    addPractice(null);
    setSelected(key);
    go("matches");
  };
  const state = competitionReadiness(d, data, external);
  const practice = ops?.source === "manual";
  const completed = practice ? !!ops.finished_at : !!match?.completed;
  const practices = manualMatches(d.matches, true);
  const canAddPractice = !!(d.can_manage && event && d.manual_matches_enabled);
  const addNextPractice = () => {
    if (!canAddPractice || c.busy || c.readOnly) return;
    setSelected(null);
    addPractice(nextPracticeLabel(d.matches));
    go("matches");
  };
  const announcements = c.liveAvailable ? feed?.nexus?.announcements : [];
  const live = (m: Match) =>
    c.liveAvailable ? liveFor(m, feed?.nexus?.matches || []) : null;
  const matchCard = (m: Match) => {
    const n = live(m);
    return (
      <>
        <div className="comp-match-title">
          <strong>{m.label}</strong>
          <span
            className={"badge " + (m.alliance === "red" ? "danger" : "info")}
          >
            {m.alliance.toUpperCase()}
          </span>
          <span>
            {m.completed
              ? "Completed"
              : m.actual
                ? "In progress / awaiting score"
                : m.key === next?.key
                  ? "Next"
                  : "Upcoming"}
          </span>
        </div>
        <p>
          <strong>{m[m.alliance].join(" · ")}</strong> vs{" "}
          {m[m.alliance === "red" ? "blue" : "red"].join(" · ")}
        </p>
        <p>
          Scheduled {when(m.scheduled)}
          {n?.estimated
            ? ` · Nexus estimate ${when(n.estimated)}`
            : m.predicted
              ? ` · TBA estimate ${when(m.predicted)}`
              : ""}
        </p>
        {n && (
          <p>
            <strong>{n.status}</strong>
            {n.queue ? ` · Queue ${when(n.queue)}` : ""}
          </p>
        )}
        {m.completed && (
          <p>
            Red {m.redScore} — Blue {m.blueScore} ·{" "}
            {m.winner ? m.winner.toUpperCase() + " wins" : "Tie"}
          </p>
        )}
      </>
    );
  };
  return (
    <div className="competition">
      {c.error && (
        <p role="alert" className="error">
          {c.error}{" "}
          <button disabled={c.refreshing} onClick={() => void c.refresh(true)}>
            Retry competition data
          </button>
        </p>
      )}
      {c.readOnly && (
        <p className="connection-stale" role="status">
          Competition snapshot is read-only. Last loaded checklists:{" "}
          {c.contextAt ? new Date(c.contextAt).toLocaleString() : "Not loaded"}.
          Refresh before making changes.
        </p>
      )}
      {page === "dashboard" && canAddPractice && (
        <div className="comp-inline">
          <button disabled={c.busy || c.readOnly} onClick={addNextPractice}>
            Add next practice
          </button>
          <small>Review the label, then start fresh checklists.</small>
        </div>
      )}
      {page === "dashboard" && (
        <CrewQuickStart
          d={d}
          data={data}
          profile={profile}
          readOnly={c.readOnly}
          scheduleStale={
            !c.online ||
            !!c.feedError ||
            !!feed?.tbaError ||
            isStale(feed?.tbaAt, c.tick)
          }
          next={state.next}
          open={open}
          go={(target) => {
            if (target === "matches") {
              addPractice(null);
              setSelected(null);
            }
            go(target);
          }}
          report={() => report()}
        />
      )}
      {["dashboard", "matches", "admin"].includes(page) && (
        <div className="comp-feed">
          <span>
            {feed?.eventName || event?.name || "No active event"}
            {d.config && ` · Team ${d.config.team_number}`}
          </span>
          <button disabled={c.refreshing} onClick={() => void c.refresh(true)}>
            {c.refreshing ? "Refreshing schedule…" : "Refresh schedule"}
          </button>
          {d.config && (
            <small>
              {!feed
                ? c.feedError
                  ? "Schedule unavailable. Retry to load it."
                  : !c.online
                    ? "Offline. No schedule loaded in this tab."
                    : "Loading external schedule…"
                : !c.online ||
                    c.feedError ||
                    feed.tbaError ||
                    isStale(feed.tbaAt, c.tick)
                  ? "Last loaded schedule may be stale"
                  : `TBA checked ${when(feed.tbaAt)}`}
              {feed?.tbaAt &&
                ` · Last TBA snapshot ${new Date(feed.tbaAt).toLocaleString()}`}{" "}
              ·{" "}
              {c.liveAvailable
                ? "Nexus live"
                : "Live timing unavailable — using TBA schedule"}
              {!c.liveAvailable && feed?.nexus?.asOf
                ? ` (last Nexus snapshot ${when(feed.nexus.asOf)})`
                : ""}
            </small>
          )}
        </div>
      )}
      {!d.config && ["dashboard", "matches"].includes(page) && (
        <section className="card">
          <h2>
            {event ? "Official schedule (optional)" : "Activate your event"}
          </h2>
          <p>
            Manual practice matches need only an active Pit event. Add them in
            Matches. Connect TBA and Nexus in Event when an official schedule is
            available.
          </p>
          <button onClick={() => go("admin")}>Event settings</button>
        </section>
      )}
      {page === "dashboard" && (d.config || practices.length > 0) && (
        <CompetitionDashboard
          c={c}
          d={d}
          data={data}
          profile={profile}
          state={state}
          dataUpdatedAt={dataUpdatedAt}
          dataError={dataError}
          open={open}
          openIssue={openIssue}
          batteryAction={batteryAction}
          go={go}
          report={() => report()}
        />
      )}
      {page === "admin" && c.liveAvailable && (
        <section className="card">
          <h2>Live event</h2>
          <p>Now queuing: {feed?.nexus?.nowQueuing || "Not published"}</p>
          {feed?.nexus?.matches
            .filter((m) => !m.committed && m.status !== "Queuing soon")
            .map((m) => (
              <p key={m.label}>
                {m.label} · {m.status} · estimate {when(m.estimated)}
              </p>
            ))}
          {announcements?.map(
            (a: { id: string; text: string; at: number | null }) => (
              <p key={a.id}>
                <strong>{when(a.at)}</strong> {a.text}
              </p>
            ),
          )}
          <small>
            Nexus labels are shown as supplied; ambiguous playoff/replay matches
            are not merged into a TBA match.
          </small>
        </section>
      )}
      {page === "matches" && !selected && (
        <>
          <label>
            Show matches
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="upcoming">Upcoming</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <section
            className="comp-manual-list"
            aria-label="Manual practice matches"
          >
            <div className="comp-feed">
              <h2>Manual practice</h2>
              {canAddPractice && (
                <div className="comp-inline">
                  <button
                    disabled={c.busy || c.readOnly}
                    onClick={() => addPractice("")}
                  >
                    Add practice match
                  </button>
                  {practices.length > 0 && (
                    <button
                      disabled={c.busy || c.readOnly}
                      onClick={addNextPractice}
                    >
                      Add next practice
                    </button>
                  )}
                </div>
              )}
            </div>
            {!event && (
              <p>
                Activate a Pit event in Event before adding practice matches.
              </p>
            )}
            {event && !d.manual_matches_enabled && (
              <p>Manual practice is not enabled on this server yet.</p>
            )}
            <p>
              Practice matches are saved by the pit crew. Open practices stay
              the preparation target until finished or archived.
            </p>
            {addingPractice !== null && event && (
              <PracticeEditor
                key={practiceGeneration.current}
                initialLabel={addingPractice}
                eventId={event.id}
                d={d}
                busy={c.busy || c.readOnly}
                cancel={() => addPractice(null)}
                save={(p) => {
                  const generation = practiceGeneration.current;
                  act("manual_match", p, (id) => {
                    if (generation === practiceGeneration.current) {
                      addPractice(null);
                      setSelected(`manual:${id}`);
                    }
                  });
                }}
              />
            )}
            {practices
              .filter((m) =>
                filter === "archived"
                  ? m.archived
                  : !m.archived &&
                    (filter === "all" ||
                      (filter === "completed" ? m.completed : !m.completed)),
              )
              .map((m) => (
                <button
                  className="card comp-row"
                  key={m.key}
                  onClick={() => open(m.key)}
                >
                  <div className="comp-match-title">
                    <strong>{m.label}</strong>
                    <span className="badge info">Manual</span>
                    <span>
                      {m.archived
                        ? "Archived"
                        : m.completed
                          ? "Finished"
                          : "Upcoming"}
                    </span>
                  </div>
                  <p>
                    {m.scheduled
                      ? `Scheduled ${new Date(m.scheduled).toLocaleString()}`
                      : "No scheduled start time"}
                  </p>
                </button>
              ))}
            {!practices.length && <p>No manual practices yet.</p>}
          </section>
          {filter !== "archived" && <h2>Official matches · TBA</h2>}
          {external
            .filter(
              (m) =>
                filter !== "archived" &&
                (filter === "all" ||
                  (filter === "completed" ? m.completed : !m.completed)),
            )
            .map((m) => (
              <button
                className="card comp-row"
                key={m.key}
                onClick={() => open(m.key)}
              >
                {matchCard(m)}
              </button>
            ))}
          {!external.length && filter !== "archived" && (
            <p>No TBA schedule loaded. Existing operations remain below.</p>
          )}
          {d.matches
            .filter(
              (o) =>
                o.source !== "manual" &&
                filter !== "archived" &&
                !external.some((m) => m.key === o.match_key),
            )
            .map((o) => (
              <button key={o.id} onClick={() => open(o.match_key)}>
                {o.match_key} · saved operations
              </button>
            ))}
        </>
      )}
      {page === "matches" && selected && (
        <>
          <button
            onClick={() => {
              addPractice(null);
              setSelected(null);
            }}
          >
            ← All matches
          </button>
          <section className="card">
            <h2>{practice ? practiceLabel(ops) : match?.label || selected}</h2>
            {practice && (
              <PracticeControls
                key={ops.id}
                ops={ops}
                d={d}
                eventId={event?.id || ops.event_id}
                busy={c.busy || c.readOnly}
                act={act}
                profiles={data.profiles}
              />
            )}
            {practice && canAddPractice && (
              <button disabled={c.busy || c.readOnly} onClick={addNextPractice}>
                Add next practice
              </button>
            )}
            {match && matchCard(match)}
            {!ops && (
              <>
                <p>Start a local operations record for this match.</p>
                {d.can_manage ? (
                  <button
                    className="primary"
                    disabled={c.busy || c.readOnly}
                    onClick={() =>
                      act("match", { event_id: event?.id, match_key: selected })
                    }
                  >
                    Prepare for match
                  </button>
                ) : (
                  <p>Competition leadership starts match preparation.</p>
                )}
              </>
            )}
          </section>
          {ops && (
            <>
              <section className="card">
                <h2>Match preparation</h2>
                <p>
                  Assigned battery:{" "}
                  <strong>
                    {data.batteries.find((b) => b.id === ops.battery_id)
                      ?.battery_number || "None"}
                  </strong>
                </p>
                {d.can_manage && !ops.archived_at ? (
                  <form
                    key={ops.version}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      act("match", {
                        match_id: ops.id,
                        version: ops.version,
                        battery_id: f.get("battery"),
                        note: f.get("note"),
                      });
                    }}
                  >
                    <label>
                      Battery
                      <select
                        name="battery"
                        defaultValue={ops.battery_id || ""}
                      >
                        <option value="">Not assigned</option>
                        {data.batteries
                          .filter((b) => b.active && b.status !== "RETIRED")
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.battery_number} · {b.status}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Operational note
                      <textarea
                        name="note"
                        maxLength={2000}
                        defaultValue={ops.note}
                      />
                    </label>
                    <button disabled={c.busy || c.readOnly}>
                      Save preparation
                    </button>
                    <small>
                      Assignment does not install or change battery status.
                    </small>
                  </form>
                ) : (
                  <p>{ops.note}</p>
                )}
                {ops.battery_id && canWork(profile) && (
                  <button onClick={() => batteryAction(ops.battery_id!)}>
                    Open battery actions
                  </button>
                )}
              </section>
              {completed && (
                <section className="card">
                  <h2>Start post-match inspection</h2>
                  <p>
                    Record inspection and battery removal yourself. Finishing a
                    match completes no physical action or checklist item.
                  </p>
                </section>
              )}
              {(!ops.archived_at || completed) && (
                <RunStarter
                  key={`${ops.id}:${completed}`}
                  d={d}
                  busy={c.busy || c.readOnly}
                  enabled={canWork(profile)}
                  kind={completed ? "post" : "pre"}
                  start={(t) =>
                    act("run", {
                      id: crypto.randomUUID(),
                      event_id: event?.id,
                      match_id: ops.id,
                      template_id: t.id,
                      template_version: t.version,
                    })
                  }
                />
              )}
              <RunList
                d={d}
                matchId={ops.id}
                data={data}
                enabled={canWork(profile)}
                busy={c.busy || c.readOnly}
                act={act}
              />
              <section className="card">
                <h2>Robot issues</h2>
                {data.issues
                  .filter(
                    (i) => i.event_id === event?.id && i.status !== "RESOLVED",
                  )
                  .map((i) => (
                    <button
                      className="comp-row"
                      key={i.id}
                      onClick={() => openIssue(i.id)}
                    >
                      {i.title} · {i.severity} · {i.status}
                      <small className="issue-owner">
                        Owner: {issueOwner(i, data.profiles)}
                      </small>
                    </button>
                  ))}
                <h3>Discovered at this match</h3>
                {d.links
                  .filter((l) => l.match_id === ops.id)
                  .map((l) => (
                    <button
                      key={l.issue_id}
                      onClick={() => openIssue(l.issue_id)}
                    >
                      {data.issues.find((i) => i.id === l.issue_id)?.title ||
                        "Issue"}
                    </button>
                  ))}
                {canWork(profile) && (
                  <button onClick={() => report(ops.id)}>
                    Report match issue
                  </button>
                )}
                {canManage(profile) && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act("link_issue", {
                        match_id: ops.id,
                        issue_id: new FormData(e.currentTarget).get("issue"),
                      });
                    }}
                  >
                    <label>
                      Associate existing issue
                      <select name="issue" required>
                        <option value="">Choose issue</option>
                        {data.issues
                          .filter(
                            (i) =>
                              i.event_id === event?.id &&
                              !d.links.some((l) => l.issue_id === i.id),
                          )
                          .map((i) => (
                            <option value={i.id} key={i.id}>
                              #{i.issue_number} {i.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button disabled={c.busy || c.readOnly}>
                      Associate issue
                    </button>
                  </form>
                )}
              </section>
            </>
          )}
        </>
      )}
      {page === "checklists" && (
        <>
          <div className="comp-feed">
            <h2>Checklist templates</h2>
            {d.can_manage && (
              <button
                disabled={c.busy || c.readOnly}
                onClick={() =>
                  editTemplate({
                    name: "",
                    description: "",
                    kind: "pre",
                    active: true,
                    items: [{ ...blank, blocking: true }],
                  })
                }
              >
                New template
              </button>
            )}
          </div>
          {editing && (
            <TemplateEditor
              key={editing.id || "new"}
              template={editing}
              d={d}
              busy={c.busy || c.readOnly}
              cancel={() => editTemplate(null)}
              save={(p) => {
                const version = editVersion.current;
                act("template", p, () => {
                  if (version === editVersion.current) editTemplate(null);
                });
              }}
            />
          )}
          <div className="comp-grid">
            {d.templates.map((t) => (
              <section className="card" key={t.id}>
                <h3>{t.name}</h3>
                <p>
                  {t.kind === "pre"
                    ? "Pre-match"
                    : t.kind === "post"
                      ? "Post-match"
                      : "General"}{" "}
                  · v{t.version} · {t.active ? "Active" : "Archived"} ·{" "}
                  {t.items.length} items
                </p>
                <p>{t.description}</p>
                {d.can_manage && (
                  <>
                    <button
                      disabled={c.busy || c.readOnly}
                      onClick={() => editTemplate(t)}
                    >
                      Edit / reorder
                    </button>
                    <button
                      disabled={c.busy || c.readOnly}
                      onClick={() =>
                        editTemplate({
                          ...t,
                          id: undefined,
                          name: t.name + " copy",
                          version: undefined,
                          active: true,
                        })
                      }
                    >
                      Duplicate
                    </button>
                    <button
                      disabled={c.busy || c.readOnly}
                      onClick={() =>
                        act("template", { ...t, active: !t.active })
                      }
                    >
                      {t.active ? "Archive" : "Reactivate"}
                    </button>
                  </>
                )}
              </section>
            ))}
          </div>
          {!d.templates.length && (
            <p>No templates yet. Leadership can add your team’s procedure.</p>
          )}
          {event && (
            <RunStarter
              d={d}
              busy={c.busy || c.readOnly}
              enabled={canWork(profile)}
              kind="general"
              start={(t) =>
                act("run", {
                  id: crypto.randomUUID(),
                  event_id: event.id,
                  template_id: t.id,
                  template_version: t.version,
                })
              }
            />
          )}
          <RunList
            d={d}
            data={data}
            enabled={canWork(profile)}
            busy={c.busy || c.readOnly}
            act={act}
          />
        </>
      )}
      {page === "admin" && (
        <section className="card">
          <h2>Event connection</h2>
          {!event ? (
            <p>Activate an event below before configuring its schedule.</p>
          ) : d.can_manage ? (
            <form
              key={d.config?.version || 0}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act(
                  "config",
                  {
                    event_id: event.id,
                    version: d.config?.version || 0,
                    team_number: Number(f.get("team")),
                    tba_event_key: String(f.get("tba")).trim(),
                    nexus_event_key: String(f.get("nexus")).trim(),
                  },
                  () => void c.refresh(true),
                );
              }}
            >
              <label>
                Team number
                <input
                  name="team"
                  type="number"
                  min="1"
                  max="99999"
                  defaultValue={d.config?.team_number || 4418}
                  required
                />
              </label>
              <label>
                TBA event key
                <input
                  name="tba"
                  defaultValue={d.config?.tba_event_key || ""}
                  placeholder="Event key from TBA"
                  required
                  pattern="[0-9]{4}[a-z0-9]{1,40}"
                />
              </label>
              <label>
                Nexus event identifier
                <input
                  name="nexus"
                  defaultValue={d.config?.nexus_event_key || ""}
                />
              </label>
              <small>Identifiers only. API keys stay in server secrets.</small>
              <button disabled={c.busy || c.readOnly}>
                Save event connection
              </button>
            </form>
          ) : (
            <p>Competition leadership configures the connection.</p>
          )}
        </section>
      )}
      {["dashboard", "matches", "admin"].includes(page) && (
        <p className="muted">
          Schedule/results:{" "}
          <a
            href="https://www.thebluealliance.com/"
            target="_blank"
            rel="noreferrer"
          >
            The Blue Alliance
          </a>{" "}
          · Live queue:{" "}
          <a href="https://frc.nexus/" target="_blank" rel="noreferrer">
            Nexus
          </a>
        </p>
      )}
    </div>
  );
}
function RunStarter({
  d,
  busy,
  enabled,
  kind,
  start,
}: {
  d: Context;
  busy: boolean;
  enabled: boolean;
  kind: string;
  start: (t: Template) => void;
}) {
  const [id, setId] = useState("");
  const choices = d.templates.filter((t) => t.active && t.kind === kind);
  return (
    <section className="card">
      <h3>
        {kind === "pre"
          ? "Pre-match"
          : kind === "post"
            ? "Post-match inspection"
            : "General"}{" "}
        checklist
      </h3>
      {choices.length ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = choices.find((t) => t.id === id);
            if (t) start(t);
          }}
        >
          <label>
            Template
            <select value={id} onChange={(e) => setId(e.target.value)} required>
              <option value="">Choose a template</option>
              {choices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · v{t.version}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy || !enabled || !id}>Start checklist</button>
        </form>
      ) : (
        <p>
          No active template of this type. Add your procedure in Checklists.
        </p>
      )}
    </section>
  );
}
function RunList({
  d,
  matchId,
  data,
  enabled,
  busy,
  act,
}: {
  d: Context;
  matchId?: string;
  data: Data;
  enabled: boolean;
  busy: boolean;
  act: (action: string, p: Record<string, unknown>) => void;
}) {
  return (
    <>
      {d.runs
        .filter((r) => (matchId ? r.match_id === matchId : true))
        .map((r) => (
          <section className="card" key={r.id}>
            <h3>
              {r.name} · v{r.template_version}
            </h3>
            {d.items.some(
              (i) => i.run_id === r.id && i.blocking && !i.completed_at,
            ) && (
              <div role="status">
                <strong>Robot not ready</strong>
                <p>Complete all required-before-match checks.</p>
              </div>
            )}
            <small>
              {d.matches.find((o) => o.id === r.match_id)
                ? practiceLabel(d.matches.find((o) => o.id === r.match_id)!)
                : "General"}{" "}
              · started {new Date(r.started_at).toLocaleString()}
            </small>
            {d.items
              .filter((i) => i.run_id === r.id)
              .map((i) => (
                <label className="comp-item" key={i.id}>
                  <input
                    type="checkbox"
                    checked={!!i.completed_at}
                    disabled={!enabled || busy}
                    onChange={(e) =>
                      act("item", {
                        id: i.id,
                        version: i.version,
                        complete: e.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong>{i.text}</strong>
                    <small>
                      {i.blocking
                        ? "Required before match"
                        : i.required
                          ? "Required"
                          : "Optional"}
                      {i.area_id
                        ? " · " +
                          (d.areas.find((a) => a.id === i.area_id)?.name ||
                            "Area")
                        : ""}
                    </small>
                    {i.completed_at && (
                      <small>
                        Completed by{" "}
                        {data.profiles.find((p) => p.id === i.completed_by)
                          ?.display_name || "Team member"}{" "}
                        · {when(i.completed_at)}
                      </small>
                    )}
                  </span>
                </label>
              ))}
          </section>
        ))}
    </>
  );
}
function TemplateEditor({
  template: t,
  d,
  busy,
  cancel,
  save,
}: {
  template: Partial<Template>;
  d: Context;
  busy: boolean;
  cancel: () => void;
  save: (p: Record<string, unknown>) => void;
}) {
  const [kind, setKind] = useState(t.kind || "pre");
  const [items, setItems] = useState<TemplateItem[]>(
    t.items || [{ ...blank, blocking: (t.kind || "pre") === "pre" }],
  );
  const change = (idx: number, p: Partial<TemplateItem>) =>
    setItems(items.map((i, n) => (n === idx ? { ...i, ...p } : i)));
  const move = (idx: number, by: number) => {
    const a = [...items];
    [a[idx], a[idx + by]] = [a[idx + by], a[idx]];
    setItems(a);
  };
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({
          id: t.id,
          version: t.version,
          active: t.active ?? true,
          name: f.get("name"),
          description: f.get("description"),
          kind: f.get("kind"),
          items,
        });
      }}
    >
      <h3>{t.id ? "Edit" : "Create"} template</h3>
      <label>
        Name
        <input name="name" required maxLength={120} defaultValue={t.name} />
      </label>
      <label>
        Description
        <input
          name="description"
          maxLength={1000}
          defaultValue={t.description}
        />
      </label>
      <label>
        Type
        <select
          name="kind"
          value={kind}
          onChange={(e) => {
            const next = e.target.value as Template["kind"];
            setKind(next);
            setItems(
              items.map((i) => ({
                ...i,
                required: i.required || i.blocking,
                blocking: next === "pre" && (i.required || i.blocking),
              })),
            );
          }}
        >
          <option value="pre">Pre-match</option>
          <option value="post">Post-match</option>
          <option value="general">General</option>
        </select>
      </label>
      {items.map((i, n) => (
        <fieldset key={n}>
          <legend>Item {n + 1}</legend>
          <label>
            Item text
            <input
              value={i.text}
              required
              maxLength={300}
              onChange={(e) => change(n, { text: e.target.value })}
            />
          </label>
          <label>
            Importance
            <select
              value={i.required || i.blocking ? "required" : "optional"}
              aria-describedby={`importance-help-${n}`}
              onChange={(e) =>
                change(n, {
                  required: e.target.value !== "optional",
                  blocking: kind === "pre" && e.target.value === "required",
                })
              }
            >
              <option value="required">Required</option>
              <option value="optional">Optional</option>
            </select>
          </label>
          <small id={`importance-help-${n}`}>
            {!i.required && !i.blocking
              ? "Recommended, but not required to complete the checklist."
              : kind === "pre" && i.blocking
                ? "Must be completed before the robot is marked ready for the match."
                : kind === "pre"
                  ? "Existing required check; its non-blocking readiness behavior is preserved."
                  : i.blocking
                    ? "Existing required check; its blocking readiness behavior is preserved."
                    : "Must be completed as part of the checklist."}
          </small>
          <label>
            Area (optional)
            <select
              value={i.area_id || ""}
              onChange={(e) => change(n, { area_id: e.target.value || null })}
            >
              <option value="">Any area</option>
              {d.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="comp-inline">
            <button
              type="button"
              disabled={n === 0}
              onClick={() => move(n, -1)}
            >
              Move up
            </button>
            <button
              type="button"
              disabled={n === items.length - 1}
              onClick={() => move(n, 1)}
            >
              Move down
            </button>
            <button
              type="button"
              disabled={items.length === 1}
              onClick={() => setItems(items.filter((_, idx) => idx !== n))}
            >
              Remove item
            </button>
          </div>
        </fieldset>
      ))}
      <div className="comp-inline">
        <button
          type="button"
          disabled={items.length >= 60}
          onClick={() =>
            setItems([...items, { ...blank, blocking: kind === "pre" }])
          }
        >
          Add item
        </button>
        <button disabled={busy}>Save template</button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
      <p>Existing runs keep their original items and version.</p>
    </form>
  );
}
