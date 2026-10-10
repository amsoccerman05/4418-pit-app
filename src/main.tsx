import {ScoutingWorkspace} from './scouting/ScoutingWorkspace';
import {accessFailure,offlineNow,PIT_STALE_MS,PRIVATE_SNAPSHOT_MAX_AGE_MS,UNKNOWN_SAVE} from './connection';
import {isStale} from './competition/feed-state';
import {issueRouteId,isIssueRoute,canDismissCompletedEditor} from './issue-route';
import {PurchaseLinks} from './purchasing/PurchaseLinks';
import type {PurchasingScope} from './purchasing/service';
import {CompetitionWorkspace} from './competition/Workspace';
import {useCompetition} from './competition/service';
import {AuthSurface} from './AuthSurface';
import { SuiteHeader } from './SuiteHeader';
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
  UserRound,
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
  issueOwner,
  canWork,
  canManage,
  isAdmin,
  nextBattery,
  batteryMatch,
} from "./model";
import "./style.css";
const teamEmblem = `${import.meta.env.BASE_URL}branding/4418-impulse-emblem.png`;
const teamWordmark = `${import.meta.env.BASE_URL}branding/4418-impulse-wordmark.png`;
type Page = "dashboard" | "matches" | "issues" | "batteries" | "checklists" | "scouting" | "admin";
type Modal =
  | { kind: "report"; matchId?: string }
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
    [dataReadError, setDataReadError] = useState(""),
    [notice, setNotice] = useState(""),
    [sync, setSync] = useState("Connecting"),
    [lastSync, setLastSync] = useState(""),
    [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [online,setOnline]=useState(!offlineNow()),[clockNow,setClockNow]=useState(Date.now()),[sessionGeneration,setSessionGeneration]=useState(0),[sessionExpiresAt,setSessionExpiresAt]=useState<number|null>(null),[uncertainSave,setUncertainSave]=useState(false);
  const accessEpoch=useRef(0);
  const request=useRef(0),authIdentity=useRef<string|null>(null),authAllowed=useRef(false),expiresAt=useRef<number|null>(null),saving=useRef(false);
  const appLive=useRef(true),accountRequests=useRef(new AbortController());
  useEffect(()=>{appLive.current=true;if(accountRequests.current.signal.aborted)accountRequests.current=new AbortController();return()=>{appLive.current=false;accountRequests.current.abort();};},[]);
  const readPending=useRef<{version:number}|null>(null),appliedIssueRoute=useRef('');
  const invalidateAccess=useCallback((message='Your access could not be verified. Sign in again to load pit data.')=>{
    request.current++;authAllowed.current=false;appliedIssueRoute.current='';accountRequests.current.abort();accountRequests.current=new AbortController();
    accessEpoch.current++;setSessionGeneration(accessEpoch.current);setProfile(null);setData(emptyData());setLastSyncAt(null);setLastSync('');setDataReadError('');setModal(null);setNotice('');setUncertainSave(false);setBusy(false);saving.current=false;setError(message);
  },[]);
  const pitReadOnly=!demo&&(!online||!!dataReadError||uncertainSave||isStale(lastSyncAt,clockNow,PIT_STALE_MS));
  const writeBusy=busy||pitReadOnly;
  const [eventFilter, setEventFilter] = useState("active"),
    [issueFilter, setIssueFilter] = useState("UNRESOLVED"),
    [ownerFilter, setOwnerFilter] = useState("ALL"),
    [batteryFilter, setBatteryFilter] = useState("ALL"),
    [search, setSearch] = useState("");
  const accessCurrent=useCallback(()=>demo||(sessionGeneration===accessEpoch.current&&authAllowed.current&&authIdentity.current===userId&&(!expiresAt.current||expiresAt.current>Date.now())),[demo,userId,sessionGeneration]);
  const competition = useCompetition(profile, data.events.find(e=>e.status==='active')?.id, demo, ['dashboard','matches','scouting','admin'].includes(page),sessionGeneration,pitReadOnly,invalidateAccess,accessCurrent,accountRequests.current.signal);
  const modalIdentity=useRef<Modal>(modal);modalIdentity.current=modal;
  const [issueHash,setIssueHash]=useState(()=>location.hash);
  useEffect(()=>{const changed=()=>setIssueHash(location.hash);window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
  const closeModal=()=>{
    if(!appLive.current)return;
    if(isIssueRoute(location.hash)){history.replaceState(null,'',`${location.pathname}${location.search}`);setIssueHash('');appliedIssueRoute.current='';}
    setModal(null);
  };
  useEffect(()=>{
    if(!profile||loading||!lastSyncAt||dataReadError)return;
    const key=`${profile.id}:${issueHash}`;
    if(!isIssueRoute(issueHash)){if(appliedIssueRoute.current){setModal(current=>current?.kind==='issue'?null:current);appliedIssueRoute.current='';}return;}
    if(appliedIssueRoute.current===key)return;
    appliedIssueRoute.current=key;
    const id=issueRouteId(issueHash),linked=id?data.issues.find(item=>item.id===id):null;
    setPage('issues');
    if(linked){setError('');setModal({kind:'issue',id:linked.id});}
    else{setModal(null);setError('This repair link is unavailable. Open Issues or ask a teammate to check the link.');}
  },[issueHash,profile?.id,loading,lastSyncAt,dataReadError,data.issues]);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      const nextId = session?.user.id || null;
      expiresAt.current=session?.expires_at ? session.expires_at*1000 : null;
      setSessionExpiresAt(expiresAt.current);
      const allowed=!!nextId&&(!expiresAt.current||expiresAt.current>Date.now());
      if (authIdentity.current !== nextId || !allowed) {
        request.current++;
        accessEpoch.current++;setSessionGeneration(accessEpoch.current);
        accountRequests.current.abort();accountRequests.current=new AbortController();
        appliedIssueRoute.current='';
        authIdentity.current = nextId;
        setProfile(null);
        setData(emptyData());
        setLastSyncAt(null);
        setDataReadError("");
        setLastSync('');setNotice('');setError('');setBusy(false);saving.current=false;setUncertainSave(false);
        setModal(null);
      }
      authAllowed.current=allowed;
      setUserId(nextId);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(()=>{
    if(demo||!sessionExpiresAt)return;
    const expire=()=>invalidateAccess('Your session expired. Sign in again to load pit data.');
    if(sessionExpiresAt<=Date.now()){expire();return;}
    const timer=setTimeout(expire,Math.min(sessionExpiresAt-Date.now(),2147483647));return()=>clearTimeout(timer);
  },[sessionExpiresAt,demo,invalidateAccess]);
  useEffect(()=>{
    const update=()=>setClockNow(Date.now());const timer=setInterval(update,5000);window.addEventListener('focus',update);
    return()=>{clearInterval(timer);window.removeEventListener('focus',update);};
  },[]);
  useEffect(()=>{
    if(!demo&&lastSyncAt&&clockNow-lastSyncAt>PRIVATE_SNAPSHOT_MAX_AGE_MS)invalidateAccess('The last loaded pit snapshot expired. Reconnect and sign in again.');
  },[clockNow,lastSyncAt,demo,invalidateAccess]);
  const refresh = useCallback(async (reviewAfterSave=false,supersede=false) => {
    if(!demo&&(!userId||!authAllowed.current||authIdentity.current!==userId))return false;
    if(!demo&&expiresAt.current&&expiresAt.current<=Date.now()){invalidateAccess('Your session expired. Sign in again to load pit data.');return false;}
    if(!demo&&offlineNow()){setDataReadError('Offline. Showing last loaded pit data.');return false;}
    if(!supersede&&readPending.current?.version===request.current)return false;
    const version = ++request.current,signal=accountRequests.current.signal;
    readPending.current={version};setLoading(true);
    const current=()=>appLive.current&&version===request.current&&!signal.aborted&&(demo||(authAllowed.current&&authIdentity.current===userId&&(!expiresAt.current||expiresAt.current>Date.now())));
    try {
      const d = demo ? readDemo() : await fetchData(signal);
      if (!current()) return false;
      const p = demo ? demoProfile(role) : d.profiles.find((p) => p.id === userId && p.active);
      if (!p) {invalidateAccess('Your account needs an active Team 4418 profile. Ask a mentor or admin.');return false;}
      setProfile(p);setData(d);setLastSync(new Date().toLocaleTimeString());setLastSyncAt(Date.now());setClockNow(Date.now());setDataReadError('');if(reviewAfterSave)setUncertainSave(false);
      return true;
    } catch (e) {
      if (current()) {
        if(accessFailure(e)){invalidateAccess();return false;}
        const message=e instanceof Error?e.message:String((e as { message?: string }).message || e);
        setDataReadError(message);
        if(!profile)setError(message);
      }
      return false;
    } finally {if(readPending.current?.version===version)readPending.current=null;if(version===request.current)setLoading(false);}
  }, [demo, role, userId,sessionGeneration,invalidateAccess]);
  useEffect(() => {
    if (!demo && !userId) return;
    void refresh();
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
      setOnline(true);setClockNow(Date.now());
      void refresh();
    };
    const offline = () => {
      setOnline(false);setClockNow(Date.now());request.current++;setLoading(false);
      setDataReadError('Offline. Showing last loaded pit data.');
    };
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
    if (!profile || saving.current) return false;
    if(!demo&&(pitReadOnly||offlineNow()||!accessCurrent())){setError('Read-only. Refresh your connection before saving.');return false;}
    const savedModal=modalIdentity.current,savedHash=location.hash,signal=accountRequests.current.signal;
    const current=()=>appLive.current&&!signal.aborted&&accessCurrent();
    saving.current=true;setBusy(true);setError('');setNotice('');
    try {
      await mutate(demo, profile, action, p,{actorId:profile.id,signal,isCurrent:current});
      if(!current())return false;
      const refreshed=await refresh(false,true);
      if(!current())return false;
      setNotice(refreshed?'Saved successfully':'Saved on the server. The latest view could not be loaded; retry the connection.');
      if(close&&canDismissCompletedEditor(savedModal,modalIdentity.current,savedHash,location.hash))closeModal();
      return true;
    } catch (e) {
      if(!current())return false;
      if(accessFailure(e)){invalidateAccess();return false;}
      setUncertainSave(true);
      setError(UNKNOWN_SAVE);
      return false;
    } finally {if(current()){saving.current=false;setBusy(false);}}
  }
  async function reportMatch(matchId:string,p:Record<string,unknown>){
    const signal=accountRequests.current.signal,savedModal=modalIdentity.current,savedHash=location.hash;
    const current=()=>appLive.current&&!signal.aborted&&accessCurrent();
    try{
      await competition.run('report_issue',{...p,match_id:matchId});
      if(!current())return false;
      const refreshed=await refresh(false,true);
      if(!current())return false;
      setNotice(refreshed?'Saved successfully':'Saved on the server. The latest view could not be loaded; retry the connection.');
      if(canDismissCompletedEditor(savedModal,modalIdentity.current,savedHash,location.hash))closeModal();return true;
    }catch{if(current())setError(UNKNOWN_SAVE);return false;}
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const displayUnverified=pitReadOnly||(!demo&&(!competition.context||!!competition.error||competition.readOnly));
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
      setOwnerFilter("ALL");
    }
    if (p === "batteries") setBatteryFilter(filter || "ALL");
  };
  const exit = async () => {
    if (demo) {
      setDemo(false);
      setProfile(null);
      setData(emptyData());
      setLastSyncAt(null);
      setDataReadError("");
      setModal(null);
    } else {
      invalidateAccess('Signing out…');
      const result = await supabase!.auth.signOut();
      if (result.error) setError(result.error.message);
    }
  };
  if (!authReady)return <AuthSurface/>;
  if(!userId&&!demo){const localDemo=import.meta.env.DEV&&new URLSearchParams(location.search).has('demo');return <AuthSurface redirect={!!supabase&&!localDemo}>{localDemo?<button onClick={()=>setDemo(true)}>Explore local demo</button>:!supabase?<><p role="alert">Unable to connect securely.</p><a href="https://team.frc4418.org/">Team sign in</a></>:undefined}</AuthSurface>;}
  if(!profile)return <><SuiteHeader app="Competition Operations" onSignOut={()=>void exit()}/><section className="login-card"><p role={error?'alert':'status'}>{error||'Loading your account…'}</p><button disabled={!demo&&!authAllowed.current} onClick={()=>void refresh()}>Retry</button><a href="https://team.frc4418.org/">Team sign in</a></section></>;
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
        <span
          className={`issue-owner${i.assigned_to == null ? " unassigned" : ""}`}
        >
          <UserRound size={13} aria-hidden="true" />
          <span>Owner: {issueOwner(i, data.profiles)}</span>
        </span>
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
      <SuiteHeader app="Competition Operations" context={page==='admin'?'Event':page} name={profile.display_name} onSignOut={()=>void exit()}/>
      <aside className="sidebar">
        <div className="nav-caption">COMPETITION OPERATIONS</div>
        <nav>
          {(
            [
              ["dashboard", "Dashboard", LayoutDashboard],
              ["matches", "Matches", Activity],
              ["issues", "Robot / Issues", Wrench],
              ["batteries", "Batteries", BatteryIcon],
              ["checklists", "Checklists", Check],
              ["scouting", "Scouting", Activity],
              ["admin", "Event", Settings],
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

        </div>
      </aside>
      <div className="app">
        <div className="workspace-tools"><span>{!demo&&!online?'Offline':loading?'Refreshing pit data…':sync}</span><button className="icon-button" aria-label="Refresh data" onClick={()=>void refresh(true)}><RefreshCw size={17}/></button></div>
        {import.meta.env.DEV && demo && (
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
          {!demo&&<section className={`connection-status ${pitReadOnly?'connection-stale':''}`} data-testid="connection-status" role="status">
            <div><strong>{!online?'Offline · read-only':pitReadOnly?'Pit data may be stale · read-only':loading?'Refreshing pit data…':'Pit data connected'}</strong>
              <p>Last loaded issues / batteries: {lastSyncAt?new Date(lastSyncAt).toLocaleString():'Not loaded'}</p>
              {(pitReadOnly||dataReadError)&&<p>{uncertainSave?'A save was not confirmed. Refresh and review the record before trying again.':'Showing the last loaded snapshot. Verify status with the pit crew before queueing.'} {page==='scouting'?'Scouting has a separate device-only draft and report queue below.':'Changes are never queued.'}</p>}
              {dataReadError&&online&&<small>{dataReadError}</small>}
            </div><button disabled={loading} onClick={()=>{setError('');void refresh(true);void competition.refresh(true);}}>Retry connection</button>
          </section>}
          {error && !modal && (
            <div role="alert" className="error">
              {error}
              <button
                onClick={() => {
                  setError("");
                  void refresh(true);
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
              <div className="eyebrow">TEAM 4418 / COMPETITION OPERATIONS</div>
              <h1>
                {page === "dashboard"
                  ? "Competition dashboard"
                  : page === "issues"
                    ? "Issue log"
                    : page === "batteries"
                      ? "Battery tracking"
                      : page === "scouting" ? "Scouting" : page === "matches" ? "Matches" : page === "checklists" ? "Checklists" : "Event"}
              </h1>
              <p>
                {page === "dashboard"
                  ? "Everything you need to keep the robot match-ready."
                  : page === "issues"
                    ? "Report, repair, and get back on the field."
                    : page === "batteries"
                      ? "A clear view of every battery, from charger to robot."
                      : page === "scouting" ? "Capture observations and plan your alliance." : "Events and competition batteries."}
              </p>
            </div>
            {page === "batteries"
              ? isAdmin(profile) && (
                  <button
                    className="primary"
                    disabled={writeBusy}
                    onClick={() => {
                      setError("");
                      setModal({ kind: "newBattery" });
                    }}
                  >
                    <Plus size={19} />
                    Add battery
                  </button>
                )
              : (page==="issues" || (page==="dashboard" && !competition.context?.config && !competition.context?.matches.some(m=>m.source==='manual'))) && canWork(profile) && (
                  <button
                    className="primary"
                    disabled={!active || writeBusy}
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
          {page!=='scouting'&&<div className="event-strip">
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
          </div>}
          {page==='scouting'&&<ScoutingWorkspace key={`${profile.id}:${sessionGeneration}`} profile={profile} data={data} competition={competition} demo={demo} scope={{actorId:profile.id,signal:accountRequests.current.signal,isCurrent:accessCurrent}} onAccessFailure={invalidateAccess}/>}
          {!demo && ['dashboard','matches','checklists','admin'].includes(page) && <CompetitionWorkspace page={page} competition={competition} data={data} dataUpdatedAt={lastSyncAt} dataError={dataReadError} profile={profile} go={go} report={matchId=>setModal({kind:'report',matchId})} openIssue={id=>setModal({kind:'issue',id})} batteryAction={id=>setModal({kind:'battery',id})}/>}
          {demo && ['matches','checklists'].includes(page) && <section className="card"><p>Competition event feeds and shared checklists are available in the signed-in team workspace.</p></section>}
          {page === "dashboard" && (demo || !competition.context?.config && !competition.context?.matches.some(m=>m.source==='manual')) && (
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
                      {displayUnverified ? 'VERIFY STATUS' : active ? readiness(currentIssues) : "NO ACTIVE EVENT"}
                    </h2>
                  </div>
                  <p>
                    {active
                      ? `${displayUnverified?'Last recorded: '+readiness(currentIssues)+' · ':''}${open.length} open ${open.length === 1 ? "issue" : "issues"} · ${down.length} robot-down ${down.length === 1 ? "issue" : "issues"}`
                      : "Activate an event to see robot readiness."}
                  </p>
                  <div className="robot-foot">
                    <span>
                      {!active
                        ? "Waiting for event setup"
                        : open.length === 0
                          ? "Robot looks good — no open issues."
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
                      <p>No open issues for this event.</p>
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
                <Field label="Owner">
                  <select
                    value={ownerFilter}
                    onChange={(e) => setOwnerFilter(e.target.value)}
                  >
                    <option value="ALL">All owners</option>
                    <option value="MINE">Mine</option>
                    <option value="UNASSIGNED">Unassigned</option>
                  </select>
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
                        (ownerFilter === "ALL" ||
                          (ownerFilter === "MINE" &&
                            i.assigned_to === profile.id) ||
                          (ownerFilter === "UNASSIGNED" &&
                            i.assigned_to == null)) &&
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
                      <strong>No issues match this view</strong>
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
                              disabled={writeBusy}
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
                              disabled={writeBusy}
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
                      disabled={writeBusy}
                      onClick={() =>
                        void save("activate_event", { id: e.id }, false)
                      }
                    >
                      Activate event
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      disabled={writeBusy}
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
            closeModal();
            setError("");
          }}
        >
          {(pitReadOnly||modal.kind==='report'&&!!modal.matchId&&competition.readOnly)&&<div role="status" className="connection-stale"><p>Read-only snapshot. Reconnect, refresh, and review the current record before saving.</p><button type="button" disabled={loading||competition.refreshing} onClick={()=>{setError('');void refresh(true);void competition.refresh(true);}}>Refresh before retrying save</button></div>}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {modal.kind === "report" && (
            <Report
              data={data}
              busy={writeBusy||!!modal.matchId&&(competition.busy||competition.readOnly)}
              submit={(p) =>
                modal.matchId ? reportMatch(modal.matchId,p) : save("report_issue", { ...p, event_id: active?.id })
              }
            />
          )}{" "}
          {issue && modal.kind === "issue" && (
            <IssueDetail
              key={issue.id}
              issue={issue}
              demo={demo}
              purchaseScope={{actorId:profile.id,signal:accountRequests.current.signal,isCurrent:()=>appLive.current&&authIdentity.current===profile.id&&canDismissCompletedEditor(modal,modalIdentity.current,issueHash,location.hash)}}
              data={data}
              profile={profile}
              busy={writeBusy}
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
              busy={writeBusy}
              eventId={active?.id}
              submit={(p) => save("transition_battery", p)}
            />
          )}
          {battery && modal.kind === "battery" && <div className="card"><strong>Matches assigned to this battery</strong>{competition.context?.matches.filter(m=>m.battery_id===battery.id).map(m=><p key={m.id}>{m.source==='manual'?`${m.manual_label} · Manual`:m.match_key}</p>)}</div>}
          {battery && modal.kind === "battery" && (
            <BatteryDetail
              battery={battery}
              data={data}
              profile={profile}
              busy={writeBusy}
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
              busy={writeBusy}
              submit={(p) => save("save_event", p)}
            />
          )}{" "}
          {modal.kind === "newBattery" && (
            <BatteryForm busy={writeBusy} submit={(p) => save("save_battery", p)} />
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
        4418 <span>COMPETITION OPERATIONS</span>
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
        Use your Team 4418 account. Ask a mentor for account access or
        a password reset. <a href="https://team.frc4418.org/">Team Hub / Home</a>
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
  demo,
  purchaseScope,
  data,
  profile,
  busy,
  name,
  submit,
}: {
  issue: Issue;
  demo: boolean;
  purchaseScope: PurchasingScope;
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
        <p
          className={`issue-owner${i.assigned_to == null ? " unassigned" : ""}`}
        >
          <UserRound size={14} aria-hidden="true" />
          <span>Owner: {issueOwner(i, data.profiles)}</span>
        </p>
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
            ...(draft.assigned_to !== i.assigned_to
              ? { assigned_to: draft.assigned_to }
              : {}),
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
                {draft.assigned_to != null &&
                  !data.profiles.some(
                    (p) => p.id === draft.assigned_to && p.active,
                  ) && (
                    <option value={draft.assigned_to}>
                      {issueOwner(draft, data.profiles)} (current owner)
                    </option>
                  )}
                {data.profiles
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name?.trim() || "Assigned teammate"}
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
      <PurchaseLinks key={`${i.id}:${i.updated_at}:${demo}`} issueId={i.id} issueUpdatedAt={i.updated_at} editable={editable} demo={demo} busy={busy} scope={purchaseScope}/>
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

import "./design-system.css";
