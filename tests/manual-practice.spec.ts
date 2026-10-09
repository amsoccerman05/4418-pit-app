import { test, expect, type Page } from "@playwright/test";
import { nav } from "./competition-fixture";
import { practiceRecord, setupManual } from "./manual-practice-fixture";

async function startPractice(page: Page, label = "Drive-team warmup") {
  await nav(page, "Matches");
  await page
    .getByRole("button", { name: "Add practice match", exact: true })
    .click();
  await page.getByLabel("Practice label", { exact: true }).fill(label);
}

async function createPractice(page: Page, label = "Drive-team warmup") {
  await startPractice(page, label);
  await page.getByRole("button", { name: "Add practice", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: label, exact: true }),
  ).toBeVisible();
}

async function allMatches(page: Page) {
  await nav(page, "Matches");
  const back = page.getByRole("button", { name: /All matches/ });
  if (await back.count()) await back.click();
}

test("manual practice without external event configuration persists preparation, preflight, finish and postflight", async ({
  page,
}) => {
  const { context, data, calls } = await setupManual(page, {
    configured: false,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createPractice(page);
  const id = context.matches[0].id;
  expect(context.config).toBeNull();
  expect(id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
  expect(context.matches[0].match_key).toBe(`manual:${id}`);
  await expect(page.getByText("Manual", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Match preparation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Battery", exact: true })
    .selectOption("battery");
  await page
    .getByLabel("Operational note", { exact: true })
    .fill("Low-speed driver practice");
  await page
    .getByRole("button", { name: "Save preparation", exact: true })
    .click();
  await expect
    .poll(() => context.matches[0].note)
    .toBe("Low-speed driver practice");
  await page
    .getByRole("combobox", { name: "Template", exact: true })
    .selectOption("template");
  await page
    .getByRole("button", { name: "Start checklist", exact: true })
    .click();
  const preCheck = page.getByRole("checkbox", { name: /Latch check/ });
  await expect(preCheck).not.toBeChecked();
  await preCheck.click();
  await expect(preCheck).toBeChecked();
  await page.screenshot({
    path: `test-results/manual-practice-pre-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(data.pit_batteries[0].status).toBe("READY");
  await page.reload();
  await allMatches(page);
  await page.getByRole("button", { name: /Drive-team warmup/ }).click();
  await expect(
    page.getByLabel("Operational note", { exact: true }),
  ).toHaveValue("Low-speed driver practice");
  await expect(preCheck).toBeChecked();
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  expect(context.matches[0].finished_at).toBeNull();
  await page
    .getByRole("button", { name: "Confirm finished", exact: true })
    .click();
  await expect.poll(() => context.matches[0].finished_at).not.toBeNull();
  await expect(
    page.getByRole("heading", {
      name: "Start post-match inspection",
      exact: true,
    }),
  ).toBeVisible();
  expect(context.matches[0].finished_by).toBe("person");
  expect(context.runs).toHaveLength(1);
  expect(data.pit_batteries[0].status).toBe("READY");
  await page
    .getByRole("combobox", { name: "Template", exact: true })
    .selectOption("post-template");
  await page
    .getByRole("button", { name: "Start checklist", exact: true })
    .click();
  const postCheck = page.getByRole("checkbox", {
    name: /Inspect intake after practice/,
  });
  await expect(postCheck).not.toBeChecked();
  await postCheck.click();
  await expect(postCheck).toBeChecked();
  await page.reload();
  await allMatches(page);
  await page.getByRole("button", { name: /Drive-team warmup/ }).click();
  await expect(preCheck).toBeChecked();
  await expect(postCheck).toBeChecked();
  await page.screenshot({
    path: `test-results/manual-practice-post-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(context.runs.map((run: any) => run.kind)).toEqual(["pre", "post"]);
  expect(
    calls.filter((call) => call.action === "finish_manual_match"),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("practice creation and editing can be canceled; duplicate labels are rejected before mutation", async ({
  page,
}) => {
  const { context, calls } = await setupManual(page);
  await startPractice(page, "Do not save this");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(calls).toHaveLength(0);
  expect(context.matches).toHaveLength(0);
  await expect(page.getByLabel("Practice label", { exact: true })).toHaveCount(
    0,
  );
  await createPractice(page);
  await page
    .getByRole("button", { name: "Edit practice", exact: true })
    .click();
  await page
    .getByLabel("Practice label", { exact: true })
    .fill("Canceled rename");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Drive-team warmup", exact: true }),
  ).toBeVisible();
  expect(calls.filter((call) => call.action === "manual_match")).toHaveLength(
    1,
  );
  await page
    .getByRole("button", { name: "Edit practice", exact: true })
    .click();
  await page
    .getByLabel("Practice label", { exact: true })
    .fill("Driver practice 2");
  await page.getByLabel(/Scheduled start/).fill("2026-10-09T10:30");
  await page
    .getByRole("button", { name: "Save practice", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Driver practice 2", exact: true }),
  ).toBeVisible();
  expect(context.matches[0].scheduled_at).toBeTruthy();
  expect(calls.at(-1)).toMatchObject({
    action: "manual_match",
    p: { match_id: context.matches[0].id, version: 1 },
  });
  await allMatches(page);
  await startPractice(page, "  DRIVER   PRACTICE   2  ");
  await page.getByRole("button", { name: "Add practice", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    /already|unique|duplicate/i,
  );
  expect(calls.filter((call) => call.action === "manual_match")).toHaveLength(
    2,
  );
  expect(context.matches).toHaveLength(1);
});

for (const committed of [false, true])
  test(`create retry reuses one UUID after ${committed ? "a committed but lost response" : "a request failed before commit"} and disables repeated submission while busy`, async ({
    page,
  }) => {
    const { context, calls, transport } = await setupManual(page);
    await startPractice(page);
    transport.failNextCreate = !committed;
    transport.loseNextCreateResponse = committed;
    await page
      .getByRole("button", { name: "Add practice", exact: true })
      .click();
    await expect(
      page.getByText(/Competition snapshot is read-only/),
    ).toBeVisible();
    await expect
      .poll(() => calls.filter((call) => call.action === "manual_match").length)
      .toBe(1);
    const firstId = calls[0].p.id;
    expect(context.matches).toHaveLength(committed ? 1 : 0);
    await page
      .getByRole("button", { name: "Refresh schedule", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add practice", exact: true }),
    ).toBeEnabled();
    let release!: () => void;
    transport.holdNextCreate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page
      .getByRole("button", { name: "Add practice", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add practice", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(() => calls.filter((call) => call.action === "manual_match").length)
      .toBe(2);
    expect(calls[1].p.id).toBe(firstId);
    release();
    await expect(
      page.getByRole("heading", { name: "Drive-team warmup", exact: true }),
    ).toBeVisible();
    expect(context.matches).toHaveLength(1);
    expect(context.matches[0].id).toBe(firstId);
  });

test("finishing a delayed create cannot replace a newer official-match selection", async ({
  page,
}) => {
  const { context, calls, transport } = await setupManual(page);
  await startPractice(page);
  let release!: () => void;
  transport.holdNextCreate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Add practice", exact: true }).click();
  await expect
    .poll(() => calls.filter((call) => call.action === "manual_match").length)
    .toBe(1);
  await page.getByRole("button", { name: /Q17 RED/ }).click();
  await expect(
    page.getByRole("heading", { name: "Q17", exact: true }),
  ).toBeVisible();
  release();
  await expect.poll(() => context.matches.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Prepare for match", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Q17", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Drive-team warmup", exact: true }),
  ).toHaveCount(0);
  await allMatches(page);
  await expect(
    page.getByRole("button", { name: /Drive-team warmup/ }),
  ).toBeVisible();
});

test("manual creation stays unavailable without server capability or an active event", async ({
  page,
}) => {
  const { context, data, calls } = await setupManual(page);
  context.manual_matches_enabled = false;
  await page.reload();
  await allMatches(page);
  await expect(
    page.getByText("Manual practice is not enabled on this server yet.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add practice match", exact: true }),
  ).toHaveCount(0);
  context.manual_matches_enabled = true;
  data.pit_events[0].status = "completed";
  await page.reload();
  await allMatches(page);
  await expect(
    page.getByText(
      "Activate a Pit event in Event before adding practice matches.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add practice match", exact: true }),
  ).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test("finish needs explicit confirmation and never completes checks or changes physical battery state", async ({
  page,
}) => {
  const { context, data, calls } = await setupManual(page);
  await createPractice(page);
  await page
    .getByRole("combobox", { name: "Template", exact: true })
    .selectOption("template");
  await page
    .getByRole("button", { name: "Start checklist", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Latch check/ }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  expect(calls.some((call) => call.action === "finish_manual_match")).toBe(
    false,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm finished", exact: true }),
  ).toHaveCount(0);
  expect(context.matches[0].finished_at).toBeNull();
  await page
    .getByRole("button", { name: "Finish practice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm finished", exact: true })
    .click();
  await expect.poll(() => context.matches[0].finished_at).not.toBeNull();
  await expect(
    page.getByRole("checkbox", { name: /Latch check/ }),
  ).not.toBeChecked();
  expect(context.items[0].completed_at).toBeNull();
  expect(context.runs).toHaveLength(1);
  expect(data.pit_batteries[0].status).toBe("READY");
});

test("archiving and restoring practice preserves checklist history, notes, assignment and issue links", async ({
  page,
}) => {
  const { context } = await setupManual(page);
  const record = practiceRecord({
    battery_id: "battery",
    note: "Keep this history",
  });
  context.matches.push(record);
  context.runs.push({
    id: "saved-run",
    match_id: record.id,
    kind: "pre",
    name: "Saved preflight",
    template_version: 1,
    started_at: new Date().toISOString(),
  });
  context.items.push({
    id: "saved-item",
    run_id: "saved-run",
    text: "Saved latch check",
    required: true,
    blocking: true,
    completed_at: new Date().toISOString(),
    completed_by: "person",
    version: 1,
  });
  context.links.push({ match_id: record.id, issue_id: "saved-issue" });
  const history = JSON.stringify({
    runs: context.runs,
    items: context.items,
    links: context.links,
  });
  await page.reload();
  await allMatches(page);
  await page.getByRole("button", { name: /Drive-team warmup/ }).click();
  await page
    .getByRole("button", { name: "Archive practice", exact: true })
    .click();
  expect(record.archived_at).toBeNull();
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await expect.poll(() => record.archived_at).not.toBeNull();
  await allMatches(page);
  await expect(
    page.getByRole("button", { name: /Drive-team warmup/ }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Show matches", exact: true })
    .selectOption("archived");
  await page.getByRole("button", { name: /Drive-team warmup/ }).click();
  await expect(
    page.getByRole("checkbox", { name: /Saved latch check/ }),
  ).toBeChecked();
  await expect(
    page.getByText("Keep this history", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore practice", exact: true })
    .click();
  await expect.poll(() => record.archived_at).toBeNull();
  expect(record.battery_id).toBe("battery");
  expect(record.note).toBe("Keep this history");
  expect(
    JSON.stringify({
      runs: context.runs,
      items: context.items,
      links: context.links,
    }),
  ).toBe(history);
});

test("crew can work practice checklists but cannot create, edit, finish or archive practice", async ({
  page,
}) => {
  const { context, calls } = await setupManual(page, { manager: false });
  context.matches.push(practiceRecord());
  await page.reload();
  await allMatches(page);
  await expect(
    page.getByRole("button", { name: "Add practice match", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Drive-team warmup/ }).click();
  for (const name of [
    "Edit practice",
    "Finish practice",
    "Archive practice",
    "Save preparation",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await page
    .getByRole("combobox", { name: "Template", exact: true })
    .selectOption("template");
  await page
    .getByRole("button", { name: "Start checklist", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /Latch check/ }).click();
  await expect(
    page.getByRole("checkbox", { name: /Latch check/ }),
  ).toBeChecked();
  expect(calls.map((call) => call.action)).toEqual(["run", "item"]);
});

test("offline practice details and creation are read-only", async ({
  page,
}) => {
  const { calls } = await setupManual(page);
  await createPractice(page);
  await page
    .getByRole("combobox", { name: "Template", exact: true })
    .selectOption("template");
  await page
    .getByRole("button", { name: "Start checklist", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Latch check/ }),
  ).toBeVisible();
  const before = calls.length;
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  for (const name of [
    "Edit practice",
    "Finish practice",
    "Archive practice",
    "Save preparation",
    "Start checklist",
  ]) {
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  }
  await expect(
    page.getByRole("checkbox", { name: /Latch check/ }),
  ).toBeDisabled();
  await allMatches(page);
  await expect(
    page.getByRole("button", { name: "Add practice match", exact: true }),
  ).toBeDisabled();
  expect(calls).toHaveLength(before);
});

test("manual preparation takes priority while official schedule scores remain unchanged", async ({
  page,
}) => {
  const { feed } = await setupManual(page);
  const official = structuredClone(feed.matches[0]);
  feed.matches.push({
    ...official,
    key: "2026test_qm18",
    label: "Q18",
    number: 18,
    completed: true,
    redScore: 75,
    blueScore: 40,
    winner: "red",
  });
  await page
    .getByRole("button", { name: "Refresh schedule", exact: true })
    .click();
  const snapshot = JSON.stringify(feed.matches);
  await createPractice(page);
  await nav(page, "Dashboard");
  await expect(page.locator(".comp-next")).toContainText("Drive-team warmup");
  await expect(page.locator(".comp-next")).toContainText(/manual/i);
  await expect(page.locator(".comp-next")).not.toContainText(
    "4418 · 1619 · 1339",
  );
  await allMatches(page);
  await expect(
    page.getByRole("heading", { name: "Manual practice", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Q18/ }).click();
  await expect(
    page.getByText("Red 75 — Blue 40 · RED wins", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish practice", exact: true }),
  ).toHaveCount(0);
  expect(JSON.stringify(feed.matches)).toBe(snapshot);
});
