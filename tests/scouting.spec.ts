import { expect, test } from "@playwright/test";
import {
  actorId,
  otherActorId,
  eventId,
  historicalEventId,
  observation,
  setupScouting,
  navigateScouting,
  scoutTab,
  fillMatch,
  emitScoutingAuth,
  captureScouting,
} from "./scouting-fixture";

test("scouting match and pit capture preserve observed zero, unknowns, schedule choices, and cloud-first submission", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page);
  await page.getByLabel("Choose a loaded match").selectOption("2026test_qm17");
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue(
    "2026test_qm17",
  );
  await page.getByLabel("Choose a loaded match").selectOption("p1");
  await expect(page.getByLabel("Match label", { exact: true })).toHaveValue(
    "Practice 1",
  );
  await page.getByLabel("Choose a loaded match").selectOption("2026test_qm17");
  await page
    .getByRole("combobox", { name: "Alliance", exact: true })
    .selectOption("red");
  await page
    .getByRole("combobox", { name: "Station", exact: true })
    .selectOption("2");
  await expect(page.getByLabel("AUTO fuel", { exact: true })).toHaveValue("");
  await page
    .locator(".scout-counter")
    .filter({ hasText: "AUTO fuel" })
    .getByRole("button", { name: "Observed zero", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Increase TELEOP fuel", exact: true })
    .click();
  await page
    .locator(".scout-counter")
    .filter({ hasText: "TELEOP fuel" })
    .getByRole("button", { name: "+5", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Endgame climb", exact: true })
    .selectOption("L2");
  await page
    .getByRole("combobox", { name: "Driver ability · 1–5", exact: true })
    .selectOption("4");
  await page
    .getByLabel("Match notes / breakdown detail")
    .fill("Fixture: fast cycling, observed climb.");
  await captureScouting(page, test.info(), "match-capture");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(
    page
      .locator(".scouting [role=status]")
      .filter({ hasText: "Synced to the team database." }),
  ).toBeVisible();
  await scoutTab(page, /^Device/);
  await expect(page.locator(".scout-record")).toContainText("Synced to team");
  expect(fixture.state.observations[0].data).toMatchObject({
    auto_fuel: 0,
    teleop_fuel: 6,
    driver: 4,
    defense: null,
    endgame: "L2",
    station: 2,
  });
  expect(fixture.submissions()[0].authorization).toBe(
    `Bearer fixture-token-${actorId}`,
  );
  await scoutTab(page, "Scout");
  await page
    .getByRole("button", { name: "New pit report", exact: true })
    .click();
  await page.getByLabel("Team number", { exact: true }).fill("1339");
  await page.getByLabel("Drivetrain").selectOption("swerve");
  await page.getByLabel("Hopper capacity · fuel").fill("80");
  await page.getByLabel("Claimed highest climb").selectOption("L3");
  await page.getByLabel("Intake source").selectOption("both");
  await page.getByLabel("Field traversal").selectOption("trench");
  await page
    .getByLabel("AUTO routes and capabilities")
    .fill("Fixture: team reports two auto routes.");
  await page
    .getByLabel("Strengths, limitations, and strategy notes")
    .fill("Fixture: verify tall climb during matches.");
  await captureScouting(page, test.info(), "pit-capture");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect.poll(() => fixture.state.observations.length).toBe(2);
  expect(fixture.state.observations[1]).toMatchObject({
    kind: "pit",
    team_number: 1339,
    match_key: null,
    data: { drive: "swerve", capacity: 80, climb: "L3" },
  });
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting incomplete drafts autosave through close, page navigation, reload, and event isolation", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page, "2996", "qm9");
  await page.getByLabel("AUTO fuel", { exact: true }).fill("12");
  await page
    .getByLabel("Match notes / breakdown detail")
    .fill("Draft survives interrupted scouting.");
  await page.getByRole("button", { name: "Close draft", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("AUTO fuel", { exact: true })).toHaveValue("12");
  await scoutTab(page, "Teams");
  await scoutTab(page, "Scout");
  await expect(page.getByLabel("Match notes / breakdown detail")).toHaveValue(
    "Draft survives interrupted scouting.",
  );
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await navigateScouting(page);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "2996",
  );
  await page.reload();
  await navigateScouting(page);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("AUTO fuel", { exact: true })).toHaveValue("12");
  await page.getByLabel("Scouting event").selectOption(historicalEventId);
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New match report", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Scouting event").selectOption(eventId);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Match notes / breakdown detail")).toHaveValue(
    "Draft survives interrupted scouting.",
  );
  expect(fixture.mutations()).toHaveLength(0);
});

