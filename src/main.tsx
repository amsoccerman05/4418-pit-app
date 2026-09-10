import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  Battery as BatteryIcon,
  Check,
  ChevronRight,
  Clock,
  LayoutDashboard,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { supabase, configured, configError } from "./client";
import { fetchData, mutate } from "./repository";
import { demoProfile, readDemo } from "./demo";
import {
  type Data,
  type Profile,
  type Role,
  type Issue,
  type Battery,
  type PitEvent,
  emptyData,
  subsystems,
  severities,
  issueStatuses,
  batteryStatuses,
  readiness,
  unresolved,
  canWork,
  canManage,
  isAdmin,
  nextBattery,
  batteryMatch,
} from "./model";
import "./style.css";
const teamEmblem = `${import.meta.env.BASE_URL}branding/4418-impulse-emblem.png`;
const teamWordmark = `${import.meta.env.BASE_URL}branding/4418-impulse-wordmark.png`;
type Page = "dashboard" | "issues" | "batteries" | "admin";
type Modal =
  | { kind: "report" }
  | { kind: "issue"; id: string }
  | { kind: "battery"; id: string }
  | {
      kind: "batteryAction";
      id: string;
      action: "install" | "remove" | "ready";
    }
  | { kind: "event"; id?: string }
  | { kind: "newBattery" }
  | null;
const stamp = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const tone = (s: string) =>
  s === "ROBOT DOWN" || s === "NOT READY" || s === "FLAGGED"
    ? "danger"
    : ["HIGH", "NEEDS ATTENTION", "COOLING"].includes(s)
      ? "warning"
      : ["READY", "RESOLVED", "active"].includes(s)
        ? "success"
        : [
              "CHARGING",
              "ON ROBOT",
              "REPAIRING",
              "TESTING",
              "DIAGNOSING",
            ].includes(s)
          ? "info"
          : "neutral";
