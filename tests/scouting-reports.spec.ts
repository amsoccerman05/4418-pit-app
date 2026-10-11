import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  actorId,
  otherActorId,
  eventId,
  historicalEventId,
  observation,
  setupScouting,
  scoutTab,
  navigateScouting,
  emitScoutingAuth,
  refreshScoutingTeams,
} from "./scouting-fixture";

const directory = Array.from({ length: 32 }, (_, index) => ({
  key: `frc${1001 + index}`,
  number: 1001 + index,
  name: `Synthetic roster team ${1001 + index}`,
}));
const teamCard = (page: Page, team: number) =>
  page.locator(".scout-team").filter({
    has: page.getByRole("heading", { name: `Team ${team}`, exact: true }),
  });
const reportsButton = (page: Page, team: number) =>
  teamCard(page, team).getByRole("button", {
    name: "Reports & notes",
    exact: true,
  });
const reportDialog = (page: Page, team: number) =>
  page.getByRole("dialog", {
    name: `Team ${team} · reports & notes`,
    exact: true,
  });
async function openReports(page: Page, team: number) {
  await reportsButton(page, team).click();
  const dialog = reportDialog(page, team);
  await expect(dialog).toBeVisible();
  return dialog;
}
async function closeReports(dialog: Locator) {
  await dialog
    .getByRole("button", { name: "Close reports", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
const fullField = (article: Locator, name: string) =>
  article
    .locator(".scout-observation-fields")
    .getByText(name, { exact: true })
    .locator("..")
    .locator("dd");
async function expectContained(page: Page, dialog: Locator) {
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await dialog
      .locator(".scout-report-body")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
}
function correctionFixture() {
  const original = observation(1, 1001, {
    match_label: "Qualification 17",
    notes: "Archived drivetrain note.",
    auto_fuel: 90,
    teleop_fuel: 90,
  });
  const corrected = {
    ...observation(2, 1001, {
      match_label: "Qualification 17",
      notes: "Reviewed drivetrain tally.",
      auto_fuel: 0,
      teleop_fuel: null,
      auto_climb: "not_attempted",
      endgame: "failed",
      driver: 1,
      defense: null,
      alliance: "red",
      station: 2,
    }),
    match_key: original.match_key,
    supersedes_id: original.id,
    scout_id: actorId,
    created_by: otherActorId,
  };
  const separate = observation(3, 1001, {
    match_label: "Practice warmup",
    notes: "Intake held steady.",
  });
  const pit = observation(
    4,
    1001,
    {
      drive: "swerve",
      intake: "both",
      capacity: 0,
      traversal: "both",
      climb: "L3",
      auto_notes: "Two-piece autonomous route.",
      notes: "Pit interview with mechanical team.",
    },
    "pit",
  );
  return { original, corrected, separate, pit };
}

test("reports open immediately from the first card of a 32-team roster and restore focus after repeated pointer and keyboard use", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    feed: { eventTeams: directory, matches: [], scoutingMatches: [] },
    observations: [
      observation(1, 1001, { notes: "First roster team report." }),
      observation(2, 1002, { notes: "Second roster team report." }),
    ],
  });
  await scoutTab(page, "Teams");
  await expect(page.locator(".scout-team")).toHaveCount(32);
  const firstButton = reportsButton(page, 1001);
  await firstButton.scrollIntoViewIfNeeded();
  const initialScroll = await page.evaluate(() => window.scrollY);
  if (test.info().project.name === "phone") await firstButton.tap();
  else await firstButton.click();
  const firstDialog = reportDialog(page, 1001);
  await expect(firstDialog).toBeVisible();
  await expect(firstDialog).toContainText("First roster team report.");
  await expectContained(page, firstDialog);
  expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
  await expect(
    firstDialog.getByRole("button", { name: "Close reports" }),
  ).toBeFocused();
  const path = test.info().outputPath("reports-first-roster-card.png");
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach("Reports opened from the first roster card", {
    path,
    contentType: "image/png",
  });
  // The native modal must keep keyboard navigation out of the long roster behind it.
  for (const direction of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press(direction);
      expect(
        await firstDialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
  }
  await page.keyboard.press("Escape");
  await expect(firstDialog).toHaveCount(0);
  await expect(firstButton).toBeFocused();
  await firstButton.press("Enter");
  await expect(firstDialog).toBeVisible();
  await closeReports(firstDialog);
  await expect(firstButton).toBeFocused();
  await firstButton.press("Space");
  await expect(firstDialog).toBeVisible();
  await closeReports(firstDialog);
  const secondDialog = await openReports(page, 1002);
  await expect(secondDialog).toContainText("Second roster team report.");
  await expect(secondDialog).not.toContainText("First roster team report.");
  await closeReports(secondDialog);
  await expect(reportsButton(page, 1002)).toBeFocused();
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("report type, human-facing search, and correction history compose without changing reports or team summary", async ({
  page,
}) => {
  const { original, corrected, separate, pit } = correctionFixture();
  const fixture = await setupScouting(page, {
    observations: [original, corrected, separate, pit],
  });
  const immutable = structuredClone(fixture.state.observations);
  await scoutTab(page, "Teams");
  const summaryBefore = await teamCard(page, 1001).innerText();
  let dialog = await openReports(page, 1001);
  const cards = dialog.locator(".scout-report");
  const search = dialog.getByLabel("Search reports", { exact: true });
  const type = dialog.getByLabel("Report type", { exact: true });
  const history = dialog.getByLabel("Include superseded reports", {
    exact: true,
  });
  await expect(history).not.toBeChecked();
  await expect(cards).toHaveCount(3);
  await expect(dialog).not.toContainText("Archived drivetrain note.");
  await type.selectOption("pit");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Pit interview");
  await search.fill("  AUTONOMOUS  ");
  await expect(cards).toHaveCount(1);
  await type.selectOption("match");
  await expect(cards).toHaveCount(0);
  await search.fill("qualification 17");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Reviewed drivetrain tally.");
  await search.fill("fixture scout b");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Reviewed drivetrain tally.");
  await search.fill("archived drivetrain");
  await expect(cards).toHaveCount(0);
  await history.check();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Superseded");
  await expect(
    cards.getByRole("button", { name: "Correct this report" }),
  ).toHaveCount(0);
  await type.selectOption("all");
  await search.fill("");
  await expect(cards).toHaveCount(4);
  const correction = cards.filter({ hasText: "Reviewed drivetrain tally." });
  await expect(correction).toContainText("Corrected");
  await expect(correction).toContainText(/Submitted by\s+Fixture Scout B/);
  await expect(correction).toContainText(
    /Original scout\s*:?\s*Fixture Scout A/,
  );
  await history.uncheck();
  await expect(cards).toHaveCount(3);
  await closeReports(dialog);
  expect(await teamCard(page, 1001).innerText()).toBe(summaryBefore);
  dialog = await openReports(page, 1001);
  await expect(
    dialog.getByLabel("Search reports", { exact: true }),
  ).toHaveValue("");
  await expect(dialog.getByLabel("Report type", { exact: true })).toHaveValue(
    "all",
  );
  await expect(
    dialog.getByLabel("Include superseded reports"),
  ).not.toBeChecked();
  expect(fixture.state.observations).toEqual(immutable);
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("full match and pit details preserve zero, missing values, flags, notes, and safe scout attribution", async ({
  page,
}) => {
  const { corrected, original, pit } = correctionFixture();
  const blankId = "10000000-0000-4000-8000-000000000003";
  const emailId = "10000000-0000-4000-8000-000000000004";
  const missingId = "10000000-0000-4000-8000-000000000005";
  const unknown = [blankId, emailId, missingId].map((created_by, index) => ({
    ...observation(10 + index, 1001, { notes: `Anonymous fixture ${index}.` }),
    created_by,
  }));
  const fixture = await setupScouting(page, {
    observations: [original, corrected, pit, ...unknown],
    profiles: [
      { id: blankId, display_name: "   ", role: "student", active: true },
      {
        id: emailId,
        display_name: "private-scout@example.invalid",
        role: "student",
        active: true,
      },
    ],
  });
  await scoutTab(page, "Teams");
  const dialog = await openReports(page, 1001);
  const match = dialog
    .locator(".scout-report")
    .filter({ hasText: "Reviewed drivetrain tally." });
  await match.getByText("View full observation", { exact: true }).click();
  await expect(match).toContainText("Unknown / not recorded");
  await expect(match).toContainText("Did not attempt a climb");
  await expect(match).toContainText("Attempted, but failed");
  await expect(match).toContainText("Struggled with control");
  for (const [name, value] of [
    ["Alliance", "Red"],
    ["Driver station", "2"],
    ["Start position", "Unknown / not recorded"],
    ["AUTO fuel", "0"],
    ["TELEOP fuel", "Unknown / not recorded"],
    ["AUTO climb", "Did not attempt a climb"],
    ["Endgame climb", "Attempted, but failed"],
    ["Estimated accuracy", "Unknown / not recorded"],
    ["Main role", "Unknown / not recorded"],
    ["Field traversal", "Unknown / not recorded"],
    ["Fuel intake", "Unknown / not recorded"],
    ["Driver ability", "1 · Struggled with control"],
    ["Defense effectiveness", "Not rated"],
    ["Disabled / breakdown", "Not flagged"],
    ["No-show", "Not flagged"],
  ]) {
    await expect(fullField(match, name)).toHaveText(value);
  }
  await expect(match.locator("time")).toHaveAttribute(
    "datetime",
    corrected.created_at,
  );
  await dialog
    .getByLabel("Search reports", { exact: true })
    .fill("Reviewed drivetrain tally.");
  await dialog.evaluate((element) => {
    element.scrollTop = 0;
  });
  const detailPath = test.info().outputPath("reports-correction-details.png");
  await page.screenshot({
    path: detailPath,
    animations: "disabled",
    caret: "hide",
  });
  await test
    .info()
    .attach("Report correction details", {
      path: detailPath,
      contentType: "image/png",
    });
  await dialog.getByLabel("Search reports", { exact: true }).fill("");
  const interview = dialog
    .locator(".scout-report")
    .filter({ hasText: "Pit interview with mechanical team." });
  await interview.getByText("View full observation", { exact: true }).click();
  await expect(interview).toContainText("Swerve");
  await expect(interview).toContainText("Two-piece autonomous route.");
  await expect(interview).toContainText("Pit interview with mechanical team.");
  for (const [name, value] of [
    ["Drivetrain", "Swerve"],
    ["Fuel intake", "Both"],
    ["Fuel capacity", "0"],
    ["Field traversal", "Both"],
    ["Climb capability", "L3"],
  ]) {
    await expect(fullField(interview, name)).toHaveText(value);
  }
  for (let index = 0; index < unknown.length; index++) {
    const article = dialog
      .locator(".scout-report")
      .filter({ hasText: `Anonymous fixture ${index}.` });
    await expect(article).toContainText(/Submitted by\s+Unknown scout/);
  }
  for (const identity of [
    actorId,
    otherActorId,
    blankId,
    emailId,
    missingId,
    "private-scout@example.invalid",
  ]) {
    await expect(dialog).not.toContainText(identity);
  }
  await expectContained(page, dialog);
  expect(fixture.pageErrors).toEqual([]);
});

for (const role of ["student", "mentor", "readonly"] as const) {
  test(`report corrections enforce ${role} permissions and never allow superseded edits`, async ({
    page,
  }) => {
    const { original, corrected } = correctionFixture();
    const other = {
      ...observation(3, 1001, { notes: "Other scout current report." }),
      created_by: otherActorId,
    };
    // The submitting actor is not necessarily the original scout of a correction.
    const changedByCurrentActor = {
      ...observation(4, 1001, {
        notes: "Submitted by A for original scout B.",
      }),
      match_key: other.match_key,
      supersedes_id: other.id,
      scout_id: otherActorId,
      created_by: actorId,
    };
    const fixture = await setupScouting(page, {
      role,
      observations: [original, corrected, other, changedByCurrentActor],
    });
    await scoutTab(page, "Teams");
    const dialog = await openReports(page, 1001);
    const own = dialog
      .locator(".scout-report")
      .filter({ hasText: "Reviewed drivetrain tally." });
    const someoneElse = dialog
      .locator(".scout-report")
      .filter({ hasText: "Submitted by A for original scout B." });
    await expect(
      own.getByRole("button", { name: "Correct this report" }),
    ).toHaveCount(role === "readonly" ? 0 : 1);
    await expect(
      someoneElse.getByRole("button", { name: "Correct this report" }),
    ).toHaveCount(role === "mentor" ? 1 : 0);
    await dialog.getByLabel("Include superseded reports").check();
    for (const note of [
      "Archived drivetrain note.",
      "Other scout current report.",
    ]) {
      const superseded = dialog
        .locator(".scout-report")
        .filter({ hasText: note });
      await expect(superseded).toContainText("Superseded");
      await expect(
        superseded.getByRole("button", { name: "Correct this report" }),
      ).toHaveCount(0);
    }
    if (role !== "readonly") {
      await own.getByRole("button", { name: "Correct this report" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Correct report", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
        "1001",
      );
      await expect(
        page.getByLabel("Team number", { exact: true }),
      ).not.toBeEditable();
      await expect(page.getByLabel("AUTO fuel", { exact: true })).toHaveValue(
        "0",
      );
      await expect(page.getByLabel("TELEOP fuel", { exact: true })).toHaveValue(
        "",
      );
      await page
        .getByRole("button", { name: "Close draft", exact: true })
        .click();
    }
    expect(fixture.mutations()).toHaveLength(0);
    expect(fixture.pageErrors).toEqual([]);
  });
}

test("report selection and filters do not leak between teams or events, including a delayed old response", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    feed: { eventTeams: directory, matches: [], scoutingMatches: [] },
    observations: [
      observation(1, 1001, { notes: "Active-event observation only." }),
      {
        ...observation(2, 1001, { notes: "Previous-event observation only." }),
        event_id: historicalEventId,
      },
    ],
  });
  await scoutTab(page, "Teams");
  let dialog = await openReports(page, 1001);
  await dialog
    .getByLabel("Search reports", { exact: true })
    .fill("Active-event");
  await dialog.getByLabel("Report type", { exact: true }).selectOption("match");
  await dialog.getByLabel("Include superseded reports").check();
  await closeReports(dialog);
  dialog = await openReports(page, 1002);
  await expect(dialog).toContainText("Not scouted yet");
  await expect(dialog.locator(".scout-report")).toHaveCount(0);
  await expect(
    dialog.getByLabel("Search reports", { exact: true }),
  ).toHaveValue("");
  await expect(dialog.getByLabel("Report type", { exact: true })).toHaveValue(
    "all",
  );
  await expect(
    dialog.getByLabel("Include superseded reports"),
  ).not.toBeChecked();
  await closeReports(dialog);
  const delayed = fixture.holdNext("rpc/pit_scouting_context");
  await page
    .getByRole("button", { name: "Refresh team data", exact: true })
    .click();
  await delayed.started;
  await page.getByLabel("Scouting event").selectOption(historicalEventId);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await scoutTab(page, "Teams");
  dialog = await openReports(page, 1001);
  await expect(dialog).toContainText("Previous-event observation only.");
  await expect(dialog).not.toContainText("Active-event observation only.");
  await expect(
    dialog.getByRole("button", { name: "Correct this report" }),
  ).toHaveCount(0);
  await delayed.release();
  await expect(dialog).toContainText("Previous-event observation only.");
  await expect(dialog).not.toContainText("Active-event observation only.");
  await closeReports(dialog);
  await page.getByLabel("Scouting event").selectOption(eventId);
  await scoutTab(page, "Teams");
  dialog = await openReports(page, 1001);
  await expect(dialog).toContainText("Active-event observation only.");
  await expect(dialog).not.toContainText("Previous-event observation only.");
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("report dialog keeps cached notes readable with offline and failed-refresh warnings", async ({
  page,
  context,
}) => {
  const fixture = await setupScouting(page, {
    observations: [
      observation(1, 1001, { notes: "Previously loaded fixture notes." }),
    ],
  });
  await scoutTab(page, "Teams");
  let dialog = await openReports(page, 1001);
  await context.setOffline(true);
  await expect(dialog).toContainText(/offline/i);
  await expect(dialog).toContainText("Previously loaded fixture notes.");
  await closeReports(dialog);
  await context.setOffline(false);
  await expect(page.locator(".scout-sync")).not.toContainText("Offline");
  // Wait for the reconnect read before failing a distinct reviewed refresh.
  await refreshScoutingTeams(page);
  fixture.failNext(
    "rpc/pit_scouting_context",
    "Synthetic report service unavailable",
  );
  await refreshScoutingTeams(page);
  dialog = await openReports(page, 1001);
  await expect(dialog).toContainText("Synthetic report service unavailable");
  await expect(dialog).toContainText(/last loaded|outdated|stale/i);
  await expect(dialog).toContainText("Previously loaded fixture notes.");
  await expectContained(page, dialog);
  await closeReports(dialog);
  await refreshScoutingTeams(page);
  dialog = await openReports(page, 1001);
  await expect(dialog).not.toContainText(
    "Synthetic report service unavailable",
  );
  await expect(dialog).toContainText("Previously loaded fixture notes.");
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("loading reports is distinct from an empty team and resolves inside the open dialog", async ({
  page,
}) => {
  let release!: () => void;
  const contextGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await setupScouting(page, {
    contextGate,
    feed: { eventTeams: directory, matches: [], scoutingMatches: [] },
    observations: [observation(1, 1001, { notes: "Freshly loaded report." })],
  });
  try {
    await scoutTab(page, "Teams");
    const dialog = await openReports(page, 1001);
    await expect(dialog).toContainText(/loading/i);
    await expect(dialog).not.toContainText("Not scouted yet");
    release();
    await expect(dialog).toContainText("Freshly loaded report.");
    await expect(dialog).not.toContainText(/loading reports/i);
    await expect(dialog.locator(".scout-report")).toHaveCount(1);
    expect(fixture.mutations()).toHaveLength(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    release();
  }
});

test("a failed first report load never labels a team unscouted", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    contextError: "Synthetic first report read failed",
    feed: { eventTeams: directory, matches: [], scoutingMatches: [] },
  });
  await scoutTab(page, "Teams");
  const dialog = await openReports(page, 1001);
  await expect(dialog).toContainText("Synthetic first report read failed");
  await expect(dialog).not.toContainText("Not scouted yet");
  await expect(dialog.locator(".scout-report")).toHaveCount(0);
  await closeReports(dialog);
  fixture.clearContextError();
  await refreshScoutingTeams(page);
  const recovered = await openReports(page, 1001);
  await expect(recovered).toContainText("Not scouted yet");
  await expect(recovered).not.toContainText(
    "Synthetic first report read failed",
  );
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("correcting a report from the final roster card focuses a visible form above the old scroll position", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    feed: { eventTeams: directory, matches: [], scoutingMatches: [] },
    observations: [
      observation(1, 1032, { notes: "Final-card correction fixture." }),
    ],
  });
  await scoutTab(page, "Teams");
  await reportsButton(page, 1032).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY > innerHeight)).toBe(true);
  const dialog = await openReports(page, 1032);
  await dialog
    .getByRole("button", { name: "Correct this report", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const heading = page.getByRole("heading", {
    name: "Correct report",
    exact: true,
  });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  if (test.info().project.name === "phone") {
    const headingBox = await heading.boundingBox();
    const barBox = await page.locator(".suite-header").boundingBox();
    expect(headingBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(headingBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
  }
  await expect(page.getByLabel("Team number", { exact: true })).toHaveValue(
    "1032",
  );
  await page.getByRole("button", { name: "Close draft", exact: true }).click();
  await scoutTab(page, "Teams");
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("report refresh resolves in place, retains filters, and long notes cannot overflow the modal", async ({
  page,
}) => {
  const longNote = "Synthetic unbroken note " + "fixture".repeat(240);
  const fixture = await setupScouting(page, {
    observations: [observation(1, 1001, { notes: longNote }, "pit")],
  });
  await scoutTab(page, "Teams");
  const dialog = await openReports(page, 1001);
  await dialog.getByLabel("Report type", { exact: true }).selectOption("pit");
  await dialog.getByLabel("Search reports", { exact: true }).fill("Synthetic");
  await expectContained(page, dialog);
  fixture.state.observations.push(
    observation(2, 1001, { notes: "Synthetic second interview." }, "pit"),
  );
  const pending = fixture.holdNext("rpc/pit_scouting_context");
  await dialog
    .getByRole("button", { name: "Refresh reports", exact: true })
    .click();
  await pending.started;
  await expect(
    dialog.getByRole("button", { name: "Refreshing reports…", exact: true }),
  ).toBeDisabled();
  await expect(dialog.locator(".scout-report")).toHaveCount(1);
  await pending.release();
  await expect(dialog.locator(".scout-report")).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "Refresh reports", exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByLabel("Report type", { exact: true })).toHaveValue(
    "pit",
  );
  await expect(
    dialog.getByLabel("Search reports", { exact: true }),
  ).toHaveValue("Synthetic");
  await expect(dialog.locator(".scout-result-count")).toContainText(
    "Showing 2 reports",
  );
  await expectContained(page, dialog);
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});

test("account changes and reload dismiss report selection and clean up the modal scroll lock", async ({
  page,
}) => {
  const fixture = await setupScouting(page, {
    observations: [
      observation(1, 1001, { notes: "Synthetic account-scope report." }),
    ],
  });
  await scoutTab(page, "Teams");
  const dialog = await openReports(page, 1001);
  await dialog
    .getByLabel("Search reports", { exact: true })
    .fill("account-scope");
  await emitScoutingAuth(page, otherActorId);
  await expect(page.locator(".suite-name")).toHaveText("Fixture Scout B");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  await scoutTab(page, "Teams");
  const reopened = await openReports(page, 1001);
  await expect(
    reopened.getByLabel("Search reports", { exact: true }),
  ).toHaveValue("");
  await expect(
    reopened.getByRole("button", { name: "Correct this report" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Competition dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  await navigateScouting(page);
  await expect(page.locator(".scout-sync")).toContainText("Team data checked");
  await scoutTab(page, "Teams");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(reportsButton(page, 1001)).toBeEnabled();
  expect(fixture.mutations()).toHaveLength(0);
  expect(fixture.pageErrors).toEqual([]);
});