test("scouting loaded tab captures offline, queues locally, and reconnect uploads to cloud automatically", async ({
  page,
  context,
}) => {
  const fixture = await setupScouting(page);
  await context.setOffline(true);
  await expect(page.locator(".scout-sync")).toContainText("Offline");
  await fillMatch(page, "3648", "qm7");
  await page.getByLabel("TELEOP fuel", { exact: true }).fill("21");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(
    page.locator(".scouting [role=status]").filter({
      hasText: "Saved on this device. It will send when you reconnect.",
    }),
  ).toBeVisible();
  await scoutTab(page, /^Device/);
  await expect(page.locator(".scout-record")).toContainText(
    "awaiting cloud sync",
  );
  expect(fixture.submissions()).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Sync reports", exact: true }),
  ).toBeDisabled();
  await scoutTab(page, "Teams");
  await expect(
    page.getByRole("heading", { name: "No synced observations yet" }),
  ).toBeVisible();
  await captureScouting(page, test.info(), "offline-data");
  await context.setOffline(false);
  await expect.poll(() => fixture.state.observations.length).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Team 3648", exact: true }),
  ).toBeVisible();
  await scoutTab(page, /^Device/);
  await expect(page.locator(".scout-record")).toContainText("Synced to team");
  await captureScouting(page, test.info(), "synced-device");
});

test("scouting ambiguous acknowledgment retries original immutable UUID without duplicate observation", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page);
  await page.getByLabel("AUTO fuel", { exact: true }).fill("3");
  fixture.ambiguousSubmit();
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await scoutTab(page, /^Device/);
  await expect(page.locator(".scout-record")).toContainText(
    "Sync not confirmed",
  );
  await expect(page.locator(".scout-record")).toContainText(
    "Server did not confirm this report",
  );
  expect(fixture.state.observations).toHaveLength(1);
  const original = fixture.submissions()[0].body.p;
  await expect(page.locator(".scout-record")).toContainText(original.id);
  await page.getByRole("button", { name: "Sync reports", exact: true }).click();
  await scoutTab(page, /^Device/);
  await expect(page.locator(".scout-record")).toContainText("Synced to team");
  expect(fixture.submissions()).toHaveLength(2);
  expect(fixture.submissions()[1].body.p).toEqual(original);
  expect(fixture.state.observations).toHaveLength(1);
});

