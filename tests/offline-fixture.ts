import { expect, type Page, type Route } from "@playwright/test";

export const privateMarkers = [
  "Private pit repair",
  "Private battery notes",
  "Private operational note",
  "Snapshot preflight",
  "Private crew member",
];

type Call = { path: string; body: any; authorization: string | null };
type HeldRequest = {
  started: Promise<void>;
  release: () => Promise<void>;
};

/** In-memory test server. Every response is captured when its request starts. */
export async function setupOffline(page: Page) {
  const now = Date.now();
  const profile = {
    id: "person",
    display_name: "Private crew member",
    role: "mentor",
    active: true,
  };
  const data: Record<string, any[]> = {
    profiles: [profile],
    pit_events: [
      {
        id: "event",
        name: "Snapshot regional",
        status: "active",
        location: "Test only",
        start_date: "2026-10-01",
        end_date: "2026-10-03",
      },
    ],
    pit_issues: [
      {
        id: "issue",
        issue_number: 1,
        event_id: "event",
        title: "Private pit repair",
        description: "Private pit repair",
        subsystem: "Drivetrain",
        severity: "LOW",
        status: "OPEN",
        reported_by: "person",
        assigned_to: "person",
        discovered_match: "Q17",
        battery_id: null,
        root_cause: "",
        repair_notes: "",
        resolution_notes: "",
        resolved_by: null,
        resolved_at: null,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
    ],
    pit_batteries: [
      {
        id: "battery",
        battery_number: "B01",
        status: "READY",
        active: true,
        label: "Snapshot battery",
        notes: "Private battery notes",
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
    ],
    pit_battery_events: [],
    pit_issue_events: [],
  };
  const context: any = {
    can_manage: true,
    config: {
      event_id: "event",
      team_number: 4418,
      tba_event_key: "2026test",
      nexus_event_key: "demo1234",
      version: 1,
    },
    matches: [
      {
        id: "ops",
        event_id: "event",
        match_key: "2026test_qm17",
        battery_id: "battery",
        note: "Private operational note",
        version: 1,
      },
    ],
    templates: [
      {
        id: "template",
        name: "Snapshot preflight",
        description: "",
        kind: "pre",
        active: true,
        version: 1,
        items: [
          {
            text: "Latch check",
            required: true,
            blocking: true,
            area_id: null,
          },
        ],
      },
    ],
    runs: [
      {
        id: "run",
        match_id: "ops",
        name: "Snapshot preflight",
        kind: "pre",
        template_version: 1,
        started_at: new Date(now).toISOString(),
        started_by: "person",
      },
    ],
    items: [
      {
        id: "item",
        run_id: "run",
        text: "Latch check",
        required: true,
        blocking: true,
        area_id: null,
        completed_at: null,
        completed_by: null,
        display_order: 0,
        version: 1,
      },
    ],
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
    scheduled: now + 1800000,
    predicted: null,
    actual: null,
    completed: false,
    redScore: null,
    blueScore: null,
    winner: "",
  };
  const feed: any = {
    eventId: "event",
    configured: true,
    configVersion: 1,
    eventKey: "2026test",
    team: 4418,
    eventName: "Snapshot regional",
    matches: [match],
    tbaAt: now,
    tbaError: null,
    nexus: {
      asOf: now,
      nowQueuing: "Qualification 17",
      announcements: [],
      matches: [
        {
          label: "Qualification 17",
          status: "Now queuing",
          red: match.red,
          blue: match.blue,
          queue: now + 600000,
          estimated: now + 1200000,
          committed: null,
          replayOf: null,
        },
      ],
    },
    nexusAt: now,
    nexusError: null,
  };
  const calls: Call[] = [];
  const errors = new Map<string, string>();
  const holds = new Map<
    string,
    { started: () => void; gate: Promise<void>; finished: () => void }[]
  >();
  let lostWrite: string | null = null;

  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as any).__persistedWrites = writes;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      writes.push(`${key}:${value}`);
      return setItem.call(this, key, value);
    };
    for (const method of ["add", "put"] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args: any[]) {
        writes.push(JSON.stringify(args));
        return original.apply(this, args as [any, IDBValidKey?]);
      };
    }
    if (typeof Cache !== "undefined") {
      const put = Cache.prototype.put;
      Cache.prototype.put = async function (request, response) {
        writes.push(await response.clone().text());
        return put.call(this, request, response);
      };
    }
  });
  // No test is allowed to contact a live Team 4418 or external API endpoint.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.route("https://team.frc4418.org/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Team sign in</h1>" }),
  );
  await page.route("**/src/client.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
      const callbacks = new Set(), channels = new Set();
      let session = { user: { id: 'person' }, expires_at: Math.floor(Date.now() / 1000) + 3600, access_token: 'fixture-token-person' };
      const emitAuth = (event, id, expiresAt) => {
        session = id ? { user: { id }, expires_at: expiresAt ?? Math.floor(Date.now() / 1000) + 3600, access_token: 'fixture-token-' + id } : null;
        for (const callback of callbacks) callback(event, session);
      };
      window.__offlineFixture = {
        emitAuth,
        emitRealtime(table = 'pit_events') { for (const channel of channels) for (const listener of channel.listeners) if (listener.table === table) listener.callback({}); },
      };
      const request = async (path, body, signal, headers) => {
        try {
          if (!navigator.onLine) throw new Error('Network unavailable');
          const response = await fetch('/offline-fixture/' + path, { method: 'POST', body: JSON.stringify(body), signal, headers });
          return await response.json();
        } catch (error) { return { data: null, error: { message: error.message, name: error.name } }; }
      };
      const query = (path, body) => ({
        signal: undefined, headers: {},
        select() { return this; }, order() { return this; }, range() { return this; },
        setHeader(name, value) { this.headers[name] = value; return this; },
        abortSignal(signal) { this.signal = signal; return this; },
        then(resolve, reject) { return request(path, body, this.signal, this.headers).then(resolve, reject); },
      });
      export const configured = true, configError = '';
      export const supabase = {
        auth: {
          onAuthStateChange(callback) { callbacks.add(callback); queueMicrotask(() => callbacks.has(callback) && callback('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() { callbacks.delete(callback); } } } }; },
          async getSession() { return { data: { session }, error: null }; },
          async signOut() { emitAuth('SIGNED_OUT', null); return { error: null }; },
        },
        from(table) { return query('table/' + table, {}); },
        rpc(name, args) { return query('rpc/' + name, args); },
        functions: { invoke(name, args) { return request('feed', args, args?.signal); } },
        channel() { const channel = { listeners: [], on(event, filter, callback) { this.listeners.push({ table: filter.table, callback }); return this; }, subscribe(callback) { channels.add(this); queueMicrotask(() => callback?.('SUBSCRIBED')); return this; } }; return channel; },
        removeChannel(channel) { channels.delete(channel); },
      };
    `,
    }),
  );

  function applyWrite(path: string, body: any) {
    if (path === "rpc/pit_transition_battery") {
      const battery = data.pit_batteries.find((row) => row.id === body.p.id);
      if (battery) battery.status = body.p.status;
      data.pit_battery_events.push({
        id: `change-${data.pit_battery_events.length}`,
        battery_id: body.p.id,
        event_type: "status_changed",
        from_status: body.p.expected_status,
        to_status: body.p.status,
        match_number: "",
        created_at: new Date().toISOString(),
        performed_by: "person",
      });
    } else if (
      path === "rpc/pit_competition_manage" &&
      body.action === "item"
    ) {
      Object.assign(
        context.items.find((row: any) => row.id === body.p.id),
        {
          completed_at: body.p.complete ? new Date().toISOString() : null,
          completed_by: "person",
          version: body.p.version + 1,
        },
      );
    }
  }

  await page.route("**/offline-fixture/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/offline-fixture/",
    )[1];
    const body = route.request().postDataJSON();
    calls.push({
      path,
      body,
      authorization: route.request().headers()["authorization"] || null,
    });
    let result: any = null;
    if (path.startsWith("table/")) result = data[path.slice(6)] || [];
    else if (path === "rpc/pit_competition_context") result = context;
    else if (path === "feed") result = feed;
    else applyWrite(path, body);
    const response = structuredClone({
      data: errors.has(path) ? null : result,
      error: errors.has(path) ? { message: errors.get(path) } : null,
    });
    const hold = holds.get(path)?.shift();
    if (hold) {
      hold.started();
      await hold.gate;
    }
    if (lostWrite === path) {
      lostWrite = null;
      await route.abort("failed").finally(() => hold?.finished());
      return;
    }
    // Cancellation is an expected outcome for held reads after logout/timeout.
    await route
      .fulfill({ json: response })
      .catch(() => {})
      .finally(() => hold?.finished());
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Competition dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".comp-next")).toContainText("Q17");
  await expect(page.locator(".comp-feed")).toContainText("Nexus live");

  return {
    data,
    context,
    feed,
    calls,
    errors,
    count: (path: string) => calls.filter((call) => call.path === path).length,
    writes: () =>
      calls.filter(
        (call) =>
          call.path.startsWith("rpc/") &&
          call.path !== "rpc/pit_competition_context",
      ),
    loseNextWrite(path: string) {
      lostWrite = path;
    },
    holdNext(path: string): HeldRequest {
      let started!: () => void, release!: () => void, finished!: () => void;
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const completion = new Promise<void>((resolve) => {
        finished = resolve;
      });
      const queue = holds.get(path) || [];
      queue.push({ started, gate, finished });
      holds.set(path, queue);
      return {
        started: startedPromise,
        release: () => {
          release();
          return completion;
        },
      };
    },
  };
}

export const navigate = (page: Page, name: string) =>
  page
    .locator(".sidebar nav")
    .getByRole("button", { name, exact: true })
    .click();

export async function assertPrivateDataNotPersisted(page: Page) {
  const persisted = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      writes: (window as any).__persistedWrites,
    }),
  );
  for (const marker of privateMarkers) expect(persisted).not.toContain(marker);
}

export async function emitAuth(
  page: Page,
  id: string | null,
  expiresAt?: number,
) {
  await page.evaluate(
    ({ id, expiresAt }) =>
      (window as any).__offlineFixture.emitAuth(
        id ? "SIGNED_IN" : "SIGNED_OUT",
        id,
        expiresAt,
      ),
    { id, expiresAt },
  );
}

export async function refreshStorm(page: Page) {
  await page.evaluate(() => {
    for (let index = 0; index < 10; index++) {
      window.dispatchEvent(new Event("focus"));
      (window as any).__offlineFixture.emitRealtime();
    }
  });
}
