import { test, expect, type Page } from "@playwright/test";
import type { Issue, Profile } from "../src/model";

const longName = "Alexandra Montgomery-Washington, drivetrain lead";
async function setup(page: Page, role: Profile["role"] = "mentor") {
  const profile: Profile = {
    id: "me",
    display_name: "Jamie Chen",
    role,
    active: true,
  };
  const profiles: Profile[] = [
    profile,
    { id: "other", display_name: longName, role: "lead", active: true },
    {
      id: "inactive",
      display_name: "Former teammate",
      role: "student",
      active: false,
    },
    { id: "blank", display_name: "   ", role: "student", active: true },
  ];
  let number = 0;
  const issue = (
    id: string,
    title: string,
    assigned_to: string | null,
    severity: Issue["severity"] = "LOW",
    status: Issue["status"] = "OPEN",
    event_id = "active-event",
  ): Issue => ({
    id,
    title,
    assigned_to,
    severity,
    status,
    event_id,
    issue_number: ++number,
    subsystem: "Drivetrain",
    description: `${title} description`,
    reported_by: "me",
    discovered_match: "Q17",
    root_cause: "",
    repair_notes: "",
    resolution_notes: "",
    resolved_by: null,
    resolved_at: null,
    battery_id: null,
    created_at: "2026-10-05T10:00:00Z",
    updated_at: "2026-10-05T10:00:00Z",
  });
  const issues = [
    issue("mine-open", "My drivetrain repair", "me", "ROBOT DOWN"),
    issue("mine-deferred", "My deferred inspection", "me", "HIGH", "DEFERRED"),
    issue(
      "mine-resolved",
      "My completed repair",
      "me",
      "ROBOT DOWN",
      "RESOLVED",
    ),
    issue("teammate", "Teammate repair", "other", "HIGH"),
    issue("unassigned", "Unclaimed repair", null, "MEDIUM"),
    issue(
      "unassigned-down",
      "Unclaimed deferred repair",
      null,
      "ROBOT DOWN",
      "DEFERRED",
    ),
    issue("unknown", "Unavailable owner repair", "unknown"),
    issue("inactive", "Inactive owner repair", "inactive"),
    issue("blank", "Unnamed owner repair", "blank"),
    issue(
      "old-mine",
      "Earlier event repair",
      "me",
      "HIGH",
      "OPEN",
      "previous-event",
    ),
    issue(
      "old-unassigned",
      "Earlier unclaimed repair",
      null,
      "ROBOT DOWN",
      "OPEN",
      "previous-event",
    ),
  ];
  const events = [
    {
      id: "active-event",
      name: "Current regional",
      status: "active",
      location: "Test only",
      start_date: "2026-10-05",
      end_date: "2026-10-07",
    },
    {
      id: "previous-event",
      name: "Previous regional",
      status: "completed",
      location: "Test only",
      start_date: "2026-09-01",
      end_date: "2026-09-03",
    },
  ];
  const tables: Record<string, unknown[]> = {
    profiles,
    pit_events: events,
    pit_issues: issues,
    pit_batteries: [],
    pit_battery_events: [],
    pit_issue_events: [],
  };
  const context = {
    can_manage: role === "mentor",
    config: null,
    matches: [],
    templates: [],
    runs: [],
    items: [],
    links: [],
    areas: [],
  };
  const calls: { name: string; p: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/src/client.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `const request=async(path,body)=>{const response=await fetch('/ownership-fixture/'+path,{method:'POST',body:JSON.stringify(body)});return response.json()};
      export const configured=true,configError='';
      export const supabase={
        auth:{onAuthStateChange(callback){queueMicrotask(()=>callback('SIGNED_IN',{user:{id:'me'}}));return {data:{subscription:{unsubscribe(){}}}}},async signOut(){return {error:null}}},
        from(table){return {select(){return this},order(){return this},range(){return request('table/'+table,{})}}},
        rpc(name,args){return request('rpc/'+name,args)},functions:{invoke(name,args){return request('feed',args)}},
        channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){}};`,
    }),
  );
  await page.route("**/ownership-fixture/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/ownership-fixture/",
    )[1];
    let result: unknown = null;
    let error: { message: string } | null = null;
    if (path.startsWith("table/")) result = tables[path.slice(6)] || [];
    else if (path === "feed")
      result = {
        eventId: "active-event",
        configured: false,
        matches: [],
        tbaAt: null,
        tbaError: null,
        nexus: null,
        nexusAt: null,
        nexusError: null,
      };
    else if (path === "rpc/pit_competition_context") result = context;
    else if (path === "rpc/pit_update_issue") {
      const { p } = route.request().postDataJSON();
      calls.push({ name: "pit_update_issue", p });
      if (
        p.assigned_to &&
        !profiles.some((member) => member.id === p.assigned_to && member.active)
      ) {
        error = { message: "Assignee must be an active team member" };
      } else {
        Object.assign(
          issues.find((item) => item.id === p.id)!,
          p,
          { updated_at: new Date().toISOString() },
        );
      }
    }
    await route.fulfill({ json: { data: result, error } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Competition dashboard" }),
  ).toBeVisible();
  return { issues, events, calls, errors };
}

