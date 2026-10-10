import { test, expect } from "@playwright/test";
import {
  setupScouting,
  scoutTab,
  navigateScouting,
  actorId,
  otherActorId,
  eventId,
  historicalEventId,
  reportId,
  captureScouting,
} from "./scouting-fixture";
import { initialData, type Assignment } from "../src/scouting/model";
const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: reportId(700),
  event_id: eventId,
  kind: "match",
  team_number: null,
  match_key: null,
  alliance: "red",
  station: 2,
  assignee_id: actorId,
  version: 1,
  ...overrides,
});

test("station assignment creation, six labels, duplicate slot, repeat scout warning, edit and reload", async ({
  page,
}) => {
  const f = await setupScouting(page);
  await scoutTab(page, "Assignments");
  const picker = page.getByRole("combobox", {
    name: "Driver station",
    exact: true,
  });
  await expect(picker.locator("option")).toHaveText([
    "Choose a station",
    "Red 1",
    "Red 2",
    "Red 3",
    "Blue 1",
    "Blue 2",
    "Blue 3",
  ]);
  await expect(page.getByLabel("Assigned match ID")).toHaveCount(0);
  await expect(page.getByLabel("Assigned team")).toHaveCount(0);
  await picker.selectOption("red2");
  await page
    .getByRole("combobox", { name: "Scout", exact: true })
    .selectOption(actorId);
  await page.getByRole("button", { name: "Assign scout", exact: true }).click();
  await expect(page.locator(".scout-record")).toContainText(
    "Red 2 · All matches",
  );
  expect(f.state.assignments[0]).toMatchObject({
    team_number: null,
    match_key: null,
    alliance: "red",
    station: 2,
    assignee_id: actorId,
  });
  await expect(picker.locator("option[value=red2]")).toHaveJSProperty(
    "disabled",
    true,
  );
  await picker.selectOption("blue1");
  await page
    .getByRole("combobox", { name: "Scout", exact: true })
    .selectOption(actorId);
  await expect(
    page.locator(".scout-caveat").filter({ hasText: "already covers" }),
  ).toContainText("Red 2");
  await page
    .getByRole("button", { name: "Edit assignment", exact: true })
    .click();
  await expect(picker).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Scout", exact: true })
    .selectOption(otherActorId);
  await page
    .getByRole("button", { name: "Update assignment", exact: true })
    .click();
  await expect(page.locator(".scout-record")).toContainText("Fixture Scout B");
  expect(f.state.assignments).toHaveLength(1);
  expect(f.state.assignments[0].version).toBe(2);
  await page.reload();
  await navigateScouting(page);
  await scoutTab(page, "Assignments");
  await expect(page.locator(".scout-record")).toContainText(
    "Red 2 · All matches",
  );
  await expect(page.locator(".scout-record")).toContainText("Fixture Scout B");
  await captureScouting(page, test.info(), "station-assignment");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("assigned station follows each selected match, survives draft reload, clears missing lineup and supports explicit manual team", async ({
  page,
}) => {
  const f = await setupScouting(page, { assignments: [assignment()] });
  const first = f.feed.scoutingMatches![0];
  f.feed.scoutingMatches!.push({
    ...first,
    key: "2026test_qm19",
    label: "Q19",
    number: 19,
    red: ["7001", "7002", "7003"],
  });
  await scoutTab(page, "Assignments");
  await page.getByRole("button", { name: "Scout Red 2", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Alliance", exact: true }),
  ).toHaveValue("red");
  await expect(
    page.getByRole("combobox", { name: "Station", exact: true }),
  ).toHaveValue("2");
  await page.getByLabel("Choose a loaded match").selectOption("2026test_qm17");
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "1619",
  );
  await page
    .getByLabel("Match notes / breakdown detail")
    .fill("Keep this observation.");
  await page.reload();
  await navigateScouting(page);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "1619",
  );
  await expect(
    page.getByRole("combobox", { name: "Station", exact: true }),
  ).toHaveValue("2");
  await page.getByLabel("Choose a loaded match").selectOption("2026test_qm19");
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "7002",
  );
  await page.getByLabel("Choose a loaded match").selectOption("p1");
  await expect(page.getByLabel("Team number", { exact: true })).toBeEmpty();
  await expect(
    page.locator(".scout-caveat").filter({ hasText: "Following Red 2" }),
  ).toContainText("Enter the team number explicitly");
  await page.getByLabel("Team number", { exact: true }).fill("1234");
  await expect(page.getByLabel("Match notes / breakdown detail")).toHaveValue(
    "Keep this observation.",
  );
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(page.locator(".scouting")).toContainText(
    "Synced to the team database",
  );
  expect(f.submissions()[0].body.p).toMatchObject({
    team_number: 1234,
    match_key: "p1",
    data: { alliance: "red", station: 2 },
  });
  expect(Object.keys(f.submissions()[0].body.p.data).sort()).toEqual(
    Object.keys(initialData("match")).sort(),
  );
  expect(f.pageErrors).toEqual([]);
});

