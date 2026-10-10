import { expect, type Page, type TestInfo } from "@playwright/test";
import {
  initialData,
  type Observation,
  type ScoutingContext,
} from "../src/scouting/model";

export const actorId = "10000000-0000-4000-8000-000000000001";
export const otherActorId = "10000000-0000-4000-8000-000000000002";
export const eventId = "20000000-0000-4000-8000-000000000001";
export const historicalEventId = "20000000-0000-4000-8000-000000000002";
export const reportId = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function observation(
  n: number,
  team: number,
  overrides: Record<string, unknown> = {},
  kind: "match" | "pit" = "match",
): Observation {
  return {
    id: reportId(n),
    event_id: eventId,
    kind,
    team_number: team,
    match_key: kind === "match" ? `qm${n}` : null,
    data: {
      ...initialData(kind),
      ...(kind === "match" ? { match_label: `Q${n}` } : {}),
      ...overrides,
    },
    created_by: actorId,
    created_at: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(),
  };
}
type Call = { path: string; body: any; authorization: string | null };

/** Synthetic, same-origin RPC server. Live Team 4418 and third-party requests are blocked. */
export async function setupScouting(
  page: Page,
  options: {
    role?: "mentor" | "student" | "readonly";
    observations?: Observation[];
    canManage?: boolean;
  } = {},
) {
  const role = options.role || "mentor";
  const state: ScoutingContext = {
    can_scout: role !== "readonly",
    can_manage: options.canManage ?? role === "mentor",
    observations: options.observations || [],
    assignments: [],
    picklist: [],
  };
  const profiles = [
    { id: actorId, display_name: "Fixture Scout A", role, active: true },
    {
      id: otherActorId,
      display_name: "Fixture Scout B",
      role: "student",
      active: true,
    },
  ];
  const data: Record<string, any[]> = {
    profiles,
    pit_events: [
      {
        id: eventId,
        name: "Synthetic Regional",
        status: "active",
        start_date: "2026-10-01",
        end_date: "2026-10-03",
        location: "Local test only",
      },
      {
        id: historicalEventId,
        name: "Synthetic Previous Event",
        status: "completed",
        start_date: "2026-09-01",
        end_date: "2026-09-03",
        location: "Local test only",
      },
    ],
    pit_issues: [],
    pit_batteries: [],
    pit_battery_events: [],
    pit_issue_events: [],
  };
  const competition = {
    can_manage: options.canManage ?? role === "mentor",
    config: {
      event_id: eventId,
      team_number: 4418,
      tba_event_key: "2026test",
      nexus_event_key: "demo1234",
      version: 1,
    },
    matches: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        event_id: eventId,
        match_key: "p1",
        manual_label: "Practice 1",
        source: "manual",
        archived_at: null,
        version: 1,
      },
    ],
    templates: [],
    runs: [],
    items: [],
    links: [],
    areas: [],
  };
  const match = {
    key: "2026test_qm17",
    label: "Q17",
    level: "qm",
    number: 17,
    set: 1,
    red: ["4418", "1619", "1339"],
    blue: ["2996", "3648", "4593"],
    alliance: "red",
    scheduled: Date.now() + 1800000,
    predicted: null,
    actual: null,
    completed: false,
    redScore: null,
    blueScore: null,
    winner: "",
  };
  const feed = {
    eventId,
    configured: true,
    configVersion: 1,
    eventKey: "2026test",
    team: 4418,
    eventName: "Synthetic Regional",
    matches: [match],
    tbaAt: Date.now(),
    tbaError: null,
    nexus: null,
    nexusAt: null,
    nexusError: "Synthetic feed",
  };
  const calls: Call[] = [],
    pageErrors: string[] = [];
  let ambiguousNextSubmit = false,
    rejectedNextManage = false;
  const holds = new Map<
    string,
    { started: () => void; gate: Promise<void>; finished: () => void }[]
  >();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/src/client.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    const callbacks = new Set();
    let session = {user: {id: '${actorId}'}, access_token: 'fixture-token-${actorId}', expires_at: Math.floor(Date.now()/1000)+3600};
    const emitAuth = id => {session = id ? {user:{id}, access_token:'fixture-token-'+id, expires_at:Math.floor(Date.now()/1000)+3600} : null; for(const cb of callbacks) cb(id ? 'SIGNED_IN' : 'SIGNED_OUT',session);};
    window.__scoutingFixture = {emitAuth};
    const request = async(path,body,signal,headers) => {try {if(!navigator.onLine) throw new Error('Network unavailable'); const r = await fetch('/scouting-fixture/'+path,{method:'POST',body:JSON.stringify(body),signal,headers}); return await r.json();} catch(e) {return {data:null,error:{message:e.message,name:e.name}};}};
    const query = (path,body) => ({signal:undefined,headers:{},select(){return this},order(){return this},range(){return this},setHeader(k,v){this.headers[k]=v;return this},abortSignal(signal){this.signal=signal;return this},then(resolve,reject){return request(path,body,this.signal,this.headers).then(resolve,reject)}});
    export const configured=true,configError='';
    export const supabase={auth:{onAuthStateChange(cb){callbacks.add(cb);queueMicrotask(()=>callbacks.has(cb)&&cb('INITIAL_SESSION',session));return {data:{subscription:{unsubscribe(){callbacks.delete(cb)}}}}},async getSession(){return {data:{session},error:null}},async signOut(){emitAuth(null);return {error:null}}},from(table){return query('table/'+table,{})},rpc(name,args){return query('rpc/'+name,args)},functions:{invoke(name,args){return request('feed',args,args?.signal)}},channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){}};
  `,
    }),
  );
  await page.route("**/scouting-fixture/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
        "/scouting-fixture/",
      )[1],
      body = route.request().postDataJSON();
    const authorization = route.request().headers().authorization || null;
    calls.push({ path, body, authorization });
    let result: any = null,
      error: any = null;
    if (path.startsWith("table/")) result = data[path.slice(6)] || [];
    else if (path === "feed") result = feed;
    else if (path === "rpc/pit_competition_context") result = competition;
    else if (path === "rpc/pit_scouting_context") {
      const isOther = authorization?.endsWith(otherActorId);
      result = {
        ...state,
        can_scout: isOther || state.can_scout,
        can_manage: !isOther && state.can_manage,
        observations: state.observations.filter(
          (o) => o.event_id === body.event_id,
        ),
        assignments: state.assignments.filter(
          (a) => a.event_id === body.event_id,
        ),
        picklist: state.picklist.filter((p) => p.event_id === body.event_id),
      };
    } else if (path === "rpc/pit_scouting_submit") {
      const p = body.p;
      if (!state.observations.some((o) => o.id === p.id))
        state.observations.push({
          ...structuredClone(p),
          created_by: authorization?.endsWith(otherActorId)
            ? otherActorId
            : actorId,
          created_at: new Date().toISOString(),
        });
      result = ambiguousNextSubmit ? null : p.id;
      ambiguousNextSubmit = false;
    } else if (path === "rpc/pit_scouting_manage") {
      if (rejectedNextManage) {
        rejectedNextManage = false;
        error = { message: "This pick changed. Refresh before saving again." };
      } else if (body.action === "picklist") {
        const p = body.p,
          existing = state.picklist.find(
            (x) => x.event_id === p.event_id && x.team_number === p.team_number,
          );
        if (existing)
          Object.assign(existing, p, { version: existing.version + 1 });
        else
          state.picklist.push({
            ...p,
            id: reportId(100 + state.picklist.length),
            version: 1,
          });
        result = state.picklist.find(
          (x) => x.event_id === p.event_id && x.team_number === p.team_number,
        )!.id;
      } else if (body.action === "assignment") {
        const p = body.p,
          existing = state.assignments.find(
            (x) =>
              x.event_id === p.event_id &&
              x.team_number === p.team_number &&
              x.kind === p.kind &&
              x.match_key === p.match_key,
          );
        if (existing)
          Object.assign(existing, p, { version: existing.version + 1 });
        else
          state.assignments.push({
            ...p,
            id: reportId(200 + state.assignments.length),
            version: 1,
          });
        result = state.assignments.find(
          (x) =>
            x.event_id === p.event_id &&
            x.team_number === p.team_number &&
            x.kind === p.kind &&
            x.match_key === p.match_key,
        )!.id;
      }
    } else throw new Error(`Unexpected fixture RPC: ${path}`);
    const response = structuredClone({ data: result, error });
    const hold = holds.get(path)?.shift();
    if (hold) {
      hold.started();
      await hold.gate;
    }
    await route
      .fulfill({ json: response })
      .catch(() => {})
      .finally(() => hold?.finished());
  });
  // ?demo only prevents the suite's real sign-in redirect after a fixture logout.
  await page.goto("/?demo");
  await expect(
    page.getByRole("heading", { name: "Competition dashboard", exact: true }),
  ).toBeVisible();
  await navigateScouting(page);
  await expect(page.locator(".scout-sync")).toContainText("Team data checked");
  return {
    state,
    data,
    competition,
    calls,
    pageErrors,
    submissions: () =>
      calls.filter((c) => c.path === "rpc/pit_scouting_submit"),
    mutations: () =>
      calls.filter((c) =>
        ["rpc/pit_scouting_submit", "rpc/pit_scouting_manage"].includes(c.path),
      ),
    ambiguousSubmit() {
      ambiguousNextSubmit = true;
    },
    rejectManage() {
      rejectedNextManage = true;
    },
    holdNext(path: string) {
      let started!: () => void, release!: () => void, finished!: () => void;
      const begun = new Promise<void>((resolve) => {
          started = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        ended = new Promise<void>((resolve) => {
          finished = resolve;
        });
      holds.set(path, [
        ...(holds.get(path) || []),
        { started, gate, finished },
      ]);
      return {
        started: begun,
        release: () => {
          release();
          return ended;
        },
      };
    },
  };
}
export const navigateScouting = (page: Page) =>
  page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Scouting", exact: true })
    .click();
export const scoutTab = (page: Page, name: string | RegExp) =>
  page
    .getByRole("navigation", { name: "Scouting sections" })
    .getByRole("button", { name, exact: typeof name === "string" })
    .click();
export const emitScoutingAuth = (page: Page, id: string | null) =>
  page.evaluate((id) => (window as any).__scoutingFixture.emitAuth(id), id);
export async function fillMatch(page: Page, team = "1619", match = "qm17") {
  await page
    .getByRole("button", { name: "New match report", exact: true })
    .click();
  await page.getByLabel("Team number", { exact: true }).fill(team);
  await page.getByLabel("Match ID", { exact: true }).fill(match);
  await page
    .getByLabel("Match label", { exact: true })
    .fill(`Qualification ${match.replace("qm", "")}`);
}
export async function captureScouting(
  page: Page,
  info: TestInfo,
  name: string,
) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const path = info.outputPath(`scouting-${name}-${info.project.name}.png`);
  await page.screenshot({
    path,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  await info.attach(name, { path, contentType: "image/png" });
}
