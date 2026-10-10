import { test, expect, type Page } from "@playwright/test";
import { setup } from "./competition-fixture";

async function liveFixture(page: Page) {
  const fixture = await setup(page),
    { feed } = fixture,
    now = Date.now();
  Object.assign(feed, {
    webcasts: [
      {
        id: "youtube:dQw4w9WgXcQ",
        type: "youtube",
        channel: "dQw4w9WgXcQ",
        status: "unknown",
        title: "Fixture stream",
        date: null,
      },
      {
        id: "twitch:firstinspires",
        type: "twitch",
        channel: "firstinspires",
        status: "online",
        title: "Fixture Twitch",
        date: null,
      },
    ],
    webcastsAt: now,
    webcastsError: null,
    teamEPAs: [
      { team: 4418, total: 0, auto: 0, teleop: 0, endgame: 0 },
      { team: 1619, total: 42.1, auto: 8, teleop: 30, endgame: 4.1 },
    ],
    epaAt: now,
    epaError: null,
    nexusBoard: {
      asOf: now,
      announcements: [
        {
          id: "announce",
          text: "Fixture announcement: queue from the east entrance.",
          at: now,
        },
      ],
      partsRequests: [
        {
          id: "parts",
          text: "Fixture parts request: M4 bolts",
          team: "1619",
          at: now,
        },
      ],
      announcementCount: 1,
      partsRequestCount: 1,
    },
    nexusBoardAt: now,
    nexusBoardError: null,
    pitMap: {
      width: 600,
      height: 400,
      pits: [
        {
          id: "A1",
          x: 100,
          y: 150,
          width: 100,
          height: 100,
          angle: 0,
          team: "4418",
        },
        {
          id: "A2",
          x: 250,
          y: 150,
          width: 100,
          height: 100,
          angle: 0,
          team: "1619",
        },
      ],
      areas: [
        {
          id: "admin",
          x: 450,
          y: 150,
          width: 120,
          height: 100,
          angle: 0,
          label: "Pit admin",
        },
      ],
      labels: [],
      arrows: [],
      walls: [],
    },
    pitMapAt: now,
    pitMapError: null,
    pitAddresses: { "4418": "A1", "1619": "A2" },
    pitAddressesAt: now,
    pitAddressesError: null,
  });
  feed.nexus.matches[0].status = "Queuing soon";
  feed.nexus.matches[0].queue = now + 65000;
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Fixture player. No media loaded.</p>",
    }),
  );
  await page.route("https://player.twitch.tv/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Fixture player. No media loaded.</p>",
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Competition dashboard" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open pit display" }).click();
  return {
    ...fixture,
    display: page.getByRole("dialog", { name: "Pit display" }),
  };
}

