import { test, expect, type Page } from "@playwright/test";
import { nav } from "./competition-fixture";
import { practiceRecord, setupManual } from "./manual-practice-fixture";

async function addNext(page: Page) {
  await page
    .getByRole("button", { name: "Add next practice", exact: true })
    .click();
  await expect(
    page.getByLabel("Practice label", { exact: true }),
  ).toBeVisible();
}

test("next-practice shortcut reviews a new label and starts independent unchecked checklists", async ({
  page,
}) => {
  const { context, data, calls } = await setupManual(page, {
    configured: false,
  });
  const previous = practiceRecord({
    manual_label: "Practice 1",
    battery_id: "battery",
    note: "Prior notes",
    finished_at: new Date().toISOString(),
    finished_by: "person",
  });
  context.matches.push(previous);
  context.runs.push({
    id: "old-pre",
    match_id: previous.id,
    kind: "pre",
    name: "Old preflight",
    template_version: 1,
    started_at: new Date().toISOString(),
  });
  context.items.push({
    id: "old-check",
    run_id: "old-pre",
    text: "Latch check",
    required: true,
    blocking: true,
    completed_at: new Date().toISOString(),
    completed_by: "person",
    version: 2,
  });
  const oldHistory = JSON.stringify({
    previous,
    run: context.runs[0],
    item: context.items[0],
  });
  await page.reload();
  await addNext(page);
  await expect(page.getByLabel("Practice label", { exact: true })).toHaveValue(
    "Practice 2",
  );
  await expect(page.getByLabel(/Scheduled start/)).toHaveValue("");
  expect(calls).toHaveLength(0);
  await page
    .getByLabel("Practice label", { exact: true })
    .fill("Practice 2 - driver swap");
  await page.getByRole("button", { name: "Add practice", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Practice 2 - driver swap",
      exact: true,
    }),
  ).toBeVisible();
  expect(context.matches).toHaveLength(2);
  const current = context.matches[1];
  expect(current.id).not.toBe(previous.id);
  expect(current).toMatchObject({
    battery_id: null,
    note: "",
    scheduled_at: null,
    finished_at: null,
  });
  expect(context.runs).toHaveLength(1);
  await page
    .getByRole("combobox", { name: "Template", exact: true })
    .selectOption("template");
  await page
    .getByRole("button", { name: "Start checklist", exact: true })
    .click();
  const freshCheck = page.getByRole("checkbox", { name: /Latch check/ });
  await expect(freshCheck).not.toBeChecked();
  expect(context.runs[1].match_id).toBe(current.id);
  expect(context.items[1].completed_by).toBeNull();
  await freshCheck.click();
  await expect(freshCheck).toBeChecked();
  expect(
    JSON.stringify({ previous, run: context.runs[0], item: context.items[0] }),
  ).toBe(oldHistory);
  expect(data.pit_batteries[0].status).toBe("READY");
  await nav(page, "Dashboard");
  await expect(
    page.getByText(/Post-match inspection unfinished · Practice 1/),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/practice-shortcut-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("next-practice shortcut can be canceled and reopened without writing or retaining a discarded label", async ({
  page,
}) => {
  const { context, calls } = await setupManual(page, { configured: false });
  await addNext(page);
  await expect(page.getByLabel("Practice label", { exact: true })).toHaveValue(
    "Practice 1",
  );
  await page.getByLabel("Practice label", { exact: true }).fill("Discard me");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Practice label", { exact: true })).toHaveCount(
    0,
  );
  await nav(page, "Dashboard");
  await addNext(page);
  await expect(page.getByLabel("Practice label", { exact: true })).toHaveValue(
    "Practice 1",
  );
  expect(context.matches).toHaveLength(0);
  expect(calls).toHaveLength(0);
  await nav(page, "Dashboard");
  await nav(page, "Matches");
  await expect(page.getByLabel("Practice label", { exact: true })).toHaveCount(
    0,
  );
});

test("next practice is available from a saved practice without auto-finishing the old one", async ({
  page,
}) => {
  const { context, calls } = await setupManual(page);
  context.matches.push(practiceRecord({ manual_label: "Practice 8" }));
  await page.reload();
  await nav(page, "Matches");
  await page.getByRole("button", { name: /Practice 8 Manual/ }).click();
  await addNext(page);
  await expect(page.getByLabel("Practice label", { exact: true })).toHaveValue(
    "Practice 9",
  );
  await page.getByRole("button", { name: "Add practice", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Practice 9", exact: true }),
  ).toBeVisible();
  expect(context.matches[0].finished_at).toBeNull();
  expect(calls.map((call) => call.action)).toEqual(["manual_match"]);
});

test("next-practice shortcut respects crew role, server capability, event and offline write gates", async ({
  page,
}) => {
  const { context, data, calls } = await setupManual(page, { manager: false });
  await expect(
    page.getByRole("button", { name: "Add next practice", exact: true }),
  ).toHaveCount(0);
  context.can_manage = true;
  context.manual_matches_enabled = false;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add next practice", exact: true }),
  ).toHaveCount(0);
  context.manual_matches_enabled = true;
  data.pit_events[0].status = "completed";
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add next practice", exact: true }),
  ).toHaveCount(0);
  data.pit_events[0].status = "active";
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add next practice", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(
    page.getByRole("button", { name: "Add next practice", exact: true }),
  ).toBeDisabled();
  expect(calls).toHaveLength(0);
});

test("a delayed next-practice save cannot replace a newer canceled-and-reopened draft", async ({
  page,
}) => {
  const { context, calls, transport } = await setupManual(page);
  await addNext(page);
  let release!: () => void;
  transport.holdNextCreate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Add practice", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Add practice", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /Q17 RED/ }).click();
  release();
  await expect.poll(() => context.matches.length).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Q17", exact: true }),
  ).toBeVisible();
  await nav(page, "Dashboard");
  await expect(
    page.getByRole("button", { name: "Add next practice", exact: true }),
  ).toBeEnabled();
  await addNext(page);
  await expect(page.getByLabel("Practice label", { exact: true })).toHaveValue(
    "Practice 2",
  );
  expect(calls).toHaveLength(1);
});
