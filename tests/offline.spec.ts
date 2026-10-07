import { expect, test } from "@playwright/test";
import {
  assertPrivateDataNotPersisted,
  assertPrivateSnapshotCleared,
  captureOfflineState,
  emitAuth,
  navigate,
  refreshStorm,
  setupOffline,
} from "./offline-fixture";

test("loaded private pit data stays readable offline, disables writes and refreshes on reconnect", async ({
  page,
  context,
}) => {
  const fixture = await setupOffline(page);
  const lastLoaded = await page
    .locator(".connection-status p")
    .first()
    .textContent();
  await assertPrivateDataNotPersisted(page);
  await context.setOffline(true);
  const banner = page.locator(".connection-status");
  await expect(banner).toContainText("Offline · read-only");
  await expect(banner).toContainText("Last loaded issues / batteries:");
  await expect(banner).not.toContainText("Not loaded");
  await expect(banner.locator("p").first()).toHaveText(lastLoaded!);
  await expect(page.locator(".comp-next")).toContainText("Q17");
  await expect(page.locator(".comp-readiness")).toContainText("VERIFY STATUS");
  await captureOfflineState(page, test.info(), "offline-dashboard");

  await page
    .getByRole("button", { name: "Open pit display", exact: true })
    .click();
  const display = page.getByRole("dialog", {
    name: "Pit display",
    exact: true,
  });
  await expect(display).toContainText("Q17");
  await expect(display).toContainText("B01");
  await expect(display).toContainText("VERIFY STATUS");
  await captureOfflineState(page, test.info(), "offline-pit-display", false);
  await page
    .getByRole("button", { name: "Close pit display", exact: true })
    .click();

  await navigate(page, "Batteries");
  await expect(
    page.getByRole("heading", { name: "B01", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Private battery notes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Install on robot", exact: true }),
  ).toBeDisabled();
  await captureOfflineState(
    page,
    test.info(),
    "offline-battery-actions-disabled",
  );
  await navigate(page, "Robot / Issues");
  await expect(
    page.getByRole("button", { name: /Private pit repair/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report issue", exact: true }),
  ).toBeDisabled();
  await navigate(page, "Checklists");
  await expect(
    page.getByRole("heading", { name: "Snapshot preflight", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Latch check/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New template", exact: true }),
  ).toBeDisabled();
  expect(fixture.writes()).toHaveLength(0);
  await assertPrivateDataNotPersisted(page);
  await captureOfflineState(
    page,
    test.info(),
    "offline-checklist-actions-disabled",
  );

  fixture.data.pit_batteries[0].notes = "Fresh data after reconnect";
  fixture.context.items[0].completed_at = new Date().toISOString();
  fixture.feed.matches[0].label = "Q18";
  const readsBeforeReconnect = fixture.count("table/pit_batteries");
  await navigate(page, "Dashboard");
  await context.setOffline(false);
  await expect
    .poll(() => fixture.count("table/pit_batteries"))
    .toBeGreaterThan(readsBeforeReconnect);
  await expect(page.locator(".comp-next")).toContainText("Q18");
  await expect(banner).not.toContainText("read-only");
  await navigate(page, "Batteries");
  await expect(
    page.getByText("Fresh data after reconnect", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Install on robot", exact: true }),
  ).toBeEnabled();
  expect(fixture.writes()).toHaveLength(0);
});

test("failed background reads retain the last successful snapshot and can recover", async ({
  page,
}) => {
  const fixture = await setupOffline(page);
  const lastLoaded = await page
    .locator(".connection-status p")
    .first()
    .textContent();
  fixture.errors.set("table/pit_batteries", "Fixture connection interrupted");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.locator(".connection-status")).toContainText(
    "Pit data may be stale · read-only",
  );
  await expect(page.locator(".comp-next")).toContainText("Q17");
  await expect(page.locator(".connection-status p").first()).toHaveText(
    lastLoaded!,
  );
  await navigate(page, "Batteries");
  await expect(
    page.getByText("Private battery notes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Install on robot", exact: true }),
  ).toBeDisabled();
  await assertPrivateDataNotPersisted(page);
  fixture.errors.clear();
  await page
    .getByRole("button", { name: "Retry connection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Install on robot", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".connection-status")).not.toContainText(
    "read-only",
  );
});

test("competition context failures preserve loaded checklists and disable their mutations", async ({
  page,
}) => {
  const fixture = await setupOffline(page);
  fixture.errors.set(
    "rpc/pit_competition_context",
    "Checklist read interrupted",
  );
  await page
    .getByRole("button", { name: "Refresh schedule", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Checklist read interrupted" }),
  ).toBeVisible();
  await navigate(page, "Checklists");
  await expect(
    page.getByRole("heading", { name: "Snapshot preflight", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Latch check/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New template", exact: true }),
  ).toBeDisabled();
  expect(fixture.writes()).toHaveLength(0);
});

test("a failed external schedule request keeps the last schedule with a stale warning", async ({
  page,
}) => {
  const fixture = await setupOffline(page);
  fixture.errors.set("feed", "Schedule connection interrupted");
  await page
    .getByRole("button", { name: "Refresh schedule", exact: true })
    .click();
  await expect(page.locator(".comp-feed")).toContainText(
    "Last loaded schedule may be stale",
  );
  await expect(page.locator(".comp-feed")).toContainText("Last TBA snapshot");
  await expect(page.locator(".comp-feed")).not.toContainText("Nexus live");
  await expect(page.locator(".comp-next")).toContainText("Q17");
  await expect(page.locator(".comp-next")).not.toContainText("Now queuing");
  expect(fixture.writes()).toHaveLength(0);
  fixture.errors.clear();
  await page
    .getByRole("button", { name: "Refresh schedule", exact: true })
    .click();
  await expect(page.locator(".comp-feed")).toContainText("Nexus live");
});

test("stalled refresh is single-flight and bounded instead of replacing readable data", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await setupOffline(page);
  const before = fixture.count("table/pit_batteries");
  const stalled = fixture.holdNext("table/pit_batteries");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await stalled.started;
  await refreshStorm(page);
  expect(fixture.count("table/pit_batteries")).toBe(before + 1);
  await page.clock.fastForward(12_100);
  await expect(page.locator(".connection-status")).toContainText("read-only");
  await expect(page.locator(".comp-next")).toContainText("Q17");
  await stalled.release();
  await page
    .getByRole("button", { name: "Retry connection", exact: true })
    .click();
  await expect(page.locator(".connection-status")).not.toContainText(
    "read-only",
  );
  await navigate(page, "Batteries");
  await expect(
    page.getByText("Private battery notes", { exact: true }),
  ).toBeVisible();
});

test("a delayed previous-event feed cannot replace the newly selected event", async ({
  page,
}) => {
  const fixture = await setupOffline(page);
  const oldFeed = fixture.holdNext("feed");
  await page
    .getByRole("button", { name: "Refresh schedule", exact: true })
    .click();
  await oldFeed.started;
  fixture.data.pit_events[0] = {
    ...fixture.data.pit_events[0],
    id: "event-two",
    name: "Second regional",
  };
  fixture.context.config = {
    ...fixture.context.config,
    event_id: "event-two",
    tba_event_key: "2026second",
  };
  fixture.context.matches = [];
  fixture.context.runs = [];
  fixture.context.items = [];
  Object.assign(fixture.feed, {
    eventId: "event-two",
    eventKey: "2026second",
    eventName: "Second regional",
    nexus: null,
  });
  fixture.feed.matches = [
    {
      ...fixture.feed.matches[0],
      key: "2026second_qm33",
      label: "Q33",
      number: 33,
    },
  ];
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  // A new event must not wait for the old event's network request to finish.
  await expect(page.locator(".comp-next")).toContainText("Q33");
  await oldFeed.release();
  await expect(page.locator(".comp-feed")).toContainText("Second regional");
  await expect(page.locator(".comp-next")).not.toContainText("Q17");
});

test("account switch clears private snapshots and ignores an older in-flight response", async ({
  page,
}) => {
  const fixture = await setupOffline(page);
  const previousAccount = fixture.holdNext("table/pit_batteries");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await previousAccount.started;
  fixture.data.profiles = [
    {
      id: "person-two",
      display_name: "Second crew",
      role: "mentor",
      active: true,
    },
  ];
  fixture.data.pit_batteries = [
    {
      ...fixture.data.pit_batteries[0],
      id: "battery-two",
      battery_number: "B99",
      notes: "Second account battery",
    },
  ];
  fixture.data.pit_issues = [];
  fixture.context.matches = [];
  fixture.context.runs = [];
  fixture.context.items = [];
  fixture.context.templates = [];
  const newAccount = fixture.holdNext("table/pit_batteries");
  await emitAuth(page, "person-two");
  await newAccount.started;
  await expect(
    page.getByText("Private crew member", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".comp-next")).toHaveCount(0);
  await previousAccount.release();
  await newAccount.release();
  await expect(
    page.getByRole("heading", { name: "Competition dashboard", exact: true }),
  ).toBeVisible();
  await navigate(page, "Batteries");
  await expect(
    page.getByRole("heading", { name: "B99", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Private battery notes", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "B01", exact: true }),
  ).toHaveCount(0);
  await assertPrivateDataNotPersisted(page);
});

test("logging out clears the loaded snapshot even while an earlier read is unresolved", async ({
  page,
}) => {
  const fixture = await setupOffline(page);
  const oldRead = fixture.holdNext("table/pit_batteries");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await oldRead.started;
  await page.evaluate(() => (window as any).__offlineFixture.pauseSignOut());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await oldRead.release();
  await expect(page.getByText("Signing out…", { exact: true })).toBeVisible();
  await assertPrivateSnapshotCleared(page);
  await assertPrivateDataNotPersisted(page);
  await captureOfflineState(
    page,
    test.info(),
    "logout-private-snapshot-cleared",
  );
  await page.evaluate(() => (window as any).__offlineFixture.finishSignOut());
  await expect(
    page.getByRole("heading", { name: "Competition dashboard", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Private crew member", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Team sign in", exact: true }),
  ).toBeVisible();
});

test("an inactive profile removes the private snapshot rather than keeping a stale view", async ({
  page,
}) => {
  const fixture = await setupOffline(page);
  fixture.data.profiles[0].active = false;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(
    page.getByText(/needs an active Team 4418 profile/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Competition dashboard", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Private crew member", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /Latch check/ })).toHaveCount(
    0,
  );
  await assertPrivateDataNotPersisted(page);
});

test("the loaded offline snapshot disappears when its one-hour session expires", async ({
  page,
  context,
}) => {
  await page.clock.install();
  await setupOffline(page);
  await context.setOffline(true);
  await expect(page.locator(".connection-status")).toContainText(
    "Offline · read-only",
  );
  await page.clock.fastForward(3_601_000);
  await expect(
    page.getByRole("heading", { name: "Competition dashboard", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Private crew member", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".comp-next")).toHaveCount(0);
  await assertPrivateSnapshotCleared(page);
  await captureOfflineState(
    page,
    test.info(),
    "expired-session-private-snapshot-cleared",
  );
});

test("a committed battery write with a lost response is never automatically replayed", async ({
  page,
  context,
}) => {
  const fixture = await setupOffline(page);
  await navigate(page, "Batteries");
  fixture.loseNextWrite("rpc/pit_transition_battery");
  await page
    .getByRole("button", { name: "Install on robot", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Save not confirmed. The request may already have completed. Refresh and review the current record before trying again.",
    }),
  ).toBeVisible();
  expect(fixture.count("rpc/pit_transition_battery")).toBe(1);
  expect(fixture.writes()[0].authorization).toBe("Bearer fixture-token-person");
  expect(fixture.data.pit_battery_events).toHaveLength(1);
  expect(fixture.data.pit_batteries[0].status).toBe("ON ROBOT");
  await expect(
    page.getByRole("button", { name: "Install on robot", exact: true }),
  ).toBeDisabled();
  await context.setOffline(true);
  await context.setOffline(false);
  await expect(page.locator(".battery-card")).toContainText("ON ROBOT");
  await expect(
    page.getByRole("button", { name: "Remove battery", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry connection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove battery", exact: true }),
  ).toBeEnabled();
  await refreshStorm(page);
  expect(fixture.count("rpc/pit_transition_battery")).toBe(1);
  expect(fixture.data.pit_battery_events).toHaveLength(1);
  await assertPrivateDataNotPersisted(page);
});