test("pit stream is opt-in, closeable, and keeps readiness visible while scrolling", async ({
  page,
}, info) => {
  const { display } = await liveFixture(page);
  await expect(display.locator("iframe")).toHaveCount(0);
  await page.screenshot({
    path: `test-results/pit-live-overview-${info.project.name}.png`,
    fullPage: false,
  });
  await expect(display.locator(".comp-queue-ribbon")).toContainText(
    "RED BUMPERS",
  );
  await expect(display.locator(".comp-queue-ribbon")).toContainText("to queue");
  await expect(
    display.getByText("Live status unknown", { exact: true }),
  ).toBeVisible();
  await display
    .getByRole("button", { name: "Open stream", exact: true })
    .click();
  const frame = display.locator("iframe");
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute(
    "src",
    /youtube-nocookie\.com.*autoplay=0/,
  );
  await expect(frame).not.toHaveAttribute("allow", /fullscreen|autoplay/);
  await frame.scrollIntoViewIfNeeded();
  const ribbon = await display.locator(".comp-queue-ribbon").boundingBox();
  expect(ribbon!.y).toBeGreaterThanOrEqual(0);
  expect(ribbon!.y + ribbon!.height).toBeLessThan(250);
  await page.screenshot({
    path: `test-results/pit-live-stream-${info.project.name}.png`,
    fullPage: false,
  });
  const source = await frame.getAttribute("src");
  await page.waitForTimeout(1100);
  await expect(frame).toHaveAttribute("src", source!);
  await display
    .getByRole("button", { name: "Close stream", exact: true })
    .click();
  await expect(frame).toHaveCount(0);
  await display
    .getByRole("button", { name: "Open stream", exact: true })
    .click();
  await expect(frame).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(frame).toHaveCount(0);
  await expect(display.locator(".comp-queue-ribbon")).toContainText(
    "VERIFY STATUS",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(frame).toHaveCount(0);
});

test("Twitch phone fallback and stream selection never reload video without opt-in", async ({
  page,
}, info) => {
  const { display } = await liveFixture(page);
  await display
    .getByLabel("Choose stream")
    .selectOption("twitch:firstinspires");
  await expect(
    display.getByRole("link", { name: "Watch on Twitch (new tab)" }),
  ).toHaveAttribute("href", "https://www.twitch.tv/firstinspires");
  if (info.project.name === "phone")
    await expect(
      display.getByRole("button", { name: "Open stream", exact: true }),
    ).toBeDisabled();
  else {
    // The local preview is HTTP, so Twitch deliberately uses its verified external fallback.
    await expect(
      display.getByRole("button", { name: "Open stream", exact: true }),
    ).toBeDisabled();
  }
  await display.getByLabel("Choose stream").selectOption("youtube:dQw4w9WgXcQ");
  await expect(display.locator("iframe")).toHaveCount(0);
  await display.getByRole("button", { name: "Close pit display" }).click();
  await expect(display).toHaveCount(0);
  await page.getByRole("button", { name: "Open pit display" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("parts requests locate exact pits, map closes cleanly and layout fits phone", async ({
  page,
}, info) => {
  const { display } = await liveFixture(page);
  await expect(
    display.getByText("Fixture announcement: queue from the east entrance."),
  ).toBeVisible();
  await display
    .getByRole("button", { name: "Find team 1619 at pit A2" })
    .click();
  await expect(display.locator(".event-board-selection")).toContainText("1619");
  await expect(display.locator(".event-board-selection")).toContainText(
    "A2 is highlighted",
  );
  await expect(
    display.getByRole("group", {
      name: "Event pit map. Use team lookup for a text address.",
    }),
  ).toBeVisible();
  await display.locator(".event-board-map-scroll").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/pit-live-map-${info.project.name}.png`,
    fullPage: false,
  });
  expect(await display.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await display.getByLabel("Team number", { exact: true }).fill("9999");
  await display.getByRole("button", { name: "Find pit", exact: true }).click();
  await expect(display.locator(".event-board-selection")).toContainText(
    "No pit location is published",
  );
  await display.getByRole("button", { name: "Close pit map" }).click();
  await expect(display.locator(".event-board-map-content")).toHaveCount(0);
  await display.getByRole("button", { name: "Open pit map" }).click();
  await display.getByLabel("Team number", { exact: true }).press("Escape");
  await expect(display.locator(".event-board-map-content")).toHaveCount(0);
  await expect(display).toBeVisible();
});

test("stale queue and absent optional feeds remain honest and never hide readiness", async ({
  page,
}) => {
  const { feed, display } = await liveFixture(page);
  feed.nexus.asOf = Date.now() - 180000;
  feed.nexusAt = Date.now() - 180000;
  feed.webcasts = [];
  feed.webcastsAt = Date.now();
  feed.teamEPAs = [];
  feed.epaError = "Unavailable";
  feed.nexusBoard = null;
  feed.nexusBoardError = "Unavailable";
  feed.pitMap = null;
  feed.pitMapAt = Date.now();
  await display
    .getByRole("button", { name: "Retry schedule / checklists" })
    .click();
  await expect(display.locator(".comp-queue-ribbon")).toContainText(
    "Live queue unavailable",
  );
  await expect(display.locator(".comp-queue-ribbon")).not.toContainText(
    "to queue",
  );
  await expect(
    display.getByText(
      "No supported YouTube or Twitch stream is listed for this event.",
    ),
  ).toBeVisible();
  await expect(
    display.getByText("No pit map published for this event."),
  ).toBeVisible();
  await expect(display.locator(".comp-epa")).toContainText(
    "Unavailable or stale",
  );
  await expect(display.locator(".comp-display-status")).toContainText(
    "NEEDS ATTENTION",
  );
});

test("one-tap six-team EPA comparison stays alongside private synced scouting and respects event scope", async ({
  page,
}, info) => {
  const { setupScouting, scoutTab, observation, historicalEventId } =
    await import("./scouting-fixture");
  await setupScouting(page, {
    observations: [observation(1, 4418, { auto_fuel: 5, teleop_fuel: 10 })],
    feed: {
      teamEPAs: [
        { team: 4418, total: 0, auto: 0, teleop: null, endgame: null },
        { team: 1619, total: 42.1, auto: 8, teleop: 30, endgame: 4.1 },
      ],
      epaAt: Date.now(),
      epaError: null,
    },
  });
  await scoutTab(page, "Compare");
  await page.getByRole("button", { name: "Compare next 4418 match" }).click();
  await expect(page.locator(".comp-epa-grid article")).toHaveCount(6);
  await expect(
    page
      .locator(".comp-epa-grid article")
      .filter({ hasText: "Team 4418" })
      .locator(".comp-epa-total"),
  ).toHaveText("0.0");
  await expect(
    page
      .locator(".comp-epa-grid article")
      .filter({ hasText: "Team 1339" })
      .locator(".comp-epa-total"),
  ).toHaveText("Unavailable");
  await expect(
    page.getByRole("table", { name: "Synced match observations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /^Avg total fuel/ }),
  ).toContainText("15.0");
  await page.screenshot({
    path: `test-results/pit-live-comparison-${info.project.name}.png`,
    fullPage: false,
  });
  await page
    .getByLabel("Compare a scheduled match", { exact: true })
    .selectOption("2026test_qm4");
  await expect(page.locator(".comp-epa-grid article").first()).toContainText(
    "Team 1001",
  );
  await page.getByLabel("Scouting event").selectOption(historicalEventId);
  await scoutTab(page, "Compare");
  await expect(
    page.getByRole("button", { name: "Compare next 4418 match" }),
  ).toHaveCount(0);
  await expect(page.locator(".comp-epa")).toContainText("Not loaded");
});
