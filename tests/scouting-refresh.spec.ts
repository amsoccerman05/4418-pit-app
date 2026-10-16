import { test, expect } from "@playwright/test";
import { setupScouting, scoutTab, fillMatch, observation } from "./scouting-fixture";

test("scouting refresh and global refresh retrieve team reports in place without submitting or losing a draft", async ({ page }) => {
  const fixture = await setupScouting(page);
  await fillMatch(page);
  await page.getByLabel("Match notes / breakdown detail", { exact: true }).fill("Unfinished observation stays here");
  const refresh = page.getByRole("button", { name: "Refresh scouting data", exact: true });
  await expect(refresh).toBeEnabled();
  await expect(page.getByRole("button", { name: "Sync reports", exact: true })).toBeDisabled();
  fixture.state.observations.push(observation(12, 7001));
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.getByLabel("Match notes / breakdown detail", { exact: true })).toHaveValue("Unfinished observation stays here");
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 7001"]);
  fixture.state.observations.push(observation(13, 7002));
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 7001", "Team 7002"]);
  await scoutTab(page, "Scout");
  await expect(page.getByLabel("Match notes / breakdown detail", { exact: true })).toHaveValue("Unfinished observation stays here");
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("view-only scouts can refresh shared reports with no upload permission", async ({ page }) => {
  const fixture = await setupScouting(page, { role: "readonly" });
  fixture.state.observations.push(observation(12, 7001));
  await page.getByRole("button", { name: "Refresh scouting data", exact: true }).click();
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 7001"]);
  expect(fixture.mutations()).toHaveLength(0);
});