test("scouting team summaries distinguish unknown and zero, weight matches equally, and compare teams", async ({
  page,
}) => {
  const a = observation(1, 1619, { auto_fuel: null, teleop_fuel: null });
  const b = observation(2, 1339, { auto_fuel: 0, teleop_fuel: 0, driver: 1 });
  const c = observation(3, 4418, { auto_fuel: 10, teleop_fuel: 20, driver: 4 });
  const duplicateScout = {
    ...observation(4, 4418, { auto_fuel: 30, teleop_fuel: 40, driver: 2 }),
    match_key: c.match_key,
    created_by: otherActorId,
  };
  const differentMatch = observation(5, 4418, {
    auto_fuel: 0,
    teleop_fuel: 0,
    driver: null,
  });
  await setupScouting(page, {
    observations: [a, b, c, duplicateScout, differentMatch],
  });
  await scoutTab(page, "Teams");
  const unknown = page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: "Team 1619", exact: true }),
  });
  const zero = page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: "Team 1339", exact: true }),
  });
  const multiple = page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: "Team 4418", exact: true }),
  });
  await expect(unknown.locator(".scout-metrics strong").first()).toHaveText(
    "—",
  );
  await expect(zero.locator(".scout-metrics strong").first()).toHaveText("0.0");
  await expect(multiple.locator(".scout-metrics strong").first()).toHaveText(
    "25.0",
  );
  await expect(multiple).toContainText("2 matches · 3 reports");
  await captureScouting(page, test.info(), "team-data");
  await unknown.getByRole("button", { name: "Compare", exact: true }).click();
  await zero.getByRole("button", { name: "Compare", exact: true }).click();
  await multiple.getByRole("button", { name: "Compare", exact: true }).click();
  await scoutTab(page, "Compare");
  const row = page.getByRole("row", { name: /^Avg total fuel/ });
  await expect(row.getByRole("cell")).toHaveText(["—", "0.0", "25.0"]);
  await expect(
    page.getByRole("row", { name: /^Driver \(1–5\)/ }).getByRole("cell"),
  ).toHaveText(["—", "1.0", "3.0"]);
  await captureScouting(page, test.info(), "comparison");
});

test("scouting correction creates new linked report, preserves original, and replaces analysis value", async ({
  page,
}) => {
  const original = observation(1, 1619, {
    auto_fuel: 10,
    teleop_fuel: 10,
    notes: "Original observation.",
  });
  const fixture = await setupScouting(page, { observations: [original] });
  await scoutTab(page, "Teams");
  await page
    .getByRole("button", { name: "Reports & notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Correct this report", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Correct report", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Team number", { exact: true }),
  ).not.toBeEditable();
  await expect(page.getByLabel("Match ID", { exact: true })).not.toBeEditable();
  await expect(page.getByLabel("Choose a loaded match")).toBeDisabled();
  await page.getByLabel("TELEOP fuel", { exact: true }).fill("30");
  await page
    .getByLabel("Match notes / breakdown detail")
    .fill("Corrected tally after review.");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await scoutTab(page, /^Device/);
  await expect(page.locator(".scout-record")).toContainText("Synced to team");
  const updated = fixture.state.observations[1];
  expect(updated.id).not.toBe(original.id);
  expect(updated.supersedes_id).toBe(original.id);
  expect(original.data.teleop_fuel).toBe(10);
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team")).toContainText(
    "1 matches · 1 reports",
  );
  await expect(page.locator(".scout-metrics strong").first()).toHaveText(
    "40.0",
  );
  await page
    .getByRole("button", { name: "Reports & notes", exact: true })
    .click();
  await expect(page.locator(".scout-report")).toHaveCount(1);
  await expect(page.locator(".scout-report")).toContainText(
    "Corrected tally after review.",
  );
});

