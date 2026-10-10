import { test, expect } from "@playwright/test";
import { setup } from "./competition-fixture";
test("main page event ranking keeps qualification scope, partial/unavailable and stale states honest", async ({
  page,
}) => {
  const { feed } = await setup(page);
  const card = page.getByRole("region", { name: "Team 4418 event standings" });
  await expect(card).toContainText("Standings not published or unavailable.");
  await expect(card).not.toContainText("0–0–0");
  feed.standings = {
    scope: "qualification",
    rank: 7,
    numTeams: 30,
    record: { wins: 4, losses: 2, ties: 1 },
  };
  feed.standingsAt = Date.now();
  feed.standingsError = null;
  feed.standingsStale = false;
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  await expect(card).toContainText("#7");
  await expect(card).toContainText("4–2–1");
  await expect(card).toContainText("QUALIFICATION RECORD");
  await expect(card).toContainText("playoff results are separate");
  feed.standings = null;
  feed.standingsError = "Upstream unavailable";
  feed.standingsAt = null;
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  await expect(card).toContainText("#7");
  await expect(card).toContainText("may be stale");
  feed.standingsError = null;
  feed.standings = {
    scope: "qualification",
    rank: null,
    numTeams: 30,
    record: null,
  };
  feed.standingsAt = Date.now();
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  await expect(card).not.toContainText("#7");
  await expect(card).toContainText("Not available");
  await expect(card).not.toContainText("0–0–0");
  feed.standings = {
    scope: "qualification",
    rank: 4,
    numTeams: null,
    record: { wins: 0, losses: 0, ties: 0 },
  };
  feed.standingsAt = Date.now() - 360000;
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  await expect(card).toContainText("#4");
  await expect(card).toContainText("0–0–0");
  await expect(card).toContainText("may be stale");
});
test("pit display shows owners, battery mismatch and freshness; close and escape remain repeatable", async ({
  page,
}) => {
  const { context, data } = await setup(page);
  context.matches = [
    { id: "ops", match_key: "2026test_qm17", battery_id: "battery" },
  ];
  context.runs = [{ id: "pre", kind: "pre", match_id: "ops" }];
  context.items = [
    {
      id: "item",
      run_id: "pre",
      required: true,
      blocking: true,
      completed_at: "done",
    },
  ];
  data.pit_batteries.push({
    id: "battery2",
    battery_number: "B02",
    active: true,
    status: "ON ROBOT",
  });
  data.pit_issues = [
    {
      id: "repair",
      issue_number: 1,
      event_id: "event",
      title: "Replace bent bracket",
      subsystem: "Intake",
      severity: "HIGH",
      status: "REPAIRING",
      assigned_to: "person",
    },
    {
      id: "repair2",
      issue_number: 2,
      event_id: "event",
      title: "Check harness",
      subsystem: "Electrical",
      severity: "LOW",
      status: "OPEN",
      assigned_to: null,
    },
  ];
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "ROBOT NOT READY", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".comp-attention")).toContainText(
    "Owner: Test Crew",
  );
  await page
    .getByRole("button", { name: "Open pit display", exact: true })
    .click();
  const display = page.getByRole("dialog", { name: "Pit display" });
  await expect(display).toBeVisible();
  await expect(display).toContainText("Q17");
  await expect(display).toContainText("Now queuing");
  await expect(display).toContainText("Installed: B02");
  await expect(display).toContainText("Assigned to Q17: Test (B01) · READY");
  await expect(display).toContainText("Owner: Test Crew");
  await expect(display).toContainText("Owner: Unassigned");
  await expect(display).toContainText("does not match");
  await expect(display).toContainText("Issues / batteries:");
  expect(await display.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/pit-display-${test.info().project.name}.png`,
    fullPage: true,
  });
  await display.getByRole("button", { name: "Close pit display" }).click();
  await expect(display).toHaveCount(0);
  await page.getByRole("button", { name: "Open pit display" }).click();
  await page.keyboard.press("Escape");
  await expect(display).toHaveCount(0);
  await page.getByRole("button", { name: "Open pit display" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(display).toContainText("OFFLINE · READ-ONLY SNAPSHOT");
  await expect(display).toContainText("VERIFY STATUS");
});
test("readiness cannot be ready before installation and clears after the final post-match inspection", async ({
  page,
}) => {
  const { context, data, feed } = await setup(page);
  context.matches = [
    { id: "ops", match_key: "2026test_qm17", battery_id: "battery" },
  ];
  context.runs = [{ id: "pre", kind: "pre", match_id: "ops" }];
  context.items = [
    {
      id: "item",
      run_id: "pre",
      required: true,
      blocking: true,
      completed_at: "done",
    },
  ];
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  await expect(
    page.getByRole("heading", { name: "NEEDS ATTENTION", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".comp-attention")).toContainText(
    "Install assigned battery Test (B01)",
  );
  data.pit_batteries[0].status = "ON ROBOT";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "ROBOT READY", exact: true }),
  ).toBeVisible();
  feed.matches[0].completed = true;
  feed.matches[0].redScore = 40;
  feed.matches[0].blueScore = 30;
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  await expect(
    page.getByRole("heading", { name: "NEEDS ATTENTION", exact: true }),
  ).toBeVisible();
  expect(data.pit_batteries[0].status).toBe("ON ROBOT");
  context.runs.push({ id: "post", kind: "post", match_id: "ops" });
  context.items.push({
    id: "post-item",
    run_id: "post",
    required: true,
    blocking: false,
    completed_at: "done",
  });
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  await expect(
    page.getByRole("heading", { name: "CHECKS CLEAR", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".comp-attention")).toHaveCount(0);
  expect(data.pit_batteries[0].status).toBe("ON ROBOT");
});

test("changed event configuration cannot show old team results under a new team label", async ({
  page,
}) => {
  const { context, feed } = await setup(page);
  feed.standings = {
    scope: "qualification",
    rank: 3,
    numTeams: 20,
    record: { wins: 5, losses: 1, ties: 0 },
  };
  feed.standingsAt = Date.now();
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  await expect(
    page.getByRole("region", { name: "Team 4418 event standings" }),
  ).toContainText("#3");
  context.config.team_number = 9999;
  context.config.version = 2;
  await page.getByRole("button", { name: "Refresh schedule" }).click();
  const card = page.getByRole("region", { name: "Team 9999 event standings" });
  await expect(card).not.toContainText("#3");
  await expect(card).not.toContainText("5–1–0");
  await expect(page.locator(".comp-next")).not.toContainText("Q17");
});
