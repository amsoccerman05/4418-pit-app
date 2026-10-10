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
  refreshScoutingMatches,
  refreshScoutingTeams,
} from "./scouting-fixture";

const eventTeams = [
  { key: "frc1619", number: 1619, name: "Fixture Alpha Robotics" },
  { key: "frc4418", number: 4418, name: "Fixture Impulse" },
  { key: "frc7001", number: 7001, name: null },
];

test("scouting event roster appears before reports or schedules, supports name search, and never invents performance", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    feed: { eventTeams, matches: [], scoutingMatches: [] },
  });
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText([
    "Team 1619",
    "Team 4418",
    "Team 7001",
  ]);
  await expect(
    page
      .locator(".scouting [role=status]")
      .filter({ hasText: "teams listed by TBA" }),
  ).toContainText("3 teams listed by TBA. Roster up to date.");
  await expect(page.locator(".scouting")).toContainText(
    "Team names and numbers come from TBA. Performance data comes only from our synced scouting reports.",
  );
  await expect(
    page.getByRole("button", { name: "Export reports CSV", exact: true }),
  ).toBeDisabled();
  for (const card of await page.locator(".scout-team").all()) {
    await expect(card).toContainText("Not scouted yet");
    await expect(card).toContainText("0 matches · 0 reports");
    await expect(card.locator(".scout-metrics strong")).toHaveText([
      "—",
      "—",
      "—",
    ]);
    await expect(card).toContainText("Driver — · Defense —");
  }
  await captureScouting(page, test.info(), "unscouted-event-roster");
  const search = page.getByLabel("Find a team", { exact: true });
  await expect(search).toHaveAttribute("placeholder", "Team number or name");
  await search.fill("  aLPHa  ");
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 1619"]);
  await expect(page.locator(".scout-team-name")).toHaveText(
    "Fixture Alpha Robotics",
  );
  await search.fill("7001");
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 7001"]);
  await expect(page.locator(".scout-team-name")).toHaveCount(0);
  await search.fill("no such fixture team");
  await expect(page.locator(".scout-team")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "No teams match your search",
      exact: true,
    }),
  ).toBeVisible();
  await search.fill("Impulse");
  await page
    .locator(".scout-team")
    .getByRole("button", { name: "Compare", exact: true })
    .click();
  await scoutTab(page, "Compare");
  await expect(
    page.getByRole("row", { name: /^Avg total fuel/ }).getByRole("cell"),
  ).toHaveText(["—"]);
  await expect(
    page.getByRole("row", { name: /^Driver \(1–5\)/ }).getByRole("cell"),
  ).toHaveText(["—"]);
  expect(fixture.state.observations).toHaveLength(0);
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting first synced report enriches the existing roster card and retains report-only and manually entered teams", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    feed: { eventTeams },
    observations: [observation(1, 9001, { drive: "swerve" }, "pit")],
  });
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText([
    "Team 1619",
    "Team 4418",
    "Team 7001",
    "Team 9001",
  ]);
  const rosterCard = page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: "Team 1619", exact: true }),
  });
  const pitCard = page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: "Team 9001", exact: true }),
  });
  await expect(rosterCard).toContainText("Not scouted yet");
  await expect(pitCard).toContainText("Pit report available");
  await expect(pitCard).not.toContainText("Not scouted yet");
  await expect(pitCard.locator(".scout-metrics strong")).toHaveText([
    "—",
    "—",
    "—",
  ]);
  await scoutTab(page, "Scout");
  await fillMatch(page, "1619", "qm21");
  await page.getByLabel("AUTO fuel", { exact: true }).fill("0");
  await page.getByLabel("TELEOP fuel", { exact: true }).fill("12");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(
    page
      .locator(".scouting [role=status]")
      .filter({ hasText: "Synced to the team database." }),
  ).toBeVisible();
  await scoutTab(page, "Teams");
  await expect(rosterCard).toHaveCount(1);
  await expect(rosterCard).toContainText("Fixture Alpha Robotics");
  await expect(rosterCard).not.toContainText("Not scouted yet");
  await expect(rosterCard).toContainText("1 matches · 1 reports");
  await expect(rosterCard.locator(".scout-metrics strong").first()).toHaveText(
    "12.0",
  );
  await expect(page.locator(".scout-team")).toHaveCount(4);
  await scoutTab(page, "Scout");
  await fillMatch(page, "8888", "p9");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect.poll(() => fixture.state.observations.length).toBe(3);
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText([
    "Team 1619",
    "Team 4418",
    "Team 7001",
    "Team 8888",
    "Team 9001",
  ]);
  const manualCard = page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: "Team 8888", exact: true }),
  });
  await expect(manualCard.locator(".scout-metrics strong").first()).toHaveText(
    "—",
  );
  await expect(manualCard).toContainText("1 matches · 1 reports");
  await expect(pitCard).toContainText("Pit report available");
  await captureScouting(page, test.info(), "mixed-event-roster");
  expect(fixture.submissions()).toHaveLength(2);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting failed team refresh retains roster with a stale warning and successful empty roster keeps synced report teams", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    feed: { eventTeams },
    observations: [observation(1, 9001, { auto_fuel: 0, teleop_fuel: 0 })],
  });
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team")).toHaveCount(4);
  const rosterStatus = page
    .locator(".scouting [role=status]")
    .filter({ hasText: "teams listed by TBA" });
  fixture.feed.eventTeams = [];
  fixture.feed.teamsAt = null;
  fixture.feed.teamsError = "Synthetic roster outage";
  fixture.state.observations.push(
    observation(2, 1619, { auto_fuel: 5, teleop_fuel: 7 }),
  );
  await refreshScoutingTeams(page);
  await expect(page.locator(".scout-team h3")).toHaveText([
    "Team 1619",
    "Team 4418",
    "Team 7001",
    "Team 9001",
  ]);
  await expect(rosterStatus).toContainText(
    "Roster may be outdated; refresh when connected.",
  );
  await expect(rosterStatus).toContainText("Last roster update");
  const updated = page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: "Team 1619", exact: true }),
  });
  await expect(updated).toContainText("Fixture Alpha Robotics");
  await expect(updated.locator(".scout-metrics strong").first()).toHaveText(
    "12.0",
  );
  fixture.feed.teamsError = null;
  fixture.feed.teamsAt = Date.now();
  await refreshScoutingTeams(page);
  await expect(page.locator(".scout-team h3")).toHaveText([
    "Team 1619",
    "Team 9001",
  ]);
  await expect(rosterStatus).toContainText(
    "0 teams listed by TBA. Roster up to date.",
  );
  await expect(rosterStatus).not.toContainText("Roster may be outdated");
  await expect(updated.locator(".scout-metrics strong").first()).toHaveText(
    "12.0",
  );
  const reportOnly = page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: "Team 9001", exact: true }),
  });
  await expect(reportOnly.locator(".scout-metrics strong").first()).toHaveText(
    "0.0",
  );
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting historical teams and in-flight event changes never mix event rosters", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    feed: { eventTeams },
    observations: [
      observation(1, 9001),
      { ...observation(2, 8001), event_id: historicalEventId },
    ],
  });
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team")).toHaveCount(4);
  await page.getByLabel("Scouting event").selectOption(historicalEventId);
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 8001"]);
  await expect(page.locator(".scouting")).toContainText(
    "No TBA roster is linked to this scouting event.",
  );
  await page.getByLabel("Scouting event").selectOption(eventId);
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team")).toHaveCount(4);
  fixture.data.pit_events[0].status = "completed";
  fixture.data.pit_events[1].status = "active";
  fixture.competition.config = {
    ...fixture.competition.config,
    event_id: historicalEventId,
    tba_event_key: "2026previous",
    version: 2,
  };
  Object.assign(fixture.feed, {
    eventId: historicalEventId,
    eventKey: "2026previous",
    eventName: "Synthetic Previous Event",
    configVersion: 2,
    matches: [],
    scoutingMatches: [],
    eventTeams: [
      { key: "frc8002", number: 8002, name: "Fixture Previous Event Robots" },
    ],
    teamsAt: Date.now(),
    teamsError: null,
  });
  const held = fixture.holdNext("feed");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await held.started;
  await page.getByLabel("Scouting event").selectOption(historicalEventId);
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 8001"]);
  await expect(page.locator(".scouting")).not.toContainText(
    "Fixture Alpha Robotics",
  );
  await held.release();
  await expect(page.locator(".scout-team h3")).toHaveText([
    "Team 8001",
    "Team 8002",
  ]);
  await expect(page.locator(".scout-team-name")).toHaveText(
    "Fixture Previous Event Robots",
  );
  await page.getByLabel("Scouting event").selectOption(eventId);
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 9001"]);
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting legacy feed retains report-only teams when the event directory is unavailable", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    legacyFeed: true,
    observations: [observation(1, 9001)],
  });
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team h3")).toHaveText(["Team 9001"]);
  await expect(page.locator(".scouting")).toContainText(
    "Event roster unavailable. Refresh to retry; synced report teams still appear below.",
  );
  await expect(page.locator(".scout-team")).not.toContainText(
    "Not scouted yet",
  );
  await expect(
    page.locator(".scout-team .scout-metrics strong").first(),
  ).toHaveText("—");
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting form explains contextual unknowns, rating anchors, zero fuel, and distinct climb outcomes", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page);
  await expect(page.locator(".scout-form")).toContainText(
    "Blank or unknown means you haven’t recorded an answer or couldn’t tell. It does not mean zero, no attempt, or a poor rating.",
  );
  for (const [name, unknown] of [
    ["Alliance", "Choose alliance"],
    ["Starting position", "Start unseen / unsure"],
    ["AUTO climb", "Choose climb result"],
    ["Endgame climb", "Choose climb result"],
    ["Estimated shooting accuracy", "Accuracy unknown"],
    ["Primary role", "Choose main role"],
    ["Intake source", "Intake source unknown"],
    ["Field traversal", "Traversal unknown"],
  ]) {
    const field = page.getByRole("combobox", { name, exact: true });
    await expect(field).toHaveValue("unknown");
    await expect(field.locator('option[value="unknown"]')).toHaveText(unknown);
    await expect(field).toHaveAccessibleDescription(/.+/);
  }
  await expect(
    page
      .getByRole("combobox", { name: "Station", exact: true })
      .locator('option[value=""]'),
  ).toHaveText("Choose station (if known)");
  await expect(
    page
      .getByRole("combobox", { name: "Driver ability · 1–5", exact: true })
      .locator("option"),
  ).toHaveText([
    "Not rated",
    "1 · Struggled with control",
    "2 · Inconsistent control",
    "3 · Steady driving",
    "4 · Fast and controlled",
    "5 · Excellent precision",
  ]);
  await expect(
    page
      .getByRole("combobox", {
        name: "Defense effectiveness · 1–5",
        exact: true,
      })
      .locator("option"),
  ).toHaveText([
    "Not rated",
    "1 · Little impact",
    "2 · Some disruption",
    "3 · Slowed opponent",
    "4 · Often stopped cycles",
    "5 · Very effective defense",
  ]);
  await expect(
    page.getByRole("combobox", { name: "Driver ability · 1–5", exact: true }),
  ).toHaveAccessibleDescription(
    "Rate only if you saw enough driving. Unrated is excluded from the average.",
  );
  await expect(
    page.getByRole("combobox", {
      name: "Defense effectiveness · 1–5",
      exact: true,
    }),
  ).toHaveAccessibleDescription(
    "Leave unrated if it did not play defense or you could not judge its impact.",
  );
  for (const title of ["AUTO fuel", "TELEOP fuel"]) {
    const counter = page.locator(".scout-counter").filter({ hasText: title });
    await expect(
      counter.getByRole("button", { name: "Set 0 fuel", exact: true }),
    ).toBeVisible();
    await expect(
      counter.getByRole("button", { name: "Couldn’t count", exact: true }),
    ).toBeVisible();
    await expect(counter).toContainText(
      "Use 0 only if you watched and saw no fuel go in.",
    );
  }
  for (const title of ["AUTO climb", "Endgame climb"]) {
    const climb = page.getByRole("combobox", { name: title, exact: true });
    await expect(climb.locator('option[value="not_attempted"]')).toHaveText(
      "Did not attempt a climb",
    );
    await expect(climb.locator('option[value="failed"]')).toHaveText(
      "Attempted, but failed",
    );
  }
  await expect(
    page
      .getByRole("combobox", { name: "Endgame climb", exact: true })
      .locator('option[value="L3"]'),
  ).toHaveText("Reached Level 3");
  await captureScouting(page, test.info(), "clear-match-labels");
  await page.getByRole("button", { name: "Close draft", exact: true }).click();
  await page
    .getByRole("button", { name: "New pit report", exact: true })
    .click();
  for (const [name, unknown] of [
    ["Drivetrain", "Drivetrain unknown"],
    ["Claimed highest climb", "Climb capability unknown"],
    ["Intake source", "Intake source unknown"],
    ["Field traversal", "Traversal unknown"],
  ]) {
    const field = page.getByRole("combobox", { name, exact: true });
    await expect(field).toHaveValue("unknown");
    await expect(field.locator('option[value="unknown"]')).toHaveText(unknown);
  }
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting clearer labels preserve null versus zero and climb codes through draft reload, submission, and correction", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page, "1619", "qm22");
  const auto = page.locator(".scout-counter").filter({ hasText: "AUTO fuel" });
  const teleop = page
    .locator(".scout-counter")
    .filter({ hasText: "TELEOP fuel" });
  await auto.getByRole("button", { name: "Set 0 fuel", exact: true }).click();
  await teleop.getByRole("button", { name: "Set 0 fuel", exact: true }).click();
  await expect(page.getByLabel("TELEOP fuel", { exact: true })).toHaveValue(
    "0",
  );
  await teleop
    .getByRole("button", { name: "Couldn’t count", exact: true })
    .click();
  await expect(page.getByLabel("TELEOP fuel", { exact: true })).toHaveValue("");
  await page
    .getByRole("combobox", { name: "Driver ability · 1–5", exact: true })
    .selectOption({ label: "1 · Struggled with control" });
  await page
    .getByRole("combobox", { name: "Defense effectiveness · 1–5", exact: true })
    .selectOption({ label: "5 · Very effective defense" });
  await page
    .getByRole("combobox", { name: "Defense effectiveness · 1–5", exact: true })
    .selectOption({ label: "Not rated" });
  await page
    .getByRole("combobox", { name: "AUTO climb", exact: true })
    .selectOption({ label: "Did not attempt a climb" });
  await page
    .getByRole("combobox", { name: "Endgame climb", exact: true })
    .selectOption({ label: "Attempted, but failed" });
  await page.getByRole("button", { name: "Close draft", exact: true }).click();
  await page.reload();
  await navigateScouting(page);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("AUTO fuel", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("TELEOP fuel", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Driver ability · 1–5", exact: true }),
  ).toHaveValue("1");
  await expect(
    page.getByRole("combobox", {
      name: "Defense effectiveness · 1–5",
      exact: true,
    }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "AUTO climb", exact: true }),
  ).toHaveValue("not_attempted");
  await expect(
    page.getByRole("combobox", { name: "Endgame climb", exact: true }),
  ).toHaveValue("failed");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(
    page
      .locator(".scouting [role=status]")
      .filter({ hasText: "Synced to the team database." }),
  ).toBeVisible();
  const original = fixture.state.observations[0];
  expect(original.data).toMatchObject({
    schema_version: 1,
    auto_fuel: 0,
    teleop_fuel: null,
    driver: 1,
    defense: null,
    auto_climb: "not_attempted",
    endgame: "failed",
    start_position: "unknown",
    alliance: "unknown",
    station: null,
  });
  await scoutTab(page, "Teams");
  await page
    .getByRole("button", { name: "Reports & notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Correct this report", exact: true })
    .click();
  await expect(page.getByLabel("AUTO fuel", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("TELEOP fuel", { exact: true })).toHaveValue("");
  await auto
    .getByRole("button", { name: "Couldn’t count", exact: true })
    .click();
  await teleop.getByRole("button", { name: "Set 0 fuel", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Driver ability · 1–5", exact: true })
    .selectOption({ label: "Not rated" });
  await page
    .getByRole("combobox", { name: "Defense effectiveness · 1–5", exact: true })
    .selectOption({ label: "5 · Very effective defense" });
  await page
    .getByRole("combobox", { name: "AUTO climb", exact: true })
    .selectOption({ label: "Attempted, but failed" });
  await page
    .getByRole("combobox", { name: "Endgame climb", exact: true })
    .selectOption({ label: "Did not attempt a climb" });
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect.poll(() => fixture.state.observations.length).toBe(2);
  const corrected = fixture.state.observations[1];
  expect(corrected.id).not.toBe(original.id);
  expect(corrected.supersedes_id).toBe(original.id);
  expect(corrected.data).toMatchObject({
    auto_fuel: null,
    teleop_fuel: 0,
    driver: null,
    defense: 5,
    auto_climb: "failed",
    endgame: "not_attempted",
  });
  expect(original.data).toMatchObject({
    auto_fuel: 0,
    teleop_fuel: null,
    driver: 1,
    defense: null,
  });
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team")).toContainText(
    "1 matches · 1 reports",
  );
  await expect(page.locator(".scout-team")).toContainText(
    "Driver — · Defense 5.0",
  );
  await expect(
    page.locator(".scout-team .scout-metrics strong").first(),
  ).toHaveText("—");
  expect(fixture.submissions()).toHaveLength(2);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting all-event match selection submits a non-4418 observation without assigning the scout's team or alliance", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page, "2002", "qmmanual");
  const loaded = page.getByLabel("Choose a loaded match");
  await expect(loaded.locator('option[value="2026test_qm4"]')).toHaveText(
    "Q4 · Red 1001/1002/1003 vs Blue 2001/2002/2003",
  );
  await expect(loaded.locator('option[value="p1"]')).toHaveText(
    "Practice 1 · Practice",
  );
  await expect(page.locator(".scouting")).toContainText(
    "All event matches from TBA, plus saved practices.",
  );
  await loaded.selectOption("2026test_qm4");
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue(
    "2026test_qm4",
  );
  await expect(page.getByLabel("Match label", { exact: true })).toHaveValue(
    "Q4",
  );
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "2002",
  );
  await expect(
    page.getByRole("combobox", { name: "Alliance", exact: true }),
  ).toHaveValue("unknown");
  await expect(
    page.getByRole("combobox", { name: "Station", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("combobox", { name: "Alliance", exact: true })
    .selectOption("blue");
  await page
    .getByRole("combobox", { name: "Station", exact: true })
    .selectOption("2");
  await page
    .getByLabel("Match notes / breakdown detail")
    .fill("Watching team 2002 on blue, independent of our pit schedule.");
  // Selecting our red-alliance match or a practice must not overwrite the robot being observed.
  for (const key of ["2026test_qm17", "p1", "2026test_qm4"]) {
    await loaded.selectOption(key);
    await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
      "2002",
    );
    await expect(
      page.getByRole("combobox", { name: "Alliance", exact: true }),
    ).toHaveValue("blue");
    await expect(
      page.getByRole("combobox", { name: "Station", exact: true }),
    ).toHaveValue("2");
  }
  await captureScouting(page, test.info(), "all-event-capture");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(
    page
      .locator(".scouting [role=status]")
      .filter({ hasText: "Synced to the team database." }),
  ).toBeVisible();
  expect(fixture.submissions()).toHaveLength(1);
  expect(fixture.submissions()[0].body.p).toMatchObject({
    event_id: eventId,
    kind: "match",
    team_number: 2002,
    match_key: "2026test_qm4",
    data: {
      match_label: "Q4",
      alliance: "blue",
      station: 2,
      notes: "Watching team 2002 on blue, independent of our pit schedule.",
    },
  });
  expect(fixture.state.observations).toHaveLength(1);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting refreshed all-event choices preserve a draft's selected key, label, team, alliance, and notes", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page, "1002");
  const loaded = page.getByLabel("Choose a loaded match");
  await loaded.selectOption("2026test_qm4");
  await page
    .getByLabel("Match label", { exact: true })
    .fill("Q4 · scout's reviewed label");
  await page
    .getByRole("combobox", { name: "Alliance", exact: true })
    .selectOption("red");
  await page
    .getByLabel("Match notes / breakdown detail")
    .fill("Keep this observation when the schedule refreshes.");
  const original = fixture.feed.scoutingMatches![0];
  fixture.feed.scoutingMatches = [
    { ...original, label: "Q4 updated", blue: ["3001", "3002", "3003"] },
    { ...original, key: "2026test_qm5", label: "Q5", number: 5 },
    ...fixture.feed.matches,
  ];
  fixture.feed.tbaAt = Date.now();
  await refreshScoutingMatches(page);
  await expect(loaded.locator('option[value="2026test_qm4"]')).toHaveText(
    "Q4 updated · Red 1001/1002/1003 vs Blue 3001/3002/3003",
  );
  await expect(loaded.locator('option[value="2026test_qm5"]')).toHaveCount(1);
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue(
    "2026test_qm4",
  );
  await expect(page.getByLabel("Match label", { exact: true })).toHaveValue(
    "Q4 · scout's reviewed label",
  );
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "1002",
  );
  await expect(
    page.getByRole("combobox", { name: "Alliance", exact: true }),
  ).toHaveValue("red");
  await expect(page.getByLabel("Match notes / breakdown detail")).toHaveValue(
    "Keep this observation when the schedule refreshes.",
  );
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect.poll(() => fixture.state.observations.length).toBe(1);
  expect(fixture.state.observations[0]).toMatchObject({
    team_number: 1002,
    match_key: "2026test_qm4",
    data: {
      match_label: "Q4 · scout's reviewed label",
      alliance: "red",
      notes: "Keep this observation when the schedule refreshes.",
    },
  });
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting all-event schedule does not expand operational Matches or dashboard progress beyond team 4418", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page);
  await expect(
    page
      .getByLabel("Choose a loaded match")
      .locator('option[value="2026test_qm4"]'),
  ).toHaveCount(1);
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Matches", exact: true })
    .click();
  await expect(page.locator(".competition .comp-row")).toHaveCount(2);
  await expect(
    page.locator(".competition .comp-row .comp-match-title strong"),
  ).toHaveText(["Practice 1", "Q17"]);
  await expect(
    page.locator(".competition").getByText("Q4", { exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await expect(page.locator(".comp-progress button strong")).toHaveText([
    "Q17",
  ]);
  await expect(page.locator(".comp-dashboard")).toContainText(
    "4418: 0 of 1 published qualification matches complete",
  );
  await expect(page.locator(".comp-next")).toContainText("Practice 1");
  await expect(
    page.locator(".comp-dashboard").getByText("Q4", { exact: true }),
  ).toHaveCount(0);
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting older feed falls back to explicitly limited team matches while manual practices remain selectable", async ({
  page,
}) => {
  const fixture = await setupScouting(page, { legacyFeed: true });
  await fillMatch(page);
  const loaded = page.getByLabel("Choose a loaded match");
  await expect(loaded.locator("option")).toHaveCount(3);
  await expect(loaded.locator('option[value="2026test_qm4"]')).toHaveCount(0);
  await expect(page.locator(".scouting")).toContainText(
    "Limited schedule: only the pit team’s matches are loaded, plus saved practices.",
  );
  await loaded.selectOption("2026test_qm17");
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue(
    "2026test_qm17",
  );
  await loaded.selectOption("p1");
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue("p1");
  await expect(page.getByLabel("Match label", { exact: true })).toHaveValue(
    "Practice 1",
  );
  await page.getByLabel("Match ID", { exact: true }).fill("qm99");
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue(
    "qm99",
  );
  // A present empty all-event list is authoritative, even if the legacy team list remains populated.
  fixture.feed.scoutingMatches = [];
  await refreshScoutingMatches(page);
  await expect(loaded.locator("option")).toHaveText([
    "Manual entry / select…",
    "Practice 1 · Practice",
  ]);
  await expect(page.locator(".scouting")).toContainText(
    "All event matches from TBA, plus saved practices.",
  );
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue(
    "qm99",
  );
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting failed refresh preserves all-event choices and successful empty schedule clears official choices only", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page, "2001");
  const loaded = page.getByLabel("Choose a loaded match");
  await loaded.selectOption("2026test_qm4");
  fixture.feed.matches = [];
  fixture.feed.scoutingMatches = [];
  fixture.feed.tbaError = "Synthetic TBA outage";
  fixture.feed.tbaAt = null;
  await refreshScoutingMatches(page);
  await expect(loaded.locator('option[value="2026test_qm4"]')).toHaveCount(1);
  await expect(loaded.locator('option[value="2026test_qm17"]')).toHaveCount(1);
  await expect(page.locator(".scouting")).toContainText(
    "Last loaded schedule may be stale.",
  );
  fixture.feed.tbaError = null;
  fixture.feed.tbaAt = Date.now();
  await refreshScoutingMatches(page);
  await expect(loaded.locator("option")).toHaveText([
    "Manual entry / select…",
    "Practice 1 · Practice",
  ]);
  await expect(page.locator(".scouting")).toContainText(
    "All event matches from TBA, plus saved practices.",
  );
  await expect(page.locator(".scouting")).not.toContainText(
    "Last loaded schedule may be stale.",
  );
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue(
    "2026test_qm4",
  );
  await expect(page.getByLabel("Match label", { exact: true })).toHaveValue(
    "Q4",
  );
  await loaded.selectOption("p1");
  await expect(page.getByLabel("Match label", { exact: true })).toHaveValue(
    "Practice 1",
  );
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("scouting event switch never offers the previous event's official matches or practices while the new feed loads", async ({
  page,
}) => {
  const fixture = await setupScouting(page);
  await fillMatch(page, "2002");
  await page.getByLabel("Choose a loaded match").selectOption("2026test_qm4");
  const nextMatch = {
    ...fixture.feed.scoutingMatches![0],
    key: "2026previous_qm3",
    label: "Q3",
    number: 3,
  };
  fixture.data.pit_events[0].status = "completed";
  fixture.data.pit_events[1].status = "active";
  fixture.competition.config = {
    ...fixture.competition.config,
    event_id: historicalEventId,
    tba_event_key: "2026previous",
    version: 2,
  };
  fixture.competition.matches = [
    {
      ...fixture.competition.matches[0],
      id: "40000000-0000-4000-8000-000000000002",
      event_id: historicalEventId,
      match_key: "p2",
      manual_label: "Practice 2",
    },
  ];
  Object.assign(fixture.feed, {
    eventId: historicalEventId,
    eventKey: "2026previous",
    eventName: "Synthetic Previous Event",
    configVersion: 2,
    matches: [],
    scoutingMatches: [nextMatch],
  });
  const held = fixture.holdNext("feed");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await held.started;
  await page.getByLabel("Scouting event").selectOption(historicalEventId);
  await fillMatch(page, "1001", "qm3");
  const loaded = page.getByLabel("Choose a loaded match");
  await expect(
    loaded.locator(
      'option[value="2026test_qm4"], option[value="2026test_qm17"], option[value="p1"]',
    ),
  ).toHaveCount(0);
  await held.release();
  await expect(loaded.locator("option")).toHaveText([
    "Manual entry / select…",
    "Q3 · Red 1001/1002/1003 vs Blue 2001/2002/2003",
    "Practice 2 · Practice",
  ]);
  await loaded.selectOption("2026previous_qm3");
  await expect(page.getByLabel("Match ID", { exact: true })).toHaveValue(
    "2026previous_qm3",
  );
  await page.getByLabel("Scouting event").selectOption(eventId);
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New match report", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Choose a loaded match")).toHaveCount(0);
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

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
    .getByRole("button", { name: "Set 0 fuel", exact: true })
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
    page.getByRole("heading", { name: "No event teams loaded yet" }),
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