test("scouting shared picklist supports reviewed edit and conflict, assignment tracks specific scout", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    observations: [observation(1, 1619, { auto_fuel: 5, teleop_fuel: 20 })],
  });
  await scoutTab(page, "Picklist");
  await page.getByLabel("Pick team", { exact: true }).fill("1619");
  await page
    .getByLabel("Picklist notes")
    .fill("Strong cycling; confirm climb.");
  await page
    .getByRole("button", { name: "Add team to picklist", exact: true })
    .click();
  await expect(page.locator(".scout-picks")).toContainText("#1 · Team 1619");
  await page
    .getByRole("button", { name: "Edit team 1619", exact: true })
    .click();
  await expect(
    page.getByLabel("Pick team", { exact: true }),
  ).not.toBeEditable();
  await page.getByLabel("Availability").selectOption("picked");
  await page.getByLabel("Picklist notes").fill("Selected by alliance one.");
  await page.getByRole("button", { name: "Update pick", exact: true }).click();
  await expect(page.locator(".scout-picks")).toContainText("picked");
  expect(fixture.state.picklist[0].version).toBe(2);
  await captureScouting(page, test.info(), "picklist");
  await page
    .getByRole("button", { name: "Edit team 1619", exact: true })
    .click();
  await page.getByLabel("Picklist notes").fill("Unsaved stale edit.");
  fixture.rejectManage();
  await page.getByRole("button", { name: "Update pick", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This pick changed");
  expect(fixture.state.picklist[0].notes).toBe("Selected by alliance one.");
  await page
    .getByRole("button", { name: "Refresh scouting", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await scoutTab(page, "Assignments");
  await page.getByLabel("Assigned team").fill("1619");
  await page.getByLabel("Assigned match ID").fill("qm1");
  await page
    .getByRole("combobox", { name: "Scout", exact: true })
    .selectOption(otherActorId);
  await page.getByRole("button", { name: "Assign scout", exact: true }).click();
  await expect(page.locator(".scout-record")).toContainText(
    "Fixture Scout B · Awaiting report",
  );
  fixture.state.observations.push({
    ...observation(2, 1619),
    match_key: "qm1",
    created_by: otherActorId,
  });
  await scoutTab(page, "Teams");
  await page
    .getByRole("button", { name: "Refresh team data", exact: true })
    .click();
  await scoutTab(page, "Assignments");
  await expect(page.locator(".scout-record")).toContainText(
    "Fixture Scout B · Submitted",
  );
  await page
    .getByRole("button", { name: "Edit assignment", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Scout", exact: true })
    .selectOption("");
  await page
    .getByRole("button", { name: "Update assignment", exact: true })
    .click();
  await expect(page.locator(".scout-record")).toContainText(
    "Unassigned · Awaiting report",
  );
  await captureScouting(page, test.info(), "assignments");
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting read-only account sees shared data without collection or management writes", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    role: "readonly",
    observations: [
      observation(1, 1619),
      { ...observation(2, 1619), created_by: otherActorId },
    ],
  });
  await expect(
    page.getByRole("button", { name: "New match report", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New pit report", exact: true }),
  ).toBeDisabled();
  await scoutTab(page, "Teams");
  await page
    .getByRole("button", { name: "Reports & notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Correct this report", exact: true }),
  ).toHaveCount(0);
  await scoutTab(page, "Picklist");
  await expect(
    page.getByRole("button", { name: "Add team to picklist", exact: true }),
  ).toHaveCount(0);
  await scoutTab(page, "Assignments");
  await expect(
    page.getByRole("button", { name: "Assign scout", exact: true }),
  ).toHaveCount(0);
  await scoutTab(page, /^Device/);
  await expect(
    page.getByRole("button", { name: "Sync reports", exact: true }),
  ).toBeDisabled();
  expect(fixture.mutations()).toHaveLength(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.includes("scouting")),
    ),
  ).toEqual([]);
});

test("scouting account switch hides drafts and sign-out retains them for original actor", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page, "1339", "qm18");
  await page
    .getByLabel("Match notes / breakdown detail")
    .fill("Scout A unfinished draft.");
  const storedBefore = await page.evaluate(() => ({ ...localStorage }));
  await emitScoutingAuth(page, otherActorId);
  await expect(page.locator(".scout-sync")).toContainText("0 awaiting sync");
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Scout A unfinished draft.",
  );
  expect(fixture.submissions()).toHaveLength(0);
  await emitScoutingAuth(page, actorId);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Match notes / breakdown detail")).toHaveValue(
    "Scout A unfinished draft.",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".scouting")).toHaveCount(0);
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(
    storedBefore,
  );
  await emitScoutingAuth(page, actorId);
  await navigateScouting(page);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Match notes / breakdown detail")).toHaveValue(
    "Scout A unfinished draft.",
  );
  expect(fixture.submissions()).toHaveLength(0);
});