function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${tone(value)}`}>
      {value === "ROBOT DOWN" || value === "FLAGGED" ? (
        <TriangleAlert size={13} />
      ) : (
        <span className="dot" />
      )}
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const id = React.useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id })}
    </div>
  );
}
function Select({
  value,
  onChange,
  options,
  ...props
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  disabled?: boolean;
  required?: boolean;
  id?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o || "Select…"}
        </option>
      ))}
    </select>
  );
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [demo, setDemo] = useState(false),
    [role, setRole] = useState<Role>("student"),
    [profile, setProfile] = useState<Profile | null>(null),
    [userId, setUserId] = useState<string | null>(null),
    [authReady, setAuthReady] = useState(!supabase);
  const [data, setData] = useState<Data>(emptyData),
    [page, setPage] = useState<Page>("dashboard"),
    [modal, setModal] = useState<Modal>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [sync, setSync] = useState("Connecting"),
    [lastSync, setLastSync] = useState("");
  const [eventFilter, setEventFilter] = useState("active"),
    [issueFilter, setIssueFilter] = useState("UNRESOLVED"),
    [batteryFilter, setBatteryFilter] = useState("ALL"),
    [search, setSearch] = useState("");
  const request = useRef(0);
  const authIdentity = useRef<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      const nextId = session?.user.id || null;
      if (authIdentity.current !== nextId) {
        authIdentity.current = nextId;
        setProfile(null);
        setData(emptyData());
        setModal(null);
      }
      setUserId(nextId);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    try {
      const d = demo ? readDemo() : await fetchData();
      if (version !== request.current) return;
      const p = demo
        ? demoProfile(role)
        : d.profiles.find((p) => p.id === userId && p.active);
      if (!p) {
        setProfile(null);
        setData(emptyData());
        throw new Error(
          "Your account needs an active Team 4418 profile. Ask a mentor or admin.",
        );
      }
      setProfile(p);
      setData(d);
      setLastSync(new Date().toLocaleTimeString());
    } catch (e) {
      if (version === request.current)
        setError(
          e instanceof Error
            ? e.message
            : String((e as { message?: string }).message || e),
        );
    }
  }, [demo, role, userId]);
  useEffect(() => {
    if (!demo && !userId) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
    const interval = window.setInterval(() => void refresh(), 20000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("storage", focus);
    let channel:
      ReturnType<NonNullable<typeof supabase>["channel"]> | undefined;
    if (!demo && supabase) {
      channel = supabase.channel("pit-workspace");
      for (const table of [
        "pit_events",
        "pit_issues",
        "pit_batteries",
        "pit_battery_events",
        "pit_issue_events",
        "profiles",
      ])
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => void refresh(),
        );
      channel.subscribe((s) =>
        setSync(
          s === "SUBSCRIBED"
            ? "Live updates"
            : "Reconnecting · refresh every 20s",
        ),
      );
    } else setSync("Local demo");
    const online = () => {
      setError("");
      void refresh();
    };
    const offline = () =>
      setError(
        "You are offline. Changes cannot be saved. Displayed data may be out of date.",
      );
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      request.current++;
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      window.removeEventListener("storage", focus);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [refresh, demo, userId]);
  async function save(
    action: string,
    p: Record<string, unknown>,
    close = true,
  ) {
    if (!profile || busy) return false;
    setBusy(true);
    setError("");
    try {
      await mutate(demo, profile, action, p);
      await refresh();
      setNotice("Saved successfully");
      if (close) setModal(null);
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : String((e as { message?: string }).message || e),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const active = data.events.find((e) => e.status === "active");
  const currentIssues = data.issues.filter((i) => i.event_id === active?.id);
  const open = currentIssues.filter(unresolved),
    down = open.filter((i) => i.severity === "ROBOT DOWN"),
    fleet = data.batteries.filter((b) => b.active && b.status !== "RETIRED");
  const onRobot = data.batteries.filter((b) => b.status === "ON ROBOT");
  const name = (id: string | null) =>
    data.profiles.find((p) => p.id === id)?.display_name || "Team member";
  const go = (p: Page, filter?: string) => {
    setPage(p);
    setSearch("");
    if (p === "issues") {
      setEventFilter("active");
      setIssueFilter(filter || "UNRESOLVED");
    }
    if (p === "batteries") setBatteryFilter(filter || "ALL");
  };
  const exit = async () => {
    if (demo) {
      setDemo(false);
      setProfile(null);
      setData(emptyData());
      setModal(null);
    } else {
      const result = await supabase!.auth.signOut();
      if (result.error) setError(result.error.message);
    }
  };
  if (!authReady)
    return (
      <div className="login">
        <p>Connecting to Team 4418…</p>
      </div>
    );
  if (!profile)
    return (
      <div className="login">
        <div className="login-card">
          <Brand />
          <div className="eyebrow">COMPETITION WORKSPACE</div>
          <h1>
            A ready robot.
            <br />A ready pit.
          </h1>
          <p>
            Track robot issues and keep every battery moving. Built for the
            IMPULSE pit crew.
          </p>
          {(error || configError) && (
            <div className="error" role="alert">
              {error || configError}
            </div>
          )}
          {loading ? (
            <p>Loading your workspace…</p>
          ) : userId ? (
            <>
              <p>Signed in. Waiting for an active team profile.</p>
              <button onClick={() => void refresh()}>Retry</button>
              <button onClick={() => void exit()}>Sign out</button>
            </>
          ) : configured && supabase ? (
            <Login />
          ) : (
            <div className="setup">
              <strong>Connect your team workspace</strong>
              <p>
                Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the existing
                Inventory project, then run the Pit migration. Setup steps are
                in README.md.
              </p>
            </div>
          )}
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setDemo(true);
            }}
          >
            Explore local demo <ArrowRight size={17} />
          </button>
          <small>
            Demo data stays in this browser. It is not live team data.
          </small>
        </div>
      </div>
    );
  const issue = data.issues.find(
    (i) => modal?.kind === "issue" && i.id === modal.id,
  );
  const battery = data.batteries.find(
    (b) =>
      (modal?.kind === "battery" || modal?.kind === "batteryAction") &&
      b.id === modal.id,
  );
  const row = (i: Issue) => (
    <button
      key={i.id}
      className="issue-row"
      onClick={() => {
        setError("");
        setModal({ kind: "issue", id: i.id });
      }}
    >
      <span className={`issue-icon ${tone(i.severity)}`}>
        <Wrench size={19} />
      </span>
      <span className="issue-copy">
        <strong>{i.title}</strong>
        <small>
          #{i.issue_number} · {i.subsystem}
          {i.discovered_match ? ` · ${i.discovered_match}` : ""}
        </small>
      </span>
      <span className="issue-badges">
        <Badge value={i.severity} />
        <span className="substatus">{i.status}</span>
      </span>
      <ChevronRight size={18} />
    </button>
  );
  return (
    <>
      <aside className="sidebar">
        <Brand />
        <div className="workspace">
          <span className="team-avatar">
            <img src={teamEmblem} alt="Team 4418 IMPULSE" />
          </span>
          <div>
            Team workspace<small>FRC 4418 · IMPULSE</small>
          </div>
          <span className="dot" />
        </div>
        <div className="nav-caption">PIT OPERATIONS</div>
        <nav>
          {(
            [
              ["dashboard", "Dashboard", LayoutDashboard],
              ["issues", "Issues", Wrench],
              ["batteries", "Batteries", BatteryIcon],
              ...(isAdmin(profile) ? [["admin", "Manage", Settings]] : []),
            ] as const
          ).map(([p, label, Icon]) => (
            <button
              key={String(p)}
              className={page === p ? "selected" : ""}
              onClick={() => go(p as Page)}
            >
              <Icon size={20} />
              <span>{String(label)}</span>
              {p === "issues" && open.length > 0 && (
                <b className="nav-count">{open.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="suite-wordmark">
            <img src={teamWordmark} alt="IMPULSE — FRC Team 4418" />
          </span>
          <p>
            Built for the pit.<small>Keep the robot moving.</small>
          </p>
        </div>
        <div className="account">
          <div className="avatar">
            {profile.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{profile.display_name}</strong>
            <small>{profile.role}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={() => void exit()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="app">
        <header className="topbar">
          <div className="topbar-left">
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <b>
              {page === "dashboard"
                ? "Dashboard"
                : page === "issues"
                  ? "Issues"
                  : page === "batteries"
                    ? "Batteries"
                    : "Manage"}
            </b>
          </div>
          <div className="topbar-right">
            <span className="role-pill">{profile.role.toUpperCase()}</span>
            <span className="sync">
              <span className="dot" />
              {sync}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh data"
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button mobile-signout"
              aria-label="Sign out"
              onClick={() => void exit()}
            >
              <LogOut size={17} />
            </button>
            <span className="suite-avatar">
              <img src={teamEmblem} alt="Team 4418 IMPULSE" />
            </span>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <strong>LOCAL DEMO</strong>
            <span>Sample data · not connected to your team</span>
            <label>
              Role{" "}
              <select
                aria-label="Demo role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {["readonly", "student", "lead", "admin", "mentor"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <button onClick={() => void exit()}>Exit demo</button>
          </div>
        )}
        <main>
          {error && !modal && (
            <div role="alert" className="error">
              {error}
              <button
                onClick={() => {
                  setError("");
                  void refresh();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">TEAM 4418 / PIT OPERATIONS</div>
              <h1>
                {page === "dashboard"
                  ? "Pit dashboard"
                  : page === "issues"
                    ? "Issue log"
                    : page === "batteries"
                      ? "Battery tracking"
                      : "Manage workspace"}
              </h1>
              <p>
                {page === "dashboard"
                  ? "Everything you need to keep the robot match-ready."
                  : page === "issues"
                    ? "Report, repair, and get back on the field."
                    : page === "batteries"
                      ? "A clear view of every battery, from charger to robot."
                      : "Events and competition batteries."}
              </p>
            </div>
            {page === "batteries"
              ? isAdmin(profile) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setModal({ kind: "newBattery" });
                    }}
                  >
                    <Plus size={19} />
                    Add battery
                  </button>
                )
              : canWork(profile) && (
                  <button
                    className="primary"
                    disabled={!active || busy}
                    onClick={() => {
                      setError("");
                      setModal({ kind: "report" });
                    }}
                  >
                    <Plus size={19} />
                    Report issue
                  </button>
                )}
          </div>
          <div className="event-strip">
            <span className="event-icon">
              <MapPin size={20} />
            </span>
            <div>
              <small>
                {page === "dashboard" ? "ACTIVE EVENT" : "EVENT CONTEXT"}
              </small>
              <strong>{active?.name || "No active event"}</strong>
            </div>
            {active ? (
              <>
                <span className="event-location">{active.location}</span>
                <Badge value="active" />
              </>
            ) : (
              <span className="muted">
                A mentor or admin can create and activate an event.
              </span>
            )}
          </div>
          {page === "dashboard" && (
            <>
              <div className="readiness-grid">
                <section
                  className={`robot-card ${active ? tone(readiness(currentIssues)) : "neutral"}`}
                >
                  <div className="eyebrow">ROBOT STATUS</div>
                  <div className="robot-state">
                    {!active ? (
                      <Clock size={36} />
                    ) : readiness(currentIssues) === "READY" ? (
                      <ShieldCheck size={40} />
                    ) : (
                      <TriangleAlert size={40} />
                    )}
                    <h2>
                      {active ? readiness(currentIssues) : "NO ACTIVE EVENT"}
                    </h2>
                  </div>
                  <p>
                    {active
                      ? `${open.length} open ${open.length === 1 ? "issue" : "issues"} · ${down.length} robot-down ${down.length === 1 ? "issue" : "issues"}`
                      : "Activate an event to see robot readiness."}
                  </p>
                  <div className="robot-foot">
                    <span>
                      {!active
                        ? "Waiting for event setup"
                        : open.length === 0
                          ? "No unresolved issues reported."
                          : "Readiness is based on unresolved issues."}
                    </span>
                    <Activity size={20} />
                  </div>
                </section>
                <section className="card current-battery">
                  <div className="eyebrow">CURRENT BATTERY</div>
                  {onRobot.length > 1 ? (
                    <div className="error">
                      <TriangleAlert />
                      Multiple batteries marked ON ROBOT. Check the fleet.
                    </div>
                  ) : onRobot.length === 1 ? (
                    <>
                      <div className="battery-hero">
                        <BatteryIcon size={42} />
                        <h2>{onRobot[0].battery_number}</h2>
                        <Badge value="ON ROBOT" />
                      </div>
                      <BatteryMatchLabel battery={onRobot[0]} data={data} />
                      <p>
                        {(() => {
                          const latest = data.batteryEvents
                            .filter(
                              (e) =>
                                e.battery_id === onRobot[0].id &&
                                e.voltage !== null,
                            )
                            .sort((a, b) =>
                              b.created_at.localeCompare(a.created_at),
                            )[0];
                          return latest
                            ? `${Number(latest.voltage).toFixed(2)} V · ${latest.voltage_kind} · ${stamp(latest.created_at)}`
                            : "No voltage recorded";
                        })()}
                      </p>
                      <button
                        className="text-button"
                        onClick={() =>
                          setModal({ kind: "battery", id: onRobot[0].id })
                        }
                      >
                        View battery history <ArrowRight size={16} />
                      </button>
                    </>
                  ) : (
                    <div className="empty small-empty">
                      <BatteryIcon size={36} />
                      <strong>No battery assigned</strong>
                      <button
                        className="text-button"
                        onClick={() => go("batteries")}
                      >
                        Go to batteries <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </section>
              </div>
              <div className="metrics">
                {[
                  ["Open issues", open.length, "issues", "UNRESOLVED", Wrench],
                  [
                    "Robot down",
                    down.length,
                    "issues",
                    "ROBOT DOWN",
                    TriangleAlert,
                  ],
                  [
                    "Batteries ready",
                    fleet.filter((b) => b.status === "READY").length,
                    "batteries",
                    "READY",
                    BatteryIcon,
                  ],
                  [
                    "Batteries charging",
                    fleet.filter((b) => b.status === "CHARGING").length,
                    "batteries",
                    "CHARGING",
                    Zap,
                  ],
                  [
                    "Flagged batteries",
                    fleet.filter((b) => b.status === "FLAGGED").length,
                    "batteries",
                    "FLAGGED",
                    TriangleAlert,
                  ],
                ].map(([label, count, p, f, Icon]) => {
                  const I = Icon as typeof Wrench;
                  return (
                    <button
                      className="metric"
                      key={String(label)}
                      onClick={() => go(p as Page, String(f))}
                    >
                      <span>
                        {String(label)}
                        <I size={18} />
                      </span>
                      <strong>{count as number}</strong>
                      <span className="metric-bottom">
                        View {p as string}
                        <ArrowRight size={15} />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="dashboard-lists">
                <section className="card">
                  <div className="section-heading">
                    <h2>
                      Active issues <span className="count">{open.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => go("issues")}
                    >
                      View all <ArrowRight size={16} />
                    </button>
                  </div>
                  {open.length ? (
                    open
                      .sort(
                        (a, b) =>
                          severities.indexOf(b.severity) -
                          severities.indexOf(a.severity),
                      )
                      .slice(0, 5)
                      .map(row)
                  ) : (
                    <div className="empty">
                      <Check size={30} />
                      <strong>All clear in the pit</strong>
                      <p>No unresolved issues for this event.</p>
                    </div>
                  )}
                </section>
                <section className="card">
                  <div className="section-heading">
                    <h2>Battery status</h2>
                    <button
                      className="text-button"
                      onClick={() => go("batteries")}
                    >
                      View fleet <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="mini-fleet">
                    {fleet.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setModal({ kind: "battery", id: b.id })}
                      >
                        <BatteryIcon size={21} />
                        <strong>{b.battery_number}</strong>
                        <Badge value={b.status} />
                      </button>
                    ))}
                  </div>
                  {!fleet.length && (
                    <div className="empty">No competition batteries yet.</div>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "issues" && (
            <>
              <div className="filters">
                <Field label="Search issues">
                  <input
                    placeholder="Search title or subsystem…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </Field>
                <Field label="Event">
                  <select
                    value={eventFilter}
                    onChange={(e) => setEventFilter(e.target.value)}
                  >
                    <option value="active">Active event</option>
                    <option value="all">All events</option>
                    {data.events.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.status})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status / severity">
                  <Select
                    value={issueFilter}
                    onChange={setIssueFilter}
                    options={[
                      "UNRESOLVED",
                      "ALL",
                      "ROBOT DOWN",
                      ...issueStatuses,
                    ]}
                  />
                </Field>
              </div>
              <section className="card">
                {(() => {
                  const filtered = data.issues
                    .filter(
                      (i) =>
                        (eventFilter === "all" ||
                          i.event_id ===
                            (eventFilter === "active"
                              ? active?.id
                              : eventFilter)) &&
                        (issueFilter === "ALL" ||
                          (issueFilter === "UNRESOLVED" && unresolved(i)) ||
                          (issueFilter === "ROBOT DOWN" &&
                            unresolved(i) &&
                            i.severity === "ROBOT DOWN") ||
                          i.status === issueFilter) &&
                        `${i.title} ${i.subsystem} ${i.issue_number}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .sort((a, b) => b.created_at.localeCompare(a.created_at));
                  return filtered.length ? (
                    filtered.map(row)
                  ) : (
                    <div className="empty">
                      <Wrench size={30} />
                      <strong>No issues to show</strong>
                      <p>Change your filters or report an issue.</p>
                    </div>
                  );
                })()}
              </section>
            </>
          )}
          {page === "batteries" && (
            <>
              <div className="filters">
                <Field label="Battery status">
                  <Select
                    value={batteryFilter}
                    onChange={setBatteryFilter}
                    options={["ALL", ...batteryStatuses, "ARCHIVED"]}
                  />
                </Field>
                <p className="filter-note">
                  {fleet.length} active batteries · Status changes are saved to
                  history.
                </p>
              </div>
              <div className="battery-grid">
                {data.batteries
                  .filter((b) =>
                    batteryFilter === "ARCHIVED"
                      ? !b.active
                      : b.active &&
                        (batteryFilter === "ALL" || b.status === batteryFilter),
                  )
                  .sort((a, b) =>
                    a.battery_number.localeCompare(b.battery_number),
                  )
                  .map((b) => (
                    <article className="card battery-card" key={b.id}>
                      <div className="battery-card-heading">
                        <BatteryIcon size={25} />
                        <Badge value={b.status} />
                      </div>
                      <h2>{b.battery_number}</h2>
                      <p>{b.label || "Competition battery"}</p>
                      <BatteryMatchLabel battery={b} data={data} />
                      {b.notes && <p className="battery-notes">{b.notes}</p>}
                      <div className="battery-actions">
                        {canWork(profile) &&
                          b.active &&
                          nextBattery[b.status] && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => {
                                if (b.status === "ON ROBOT") {
                                  setError("");
                                  setModal({
                                    kind: "batteryAction",
                                    id: b.id,
                                    action: "remove",
                                  });
                                  return;
                                }
                                void save(
                                  "transition_battery",
                                  {
                                    id: b.id,
                                    expected_status: b.status,
                                    status: nextBattery[b.status]!.status,
                                    event_id: active?.id || null,
                                  },
                                  false,
                                );
                              }}
                            >
                              {nextBattery[b.status]!.label}
                              <ArrowRight size={16} />
                            </button>
                          )}
                        {canWork(profile) &&
                          b.active &&
                          (b.status === "READY" || b.status === "CHARGING") && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                setError("");
                                setModal({
                                  kind: "batteryAction",
                                  id: b.id,
                                  action:
                                    b.status === "READY" ? "install" : "ready",
                                });
                              }}
                            >
                              {b.status === "READY"
                                ? "Install with match"
                                : "Ready with voltage"}
                            </button>
                          )}
                        <button
                          className="text-button"
                          onClick={() => {
                            setError("");
                            setModal({ kind: "battery", id: b.id });
                          }}
                        >
                          Details & history <ChevronRight size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!data.batteries.length && (
                <div className="empty">
                  A mentor or admin can add the competition batteries.
                </div>
              )}
            </>
          )}
          {page === "admin" && isAdmin(profile) && (
            <section className="card">
              <div className="section-heading">
                <h2>Competition events</h2>
                <button
                  className="primary"
                  onClick={() => setModal({ kind: "event" })}
                >
                  <Plus size={18} />
                  New event
                </button>
              </div>
              <p className="section-note">
                Activating an event completes the previous active event. Issue
                and battery history are preserved.
              </p>
              {data.events.map((e) => (
                <div className="event-row" key={e.id}>
                  <div>
                    <strong>{e.name}</strong>
                    <small>
                      {e.location} · {e.start_date} – {e.end_date}
                    </small>
                  </div>
                  <Badge value={e.status} />
                  <button
                    className="secondary"
                    onClick={() => setModal({ kind: "event", id: e.id })}
                  >
                    Edit
                  </button>
                  {e.status !== "active" ? (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void save("activate_event", { id: e.id }, false)
                      }
                    >
                      Activate event
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void save(
                          "save_event",
                          { ...e, status: "completed" },
                          false,
                        )
                      }
                    >
                      Complete event
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          <footer>
            <span>
              4418 IMPULSE <span> / </span> Ready for the next match.
            </span>
            <span>{lastSync && `Last refreshed ${lastSync}`}</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Dialog
          title={
            modal.kind === "report"
              ? "Report an issue"
              : modal.kind === "issue"
                ? `Issue #${issue?.issue_number || ""}`
                : modal.kind === "batteryAction"
                  ? `${battery?.battery_number} · ${modal.action === "remove" ? "Remove battery" : modal.action === "install" ? "Install battery" : "Mark ready"}`
                  : modal.kind === "battery"
                    ? `${battery?.battery_number} · Details & history`
                    : modal.kind === "event"
                      ? "Event details"
                      : "New battery"
          }
          close={() => {
            setModal(null);
            setError("");
          }}
        >
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {modal.kind === "report" && (
            <Report
              data={data}
              busy={busy}
              submit={(p) =>
                save("report_issue", { ...p, event_id: active?.id })
              }
            />
          )}{" "}
          {issue && modal.kind === "issue" && (
            <IssueDetail
              key={issue.id}
              issue={issue}
              data={data}
              profile={profile}
              busy={busy}
              name={name}
              submit={(p) => save("update_issue", p)}
            />
          )}{" "}
          {battery && modal.kind === "batteryAction" && (
            <BatteryQuickAction
              key={`${battery.id}-${modal.action}`}
              battery={battery}
              data={data}
              action={modal.action}
              busy={busy}
              eventId={active?.id}
              submit={(p) => save("transition_battery", p)}
            />
          )}
          {battery && modal.kind === "battery" && (
            <BatteryDetail
              battery={battery}
              data={data}
              profile={profile}
              busy={busy}
              name={name}
              eventId={active?.id}
              save={save}
              openIssue={(id) => setModal({ kind: "issue", id })}
              remove={() => {
                setError("");
                setModal({
                  kind: "batteryAction",
                  id: battery.id,
                  action: "remove",
                });
              }}
            />
          )}{" "}
          {modal.kind === "event" && (
            <EventForm
              event={data.events.find((e) => e.id === modal.id)}
              busy={busy}
              submit={(p) => save("save_event", p)}
            />
          )}{" "}
          {modal.kind === "newBattery" && (
            <BatteryForm busy={busy} submit={(p) => save("save_battery", p)} />
          )}
        </Dialog>
      )}
    </>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <img src={teamEmblem} alt="Team 4418 IMPULSE rocket logo" />
      </div>
      <div>
        4418 <span>PIT OPERATIONS</span>
      </div>
    </div>
  );
}
function Login() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const { error } = await supabase!.auth.signInWithPassword({
            email,
            password,
          });
          if (error) setError(error.message);
        } catch {
          setError("Could not connect. Check your connection and try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Team account email">
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <small>
        Use your existing Inventory account. Ask a mentor for account access or
        a password reset.
      </small>
    </form>
  );
}
function Report({
  data,
  busy,
  submit,
}: {
  data: Data;
  busy: boolean;
  submit: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const [subsystem, setSubsystem] = useState(""),
    [severity, setSeverity] = useState(""),
    [description, setDescription] = useState(""),
    [match, setMatch] = useState(""),
    [battery, setBattery] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          subsystem,
          severity,
          description: description.trim(),
          discovered_match: match,
          battery_id: battery || null,
        });
      }}
    >
      <p className="form-help">
        Get it logged. Diagnosis and repair details can come later.
      </p>
      <div className="form-grid">
        <Field label="Subsystem *">
          <Select
            required
            value={subsystem}
            onChange={setSubsystem}
            options={["", ...subsystems]}
          />
        </Field>
        <Field label="Severity *">
          <Select
            required
            value={severity}
            onChange={setSeverity}
            options={["", ...severities]}
          />
        </Field>
      </div>
      <Field label="What happened? *">
        <textarea
          autoFocus
          required
          maxLength={10000}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Shooter wheel stopped after Q41"
        />
      </Field>
      <div className="form-grid">
        <Field label="Match discovered (optional)">
          <input
            value={match}
            maxLength={40}
            onChange={(e) => setMatch(e.target.value)}
            placeholder="e.g. Q41"
          />
        </Field>
        <Field label="Battery (optional)">
          <select value={battery} onChange={(e) => setBattery(e.target.value)}>
            <option value="">No battery linked</option>
            {data.batteries
              .filter((b) => b.active)
              .map((b) => (
                <option value={b.id} key={b.id}>
                  {b.battery_number} · {b.status}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="form-actions">
        <button className="primary" disabled={busy || !description.trim()}>
          <Plus size={18} />
          {busy ? "Reporting…" : "Report issue"}
        </button>
      </div>
    </form>
  );
}
function IssueDetail({
  issue: i,
  data,
  profile,
  busy,
  name,
  submit,
}: {
  issue: Issue;
  data: Data;
  profile: Profile;
  busy: boolean;
  name: (id: string | null) => string;
  submit: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(i);
  const editable = canManage(profile);
  const patch = (k: string, v: string | null) =>
    setDraft((d) => ({ ...d, [k]: v }));
  return (
    <>
      <div className="detail-summary">
        <h3>{i.title}</h3>
        <div className="badge-row">
          <Badge value={i.severity} />
          <Badge value={i.status} />
        </div>
        <p>{i.description}</p>
        <small>
          {i.subsystem} · Reported by {name(i.reported_by)} ·{" "}
          {stamp(i.created_at)}
          {i.discovered_match && ` · ${i.discovered_match}`}
        </small>
        {i.battery_id && (
          <p>
            Battery:{" "}
            <strong>
              {
                data.batteries.find((b) => b.id === i.battery_id)
                  ?.battery_number
              }
            </strong>
          </p>
        )}
        {i.resolved_at && (
          <small>
            Resolved by {name(i.resolved_by)} · {stamp(i.resolved_at)}
          </small>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit({
            id: i.id,
            expected_updated_at: draft.updated_at,
            title: draft.title,
            severity: draft.severity,
            status: draft.status,
            assigned_to: draft.assigned_to,
            battery_id: draft.battery_id,
            root_cause: draft.root_cause,
            repair_notes: draft.repair_notes,
            resolution_notes: draft.resolution_notes,
          });
        }}
      >
        <fieldset disabled={!editable || busy}>
          <Field label="Title">
            <input
              required
              maxLength={150}
              value={draft.title}
              onChange={(e) => patch("title", e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label="Status">
              <Select
                value={draft.status}
                onChange={(v) => patch("status", v)}
                options={issueStatuses}
              />
            </Field>
            <Field label="Severity">
              <Select
                value={draft.severity}
                onChange={(v) => patch("severity", v)}
                options={severities}
              />
            </Field>
            <Field label="Assigned to">
              <select
                value={draft.assigned_to || ""}
                onChange={(e) => patch("assigned_to", e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {data.profiles
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name || "Team member"}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Linked battery">
              <select
                value={draft.battery_id || ""}
                onChange={(e) => patch("battery_id", e.target.value || null)}
              >
                <option value="">No battery linked</option>
                {data.batteries.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.battery_number}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {[
            ["root_cause", "Root cause"],
            ["repair_notes", "Repair performed"],
            ["resolution_notes", "Resolution notes"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <textarea
                rows={2}
                value={String(draft[k as keyof Issue] || "")}
                onChange={(e) => patch(k, e.target.value)}
              />
            </Field>
          ))}
        </fieldset>
        {editable ? (
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save issue"}
            </button>
          </div>
        ) : (
          <p className="form-help">
            A lead, mentor, or admin can update this issue.
          </p>
        )}
      </form>
      <h3 className="history-heading">Issue history</h3>
      <div className="timeline">
        {data.issueEvents
          .filter((e) => e.issue_id === i.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((e) => (
            <div key={e.id}>
              <strong>{name(e.performed_by)}</strong>
              <small>{stamp(e.created_at)}</small>
              {Object.entries(e.changes).map(([k, v]) => (
                <p key={k}>
                  {k.replaceAll("_", " ")}:{" "}
                  {k === "assigned_to"
                    ? `${v.from ? name(String(v.from)) : "Unassigned"} → ${v.to ? name(String(v.to)) : "Unassigned"}`
                    : k === "battery_id"
                      ? `${data.batteries.find((b) => b.id === v.from)?.battery_number || "None"} → ${data.batteries.find((b) => b.id === v.to)?.battery_number || "None"}`
                      : `${v.from || "—"} → ${v.to || "—"}`}
                </p>
              ))}
            </div>
          ))}
      </div>
    </>
  );
}
function BatteryMatchLabel({
  battery,
  data,
}: {
  battery: Battery;
  data: Data;
}) {
  const match = batteryMatch(battery, data.batteryEvents);
  return match ? (
    <p className="battery-match">
      <strong>
        {battery.status === "ON ROBOT" ? "Assigned" : "Last used"}: {match}
      </strong>
    </p>
  ) : null;
}
function BatteryQuickAction({
  battery: b,
  data,
  action,
  busy,
  eventId,
  submit,
}: {
  battery: Battery;
  data: Data;
  action: "install" | "remove" | "ready";
  busy: boolean;
  eventId?: string;
  submit: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  // Keep the opened status as the concurrency token if realtime updates the card.
  const [expectedStatus] = useState(b.status);
  const [match, setMatch] = useState(
    action === "remove" ? batteryMatch(b, data.batteryEvents) : "",
  );
  const [voltage, setVoltage] = useState("");
  const [next, setNext] = useState("COOLING");
  const [contextEvent] = useState(eventId || null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          id: b.id,
          expected_status: expectedStatus,
          event_id: contextEvent,
          status:
            action === "install"
              ? "ON ROBOT"
              : action === "ready"
                ? "READY"
                : next,
          match_number: match.trim(),
          voltage: voltage === "" ? null : Number(voltage),
          voltage_kind: action === "remove" ? "post-match" : "pre-match",
        });
      }}
    >
      <p className="form-help">
        {action === "remove"
          ? "Record the match and send this battery to its next step."
          : action === "install"
            ? "Add a match identifier for this installation, if known."
            : "Record a voltage reading if you have one, or leave it blank."}
      </p>
      {action !== "ready" && (
        <Field label="Match (optional)">
          <input
            autoFocus
            value={match}
            maxLength={40}
            placeholder="Q42, SF3-1, F2"
            onChange={(e) => setMatch(e.target.value)}
          />
        </Field>
      )}
      {action !== "install" && (
        <Field
          label={
            action === "remove"
              ? "Post-match voltage (optional)"
              : "Voltage (optional)"
          }
        >
          <input
            autoFocus={action === "ready"}
            type="number"
            inputMode="decimal"
            min="0"
            max="20"
            step="0.01"
            value={voltage}
            placeholder="12.18"
            onChange={(e) => setVoltage(e.target.value)}
          />
        </Field>
      )}
      {action === "remove" && (
        <Field label="Next status">
          <select value={next} onChange={(e) => setNext(e.target.value)}>
            <option value="COOLING">Cooling</option>
            <option value="TESTING">Testing</option>
            <option value="FLAGGED">Flagged</option>
          </select>
        </Field>
      )}
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          {busy
            ? "Saving…"
            : action === "remove"
              ? "Remove battery"
              : action === "install"
                ? "Install battery"
                : "Mark ready"}
        </button>
      </div>
    </form>
  );
}
function BatteryDetail({
  battery: b,
  data,
  profile,
  busy,
  name,
  eventId,
  save,
  openIssue,
  remove,
}: {
  battery: Battery;
  data: Data;
  profile: Profile;
  busy: boolean;
  name: (id: string | null) => string;
  eventId?: string;
  save: (
    a: string,
    p: Record<string, unknown>,
    close?: boolean,
  ) => Promise<boolean>;
  openIssue: (id: string) => void;
  remove: () => void;
}) {
  const [status, setStatus] = useState(b.status),
    [voltage, setVoltage] = useState(""),
    [kind, setKind] = useState("pre-match"),
    [match, setMatch] = useState(
      b.status === "ON ROBOT" ? batteryMatch(b, data.batteryEvents) : "",
    ),
    [notes, setNotes] = useState("");
  useEffect(() => {
    setStatus(b.status);
  }, [b.status]);
  const history = data.batteryEvents
    .filter((e) => e.battery_id === b.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <>
      <div className="detail-summary">
        <Badge value={b.status} />
        <p>{b.label || "Competition battery"}</p>
        <BatteryMatchLabel battery={b} data={data} />
        {canWork(profile) && b.active && b.status === "ON ROBOT" && (
          <button className="secondary" disabled={busy} onClick={remove}>
            Remove battery
          </button>
        )}
        {b.notes && <p>{b.notes}</p>}
      </div>
      {canWork(profile) && b.active && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await save(
                "transition_battery",
                {
                  id: b.id,
                  expected_status: b.status,
                  status,
                  voltage: voltage === "" ? null : Number(voltage),
                  voltage_kind: kind,
                  match_number: match,
                  notes,
                  event_id: eventId || null,
                },
                false,
              )
            ) {
              setVoltage("");
              setNotes("");
            }
          }}
        >
          <div className="form-grid">
            <Field label="Battery status">
              <Select
                value={status}
                onChange={(v) => setStatus(v as Battery["status"])}
                options={
                  b.status === "ON ROBOT" ? ["ON ROBOT"] : batteryStatuses
                }
              />
            </Field>
            <Field label="Match (optional)">
              <input
                value={match}
                placeholder="e.g. Q34"
                onChange={(e) => setMatch(e.target.value)}
              />
            </Field>
            <Field label="Voltage (optional)">
              <input
                type="number"
                min="0"
                max="20"
                step="0.01"
                inputMode="decimal"
                value={voltage}
                placeholder="12.18"
                onChange={(e) => setVoltage(e.target.value)}
              />
            </Field>
            <Field label="Measurement">
              <Select
                value={kind}
                onChange={setKind}
                options={["pre-match", "post-match"]}
              />
            </Field>
          </div>
          <Field label="Activity notes">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <p className="form-help">
            Voltage is recorded for reference; it does not determine battery
            health. A lead must release flagged batteries. Only admins and
            mentors can retire batteries.
          </p>
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              Save battery activity
            </button>
          </div>
        </form>
      )}
      {isAdmin(profile) && (
        <details>
          <summary>Edit battery details</summary>
          <BatteryForm
            key={b.updated_at}
            battery={b}
            busy={busy}
            submit={(p) => save("save_battery", p, false)}
          />
        </details>
      )}
      <h3 className="history-heading">Battery history · all events</h3>
      <div className="timeline">
        {history.length ? (
          history.map((e) => (
            <div key={e.id}>
              <strong>
                {e.event_type === "issue_linked"
                  ? "Issue linked"
                  : e.from_status === e.to_status
                    ? "Measurement recorded"
                    : `${e.from_status || "Added"} → ${e.to_status || e.event_type.replaceAll("_", " ")}`}
              </strong>
              <small>
                {stamp(e.created_at)} · {name(e.performed_by)} ·{" "}
                {data.events.find((x) => x.id === e.event_id)?.name ||
                  "Outside event"}
              </small>
              {e.voltage !== null && (
                <p>
                  {Number(e.voltage).toFixed(2)} V · {e.voltage_kind}
                </p>
              )}
              {e.match_number && <p>Match: {e.match_number}</p>}
              {e.notes && <p>{e.notes}</p>}
              {e.issue_id && (
                <button
                  className="text-button"
                  onClick={() => openIssue(e.issue_id!)}
                >
                  Issue #
                  {data.issues.find((i) => i.id === e.issue_id)?.issue_number}{" "}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="muted">No activity recorded yet.</p>
        )}
      </div>
    </>
  );
}
function EventForm({
  event: e,
  busy,
  submit,
}: {
  event?: PitEvent;
  busy: boolean;
  submit: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(e?.name || ""),
    [location, setLocation] = useState(e?.location || ""),
    [start, setStart] = useState(e?.start_date || ""),
    [end, setEnd] = useState(e?.end_date || ""),
    [notes, setNotes] = useState(e?.notes || "");
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit({
          id: e?.id,
          name,
          location,
          start_date: start,
          end_date: end,
          notes,
        });
      }}
    >
      <Field label="Event name *">
        <input
          required
          maxLength={150}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Location">
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="Start date *">
          <input
            required
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="End date *">
          <input
            required
            type="date"
            min={start}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          Save event
        </button>
      </div>
    </form>
  );
}
function BatteryForm({
  battery: b,
  busy,
  submit,
}: {
  battery?: Battery;
  busy: boolean;
  submit: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const [number, setNumber] = useState(b?.battery_number || ""),
    [label, setLabel] = useState(b?.label || ""),
    [notes, setNotes] = useState(b?.notes || ""),
    [active, setActive] = useState(b?.active ?? true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          id: b?.id,
          battery_number: number,
          label,
          notes,
          active,
        });
      }}
    >
      <Field label="Battery number *">
        <input
          required
          pattern="B[0-9]{2,4}"
          placeholder="B07"
          value={number}
          onChange={(e) => setNumber(e.target.value.toUpperCase())}
        />
      </Field>
      <Field label="Label">
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Battery notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {b?.status === "RETIRED" && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Keep visible in fleet (uncheck to archive)
        </label>
      )}
      {!b && (
        <p className="form-help">
          New batteries start in TESTING. Mark ready after checking them.
        </p>
      )}
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          Save battery
        </button>
      </div>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