const nav = (page: Page, name: string) =>
  page
    .locator(".sidebar nav button")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
const row = (page: Page, title: string) =>
  page
    .locator(".issue-row")
    .filter({ has: page.getByText(title, { exact: true }) });
async function expectTitles(page: Page, titles: string[]) {
  await expect(page.locator(".issue-row .issue-copy > strong")).toHaveText(
    titles,
  );
}

test("owners are visible in issue rows and details, including unavailable profiles", async ({
  page,
}) => {
  const { errors } = await setup(page);
  await expect(
    row(page, "My drivetrain repair").locator(".issue-owner"),
  ).toHaveText("Owner: Jamie Chen");
  await nav(page, "Robot / Issues");
  await expect(row(page, "Teammate repair").locator(".issue-owner")).toHaveText(
    `Owner: ${longName}`,
  );
  await expect(
    row(page, "Unclaimed repair").locator(".issue-owner"),
  ).toHaveText("Owner: Unassigned");
  await expect(
    row(page, "Unavailable owner repair").locator(".issue-owner"),
  ).toHaveText("Owner: Assigned teammate");
  await expect(
    row(page, "Inactive owner repair").locator(".issue-owner"),
  ).toHaveText("Owner: Former teammate");
  await expect(
    row(page, "Unnamed owner repair").locator(".issue-owner"),
  ).toHaveText("Owner: Assigned teammate");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/issue-owners-${test.info().project.name}.png`,
    fullPage: true,
  });
  await row(page, "Unavailable owner repair").click();
  await expect(page.getByRole("dialog").locator(".issue-owner")).toHaveText(
    "Owner: Assigned teammate",
  );
  await expect(page.getByLabel("Assigned to", { exact: true })).toHaveValue(
    "unknown",
  );
  await expect(
    page.getByLabel("Assigned to", { exact: true }).locator("option:checked"),
  ).toHaveText("Assigned teammate (current owner)");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await row(page, "Inactive owner repair").click();
  await expect(
    page.getByLabel("Assigned to", { exact: true }).locator("option:checked"),
  ).toHaveText("Former teammate (current owner)");
  expect(errors).toEqual([]);
});

test("Mine and Unassigned intersect event, unresolved, severity, status and search filters", async ({
  page,
}) => {
  const { events, errors } = await setup(page);
  await nav(page, "Robot / Issues");
  const owner = page.getByLabel("Owner", { exact: true });
  const status = page.getByLabel("Status / severity", { exact: true });
  const event = page.getByLabel("Event", { exact: true });
  await owner.selectOption("MINE");
  await expectTitles(page, ["My drivetrain repair", "My deferred inspection"]);
  await status.selectOption("ROBOT DOWN");
  await expectTitles(page, ["My drivetrain repair"]);
  await owner.selectOption("UNASSIGNED");
  await expectTitles(page, ["Unclaimed deferred repair"]);
  await status.selectOption("UNRESOLVED");
  await expectTitles(page, ["Unclaimed repair", "Unclaimed deferred repair"]);
  await page.getByLabel("Search issues").fill("deferred");
  await expectTitles(page, ["Unclaimed deferred repair"]);
  await page.getByLabel("Search issues").fill("missing");
  await expect(
    page.getByText("No issues match this view", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search issues").fill("");
  await owner.selectOption("MINE");
  await status.selectOption("RESOLVED");
  await expectTitles(page, ["My completed repair"]);
  await status.selectOption("DEFERRED");
  await expectTitles(page, ["My deferred inspection"]);
  await status.selectOption("ALL");
  await event.selectOption("all");
  await expectTitles(page, [
    "My drivetrain repair",
    "My deferred inspection",
    "My completed repair",
    "Earlier event repair",
  ]);
  await event.selectOption("previous-event");
  await expectTitles(page, ["Earlier event repair"]);
  await event.selectOption("active");
  events[0].status = "completed";
  events[1].status = "active";
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expectTitles(page, ["Earlier event repair"]);
  await nav(page, "Dashboard");
  await nav(page, "Robot / Issues");
  await expect(owner).toHaveValue("ALL");
  await expect(status).toHaveValue("UNRESOLVED");
  await expectTitles(page, [
    "Earlier event repair",
    "Earlier unclaimed repair",
  ]);
  expect(errors).toEqual([]);
});

test("lead assignment changes update owner filters and preserve unavailable current owners", async ({
  page,
}) => {
  const { issues, calls, errors } = await setup(page, "lead");
  await nav(page, "Robot / Issues");
  await row(page, "Unavailable owner repair").click();
  await page
    .getByLabel("Repair performed", { exact: true })
    .fill("Inspection notes");
  await page.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(calls.at(-1)?.p).not.toHaveProperty("assigned_to");
  expect(issues.find((item) => item.id === "unknown")?.assigned_to).toBe(
    "unknown",
  );
  await row(page, "Inactive owner repair").click();
  await page
    .getByLabel("Repair performed", { exact: true })
    .fill("Unrelated repair notes");
  await page.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(calls.at(-1)?.p).not.toHaveProperty("assigned_to");
  expect(issues.find((item) => item.id === "inactive")?.assigned_to).toBe(
    "inactive",
  );
  await page.getByLabel("Owner", { exact: true }).selectOption("UNASSIGNED");
  await row(page, "Unclaimed repair").click();
  const assignment = page.getByLabel("Assigned to", { exact: true });
  await expect(assignment.locator('option[value="inactive"]')).toHaveCount(0);
  await assignment.selectOption("me");
  await page.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expectTitles(page, ["Unclaimed deferred repair"]);
  expect(calls.at(-1)?.p.assigned_to).toBe("me");
  await page.getByLabel("Owner", { exact: true }).selectOption("MINE");
  await expect(
    row(page, "Unclaimed repair").locator(".issue-owner"),
  ).toHaveText("Owner: Jamie Chen");
  await row(page, "Unclaimed repair").click();
  await assignment.selectOption("");
  await page.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expectTitles(page, ["My drivetrain repair", "My deferred inspection"]);
  expect(calls.at(-1)?.p.assigned_to).toBeNull();
  expect(errors).toEqual([]);
});

test("readonly users can filter owners without gaining assignment or reporting actions", async ({
  page,
}) => {
  const { calls, errors } = await setup(page, "readonly");
  await nav(page, "Robot / Issues");
  await expect(
    page.getByRole("button", { name: "Report issue", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Owner", { exact: true }).selectOption("MINE");
  await expectTitles(page, ["My drivetrain repair", "My deferred inspection"]);
  await row(page, "My drivetrain repair").click();
  await expect(page.getByRole("dialog").locator(".issue-owner")).toHaveText(
    "Owner: Jamie Chen",
  );
  await expect(page.getByLabel("Assigned to", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save issue", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Owner", { exact: true }).selectOption("UNASSIGNED");
  await expectTitles(page, ["Unclaimed repair", "Unclaimed deferred repair"]);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
