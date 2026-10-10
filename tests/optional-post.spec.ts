import { expect, test, type Page } from "@playwright/test";
import { nav } from "./competition-fixture";
import { practiceRecord, setupManual } from "./manual-practice-fixture";

// Synthetic records only. Both desktop and phone projects exercise these flows.
async function finishedPractice(page: Page) {
  const fixture = await setupManual(page, { configured: false });
  const { context, data } = fixture;
  const finished = practiceRecord({
    manual_label: "Practice 1",
    battery_id: "battery",
    finished_at: new Date().toISOString(),
    finished_by: "person",
  });
  context.matches.push(finished);
  context.runs.push({
    id: "completed-pre",
    match_id: finished.id,
    kind: "pre",
    name: "Completed preflight",
    template_version: 1,
    started_at: new Date().toISOString(),
  });
  context.items.push({
    id: "completed-pre-check",
    run_id: "completed-pre",
    text: "Latch check",
    required: true,
    blocking: true,
    completed_at: new Date().toISOString(),
    completed_by: "person",
    display_order: 0,
    version: 1,
  });
  data.pit_batteries[0].status = "ON ROBOT";
  return { ...fixture, finished };
}

async function expectNoPostWarning(page: Page) {
  await expect(page.getByText(/Post-match inspection unfinished/)).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "CHECKS CLEAR", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Start post-match inspection",
      exact: true,
    }),
  ).toHaveCount(0);
}

for (const templateState of ["absent", "inactive"]) {
  test(`finished practice with ${templateState} post template keeps after-match actions without inspection prompts`, async ({
    page,
  }) => {
    const { context, data, calls } = await finishedPractice(page);
    if (templateState === "absent")
      context.templates = context.templates.filter(
        (template: any) => template.kind !== "post",
      );
    else
      context.templates.find(
        (template: any) => template.kind === "post",
      ).active = false;
    const before = JSON.stringify({
      matches: context.matches,
      runs: context.runs,
      items: context.items,
      batteries: data.pit_batteries,
    });
    await page.reload();
    await expectNoPostWarning(page);
    const after = page.locator(".comp-after");
    await expect(
      after.getByRole("heading", { name: "After Practice 1", exact: true }),
    ).toBeVisible();
    await expect(
      after.getByRole("button", { name: "Open completed match", exact: true }),
    ).toBeVisible();

    for (let repeat = 0; repeat < 2; repeat++) {
      await after
        .getByRole("button", { name: "Battery actions", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("System ID: B01");
      await expect(
        dialog.getByRole("button", { name: "Remove battery", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
    }
    await after
      .getByRole("button", { name: "Report issue", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Report an issue", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();

    await page
      .getByRole("button", { name: "Open pit display", exact: true })
      .click();
    const display = page.getByRole("dialog", {
      name: "Pit display",
      exact: true,
    });
    await expect(
      display.getByRole("heading", { name: "CHECKS CLEAR", exact: true }),
    ).toBeVisible();
    await expect(
      display.getByText(/Post-match inspection unfinished/),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close pit display", exact: true })
      .click();
    await page.screenshot({
      path: `test-results/optional-post-${templateState}-${test.info().project.name}.png`,
      fullPage: true,
    });
    await after
      .getByRole("button", { name: "Open completed match", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Practice 1", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Start post-match inspection",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Post-match inspection checklist",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: /Latch check/ }),
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Open battery actions", exact: true }),
    ).toBeVisible();
    await nav(page, "Dashboard");
    await expectNoPostWarning(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(calls).toHaveLength(0);
    expect(
      JSON.stringify({
        matches: context.matches,
        runs: context.runs,
        items: context.items,
        batteries: data.pit_batteries,
      }),
    ).toBe(before);
  });
}

test("active post template still prompts for a finished practice and completes an explicit inspection", async ({
  page,
}) => {
  const { context, data, calls, finished } = await finishedPractice(page);
  await page.reload();
  await expect(
    page.getByText("Post-match inspection unfinished · Practice 1", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "NEEDS ATTENTION", exact: true }),
  ).toBeVisible();
  await page
    .locator(".comp-after")
    .getByRole("button", {
      name: "Start post-match inspection",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Start post-match inspection",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Template", exact: true })
    .selectOption("post-template");
  await page
    .getByRole("button", { name: "Start checklist", exact: true })
    .click();
  const item = page.getByRole("checkbox", {
    name: /Inspect intake after practice/,
  });
  await expect(item).not.toBeChecked();
  expect(context.runs.at(-1)).toMatchObject({
    kind: "post",
    match_id: finished.id,
  });
  await item.click();
  await expect(item).toBeChecked();
  await nav(page, "Dashboard");
  await expectNoPostWarning(page);
  await expect(
    page.locator(".comp-after").getByRole("button", {
      name: "Open completed match",
      exact: true,
    }),
  ).toBeVisible();
  expect(calls.map((call) => call.action)).toEqual(["run", "item"]);
  expect(data.pit_batteries[0].status).toBe("ON ROBOT");
});

test("disabling a post template keeps an existing incomplete inspection visible until its checks are completed", async ({
  page,
}) => {
  const { context, data, calls, finished } = await finishedPractice(page);
  context.templates.find((template: any) => template.kind === "post").active =
    false;
  context.runs.push({
    id: "saved-post",
    match_id: finished.id,
    kind: "post",
    name: "Saved postflight",
    template_version: 1,
    started_at: new Date().toISOString(),
  });
  context.items.push({
    id: "saved-post-check",
    run_id: "saved-post",
    text: "Inspect intake after practice",
    required: true,
    blocking: false,
    completed_at: null,
    completed_by: null,
    display_order: 0,
    version: 1,
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: "Post-match inspection unfinished · Practice 1",
      exact: true,
    })
    .click();
  const item = page.getByRole("checkbox", {
    name: /Inspect intake after practice/,
  });
  await expect(item).not.toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Saved postflight · v1", exact: true }),
  ).toBeVisible();
  await item.click();
  await expect(item).toBeChecked();
  await nav(page, "Dashboard");
  await expectNoPostWarning(page);
  await page.reload();
  await expectNoPostWarning(page);
  await page
    .locator(".comp-after")
    .getByRole("button", {
      name: "Open completed match",
      exact: true,
    })
    .click();
  await expect(item).toBeChecked();
  expect(context.runs.filter((run: any) => run.kind === "post")).toHaveLength(
    1,
  );
  expect(calls.map((call) => call.action)).toEqual(["item"]);
  expect(data.pit_batteries[0].status).toBe("ON ROBOT");
});