test("blue station selection resolves the correct opponent and absent feeds never invent a team", async ({
  page,
}) => {
  const f = await setupScouting(page, {
    role: "student",
    assignments: [assignment({ alliance: "blue", station: 3 })],
  });
  await page
    .getByRole("button", { name: "New match report", exact: true })
    .click();
  await page.getByLabel("Choose a loaded match").selectOption("2026test_qm17");
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "4593",
  );
  await page.getByLabel("Match ID", { exact: true }).fill("qm999");
  await expect(page.getByLabel("Team number", { exact: true })).toBeEmpty();
  await scoutTab(page, "Assignments");
  await expect(
    page.getByRole("button", { name: "Assign scout", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit assignment", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Scouting event").selectOption(historicalEventId);
  await expect(page.locator(".scouting")).not.toContainText(
    "Blue 3 · All matches",
  );
  expect(f.mutations()).toHaveLength(0);
});

test("legacy match and pit assignments remain readable and editable without converting history", async ({
  page,
}) => {
  const f = await setupScouting(page, {
    assignments: [
      assignment({
        team_number: 4418,
        match_key: "qm1",
        alliance: null,
        station: null,
      }),
      assignment({
        id: reportId(701),
        kind: "pit",
        team_number: 1619,
        alliance: null,
        station: null,
      }),
    ],
  });
  await scoutTab(page, "Assignments");
  await expect(page.locator(".scout-record").first()).toContainText(
    "Team 4418 · qm1",
  );
  await expect(page.locator(".scout-record").first()).toContainText(
    "Earlier match-specific assignment",
  );
  await page
    .getByRole("button", { name: "Edit assignment", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Earlier assigned match ID")).toHaveValue("qm1");
  await page
    .getByRole("combobox", { name: "Scout", exact: true })
    .selectOption(otherActorId);
  await page
    .getByRole("button", { name: "Update assignment", exact: true })
    .click();
  await expect(
    page.locator(".scout-record").filter({ hasText: "Team 4418 · qm1" }),
  ).toContainText("Fixture Scout B");
  expect(f.state.assignments[0]).toMatchObject({
    team_number: 4418,
    match_key: "qm1",
    assignee_id: otherActorId,
  });
  await page
    .getByRole("combobox", { name: "Report type", exact: true })
    .selectOption("pit");
  await page.getByLabel("Assigned team").fill("7001");
  await page
    .getByRole("combobox", { name: "Scout", exact: true })
    .selectOption(actorId);
  await page.getByRole("button", { name: "Assign scout", exact: true }).click();
  await expect(
    page.locator(".scout-record").filter({ hasText: "Team 7001 · Pit" }),
  ).toHaveCount(1);
  expect(f.state.assignments).toHaveLength(3);
});

test("unassigned manual report retains an explicit team when recording its first station", async ({
  page,
}) => {
  const f = await setupScouting(page, {
    feed: { matches: [], scoutingMatches: [] },
  });
  await page
    .getByRole("button", { name: "New match report", exact: true })
    .click();
  await page.getByLabel("Match ID", { exact: true }).fill("p9");
  await page.getByLabel("Team number", { exact: true }).fill("7001");
  await page
    .getByRole("combobox", { name: "Alliance", exact: true })
    .selectOption("blue");
  await page
    .getByRole("combobox", { name: "Station", exact: true })
    .selectOption("1");
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "7001",
  );
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(page.locator(".scouting")).toContainText(
    "Synced to the team database",
  );
  expect(f.submissions()[0].body.p).toMatchObject({
    team_number: 7001,
    match_key: "p9",
    data: { alliance: "blue", station: 1 },
  });
});
