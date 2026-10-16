import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext } from "@playwright/test";

const hub = "https://team.frc4418.org";
const pit = "https://pit.frc4418.org";
const streamOrigins = [
  "https://www.youtube-nocookie.com",
  "https://player.twitch.tv",
];
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// Serve the real index policy and suite client at their production origins, but
// fulfill every browser request locally. No production login, token, or data is
// used, and Chromium's normal CSP enforcement remains enabled.
async function setup(context: BrowserContext, baseURL: string) {
  const unexpected: string[] = [];
  const brokerLoads: string[] = [];
  await context.addInitScript(() => {
    (window as any).policyViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as any).policyViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      });
    });
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === hub && url.pathname === "/suite-auth.html") {
      brokerLoads.push(route.request().url());
      await route.fulfill({
        contentType: "text/html",
        body: `<title>Local session broker</title><script>
          const protocol = '4418-suite-auth-v1';
          let session = { access_token: 'local-policy-fixture',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: { id: 'local-policy-user' } };
          window.fixtureError = false;
          window.setFixtureSession = next => { session = next; };
          addEventListener('message', (event) => {
            if (event.source !== parent ||
                !${JSON.stringify([hub, pit])}.includes(event.origin) ||
                event.data?.protocol !== protocol) return;
            const { id, method } = event.data;
            if (method !== 'getSession' && method !== 'signOut') return;
            if (method === 'signOut') session = null;
            event.source.postMessage({ protocol, id,
              result: { data: { session }, error: window.fixtureError ? {message: 'Temporary connection failure'} : null } }, event.origin);
            if (method === 'signOut') event.source.postMessage({ protocol,
              event: 'SIGNED_OUT', session: null }, event.origin);
          });
        </script>`,
      });
      return;
    }
    if (streamOrigins.includes(url.origin)) {
      await route.fulfill({
        contentType: "text/html",
        body: "<h1>Local stream fixture</h1>",
      });
      return;
    }
    if ([hub, pit].includes(url.origin)) {
      if (url.pathname === "/") {
        await route.fulfill({
          contentType: "text/html",
          body: index.replaceAll("%BASE_URL%", "./"),
        });
        return;
      }
      if (url.pathname === "/src/main.tsx") {
        await route.fulfill({
          contentType: "application/javascript",
          body: `import { createSuiteClient } from '/src/suite-auth.ts';
            document.getElementById('root').innerHTML =
              '<h1>Suite policy fixture</h1><output id="session">Connecting</output>' +
              '<a href="${pit}/">Open Pit</a><button id="refresh">Refresh session</button>' +
              '<button id="signout">Sign out fixture</button>';
            const client = createSuiteClient('https://local-policy.supabase.invalid', 'local-public-key');
            window.fixtureClient = client; window.authEvents = [];
            client.auth.onAuthStateChange((_event, session) => {
              window.authEvents.push({event: _event, token: session?.access_token});
              document.getElementById('session').dataset.token = session?.access_token || '';
              document.getElementById('session').textContent = session?.user.id || 'signed-out';
            });
            document.getElementById('refresh').onclick = async () => {
              const result = await client.auth.getSession();
              document.getElementById('session').textContent = result.error
                ? 'error' : result.data.session?.user.id || 'signed-out';
            };
            document.getElementById('signout').onclick = () => client.auth.signOut();`,
        });
        return;
      }
      // Vite transforms the unchanged real client and its SDK dependency. The
      // page uses the raw index above, so it never opens a Vite HMR websocket.
      if (
        url.pathname === "/src/suite-auth.ts" ||
        url.pathname.startsWith("/node_modules/.vite/deps/") ||
        url.pathname.startsWith("/branding/")
      ) {
        const response = await context.request.get(
          baseURL + url.pathname + url.search,
        );
        await route.fulfill({ response });
        return;
      }
    }
    unexpected.push(route.request().url());
    await route.abort();
  });
  return { unexpected, brokerLoads };
}

test("frame policy contains only the shared broker and existing stream origins", () => {
  const policy = index.match(
    /http-equiv="Content-Security-Policy" content="([^"]+)"/,
  )?.[1];
  expect(policy).toBeDefined();
  const frames = policy!
    .split(";")
    .find((directive) => directive.trim().startsWith("frame-src "))!;
  expect(frames.trim().split(/\s+/).slice(1).sort()).toEqual(
    [hub, ...streamOrigins].sort(),
  );
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
});

test("direct-open Pit loads the shared frame and receives a session on repeated visits", async ({
  page,
  context,
  baseURL,
}) => {
  const { unexpected, brokerLoads } = await setup(context, baseURL!);
  for (let visit = 0; visit < 2; visit += 1) {
    await page.goto(pit + "/");
    await expect(page.locator("#session")).toHaveText("local-policy-user");
    await expect(
      page.locator('iframe[title="Team 4418 secure session"]'),
    ).toHaveAttribute("src", hub + "/suite-auth.html");
    await page.getByRole("button", { name: "Refresh session" }).click();
    await expect(page.locator("#session")).toHaveText("local-policy-user");
    expect(await page.evaluate(() => (window as any).policyViolations)).toEqual(
      [],
    );
  }
  expect(brokerLoads).toHaveLength(2);
  await page.getByRole("button", { name: "Sign out fixture" }).click();
  await expect(page.locator("#session")).toHaveText("signed-out");
  expect(unexpected).toEqual([]);
});