test("scouting invalid team or match cannot queue and drafts close without changing shared records", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await page
    .getByRole("button", { name: "New match report", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/team number/i);
  await page.getByLabel("Team number", { exact: true }).fill("1619");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/match (ID|key)/i);
  await expect(
    page.getByRole("heading", { name: "Match observation", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting account switch during cloud submission never sends another actor’s queued report", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  const held = fixture.holdNext("rpc/pit_scouting_submit");
  await fillMatch(page, "4593", "qm12");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await held.started;
  const original = fixture.submissions()[0].body.p;
  await emitScoutingAuth(page, otherActorId);
  await expect(page.locator(".suite-name")).toHaveText("Fixture Scout B");
  await expect(page.locator(".scout-sync")).toContainText("0 awaiting sync");
  await scoutTab(page, /^Device/);
  await expect(
    page.getByText("No queued reports on this account and event.", {
      exact: true,
    }),
  ).toBeVisible();
  await held.release();
  expect(fixture.submissions()).toHaveLength(1);
  await emitScoutingAuth(page, actorId);
  await expect(page.locator(".suite-name")).toHaveText("Fixture Scout A");
  await scoutTab(page, /^Device/);
  await expect(page.locator(".scout-record")).toContainText(original.id);
  // Returning to this account may resume queued work; an explicit retry remains available.
  if (
    await page
      .getByRole("button", { name: "Sync reports", exact: true })
      .isEnabled()
  ) {
    await page
      .getByRole("button", { name: "Sync reports", exact: true })
      .click();
  }
  await expect(page.locator(".scout-record")).toContainText("Synced to team");
  expect(
    fixture
      .submissions()
      .every((c) => c.authorization === `Bearer fixture-token-${actorId}`),
  ).toBe(true);
  expect(fixture.submissions().every((c) => c.body.p.id === original.id)).toBe(
    true,
  );
  expect(fixture.state.observations).toHaveLength(1);
});

test("scouting main navigation remains usable and all panels avoid horizontal viewport overflow", async ({
  page,
}) => {
  await setupScouting(page, {
    observations: [observation(1, 1619), observation(2, 1339)],
  });
  if (page.viewportSize()!.width > 760) {
    const tabRows = await page
      .locator(".scout-tabs button")
      .evaluateAll((buttons) =>
        buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
      );
    expect(
      new Set(tabRows).size,
      "Desktop scouting sections must use one horizontal tab row",
    ).toBe(1);
  }
  const navButtons = page.locator(".sidebar nav button");
  for (const button of await navButtons.all()) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
  }
  for (const name of ["Scout", "Teams", "Compare", "Picklist", "Assignments"]) {
    await scoutTab(page, name);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await scoutTab(page, "Scout");
  await captureScouting(page, test.info(), "navigation");
});

test("scouting student with server-verified leadership can manage shared picks and assignments", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    role: "student",
    canManage: true,
  });
  await scoutTab(page, "Picklist");
  await page.getByLabel("Pick team", { exact: true }).fill("4418");
  await page
    .getByRole("button", { name: "Add team to picklist", exact: true })
    .click();
  await expect(page.locator(".scout-picks")).toContainText("#1 · Team 4418");
  await scoutTab(page, "Assignments");
  await page.getByLabel("Assigned team").fill("4418");
  await page.getByLabel("Assigned match ID").fill("qm1");
  await page
    .getByRole("combobox", { name: "Scout", exact: true })
    .selectOption(otherActorId);
  await page.getByRole("button", { name: "Assign scout", exact: true }).click();
  await expect(page.locator(".scout-record")).toContainText(
    "Fixture Scout B · Awaiting report",
  );
  expect(fixture.mutations().map((c) => c.body.action)).toEqual([
    "picklist",
    "assignment",
  ]);
});