test("Hub opener handoff stays first-party, reconnects after Hub reload, and propagates sign-out", async ({
  page,
  context,
  baseURL,
}) => {
  const { unexpected, brokerLoads } = await setup(context, baseURL!);
  await page.goto(hub + "/");
  await expect(page.locator("#session")).toHaveText("local-policy-user");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open Pit" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(pit + "/");
  await expect(popup.locator("#session")).toHaveText("local-policy-user");
  await expect(popup.locator("iframe")).toHaveCount(0);
  expect(await popup.evaluate(() => new URL(document.referrer).origin)).toBe(
    hub,
  );
  expect(brokerLoads).toHaveLength(1);
  await page.reload();
  await expect(page.locator("#session")).toHaveText("local-policy-user");
  await popup.getByRole("button", { name: "Refresh session" }).click();
  await expect
    .poll(() => popup.locator("#session").textContent())
    .toBe("local-policy-user");
  await popup.getByRole("button", { name: "Sign out fixture" }).click();
  await expect(popup.locator("#session")).toHaveText("signed-out");
  await expect(page.locator("#session")).toHaveText("signed-out");
  expect(await popup.evaluate(() => (window as any).policyViolations)).toEqual(
    [],
  );
  expect(unexpected).toEqual([]);
});

test("existing stream frames load while unrelated and lookalike origins remain blocked", async ({
  page,
  context,
  baseURL,
}) => {
  const { unexpected } = await setup(context, baseURL!);
  await page.goto(pit + "/");
  await expect(page.locator("#session")).toHaveText("local-policy-user");
  for (const origin of streamOrigins) {
    await page.evaluate((origin) => {
      const frame = document.createElement("iframe");
      frame.title = origin;
      frame.src = origin + "/fixture";
      document.body.append(frame);
    }, origin);
    await expect(
      page
        .frameLocator(`iframe[title="${origin}"]`)
        .getByRole("heading", { name: "Local stream fixture" }),
    ).toBeVisible();
  }
  expect(await page.evaluate(() => (window as any).policyViolations)).toEqual(
    [],
  );
  for (const origin of [
    "https://unrelated.example",
    "https://team.frc4418.org.example",
    "https://sub.team.frc4418.org",
    "http://team.frc4418.org",
  ]) {
    await page.evaluate((origin) => {
      const frame = document.createElement("iframe");
      frame.src = origin + "/blocked";
      document.body.append(frame);
    }, origin);
    await expect
      .poll(() => page.evaluate(() => (window as any).policyViolations))
      .toContainEqual({ directive: "frame-src", blocked: origin });
  }
  expect(unexpected).toEqual([]);
});


test("closing Hub preserves a valid session through the existing frame, without fabricated sign-out", async ({page,context,baseURL}) => {
 const {unexpected}=await setup(context,baseURL!);
 await page.goto(hub+'/');
 await expect(page.locator('#session')).toHaveText('local-policy-user');
 const opened=page.waitForEvent('popup');await page.getByRole('link',{name:'Open Pit'}).click();const popup=await opened;
 await expect(popup.locator('#session')).toHaveText('local-policy-user');
 await page.close();
 await popup.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(popup.locator('iframe')).toHaveCount(1);
 await expect(popup.locator('#session')).toHaveText('local-policy-user');
 expect(await popup.evaluate(()=>(window as any).authEvents.some((e:any)=>e.event==='SIGNED_OUT'))).toBe(false);
 await popup.getByRole('button',{name:'Sign out fixture'}).click();
 await expect(popup.locator('#session')).toHaveText('signed-out');
 expect(unexpected).toEqual([]);
});

test("direct visits reconcile a missed refresh and confirmed revocation on resume", async ({page,context,baseURL}) => {
 await setup(context,baseURL!);await page.goto(pit+'/');
 await expect(page.locator('#session')).toHaveText('local-policy-user');
 const broker=page.frames().find(f=>f.url()===hub+'/suite-auth.html')!;
 await broker.evaluate(()=>(window as any).setFixtureSession({access_token:'refreshed-fixture-token',expires_at:Math.floor(Date.now()/1000)+7200,user:{id:'local-policy-user'}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('#session')).toHaveAttribute('data-token','refreshed-fixture-token');
 await broker.evaluate(()=>(window as any).fixtureError=true);
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForTimeout(100);
 await expect(page.locator('#session')).toHaveText('local-policy-user');
 await broker.evaluate(()=>{(window as any).fixtureError=false;(window as any).setFixtureSession(null);});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('#session')).toHaveText('signed-out');
});

test("same-origin unrelated source cannot forge a broker auth event", async ({page,context,baseURL}) => {
 await setup(context,baseURL!);await page.goto(hub+'/');
 await expect(page.locator('#session')).toHaveText('local-policy-user');
 await page.evaluate(()=>window.postMessage({protocol:'4418-suite-auth-v1',event:'SIGNED_OUT',session:null},location.origin));
 await page.waitForTimeout(100);
 await expect(page.locator('#session')).toHaveText('local-policy-user');
 expect(await page.evaluate(()=>(window as any).authEvents.some((e:any)=>e.event==='SIGNED_OUT'))).toBe(false);
});
