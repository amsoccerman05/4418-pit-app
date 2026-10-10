import { test, expect } from "@playwright/test";
import { setup } from "./competition-fixture";
import { practiceRecord } from "./manual-practice-fixture";

async function predictionFixture(page: Parameters<typeof setup>[0]) {
  const fixture = await setup(page);
  const { feed } = fixture;
  feed.matchPredictions = [
    {
      event: "2026test",
      key: "2026test_qm17",
      red: [...feed.matches[0].red],
      blue: [...feed.matches[0].blue],
      redWinProbability: 0.7345,
    },
  ];
  feed.predictionsAt = Date.now();
  feed.predictionsError = null;
  await page.reload();
  const card = page.getByRole("region", {
    name: "Statbotics match probability",
  });
  await expect(card).toBeVisible();
  return { ...fixture, card };
}
test("upcoming dashboard probability shows exact red/blue lineups, provider, pre-match scope and freshness responsively", async ({
  page,
}, info) => {
  const { card, calls } = await predictionFixture(page);
  await expect(card).toContainText("Estimated win chance · Q17");
  await expect(card.locator(".comp-win-red")).toContainText(
    "Red alliance · Team 4418",
  );
  await expect(card.locator(".comp-win-red")).toContainText("73.5%");
  await expect(card.locator(".comp-win-blue")).toContainText("26.5%");
  await expect(card.locator(".comp-win-red")).toContainText(
    "4418 · 1619 · 1339",
  );
  await expect(card).toContainText("Last checked");
  await expect(card).toContainText(
    "Pre-match model estimate, not a guarantee. No separate tie estimate.",
  );
  await expect(card.getByRole("link", { name: "Statbotics" })).toHaveAttribute(
    "href",
    "https://www.statbotics.io/",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/match-probability-${info.project.name}.png`,
    fullPage: false,
  });
  expect(calls).toEqual([]);
});
test("missing, stale, failed and changed-lineup predictions never fabricate percentages", async ({
  page,
}) => {
  const { feed, card } = await predictionFixture(page);
  for (const p of [0, 1]) {
    feed.matchPredictions[0].redWinProbability = p;
    await page.reload();
    await expect(card.locator(".comp-win-red strong")).toHaveText(
      `${p * 100}%`,
    );
    await expect(card.locator(".comp-win-blue strong")).toHaveText(
      `${(1 - p) * 100}%`,
    );
  }
  for (const p of [null, undefined, -1, 2, "0.7"]) {
    feed.matchPredictions[0].redWinProbability = p;
    await page.reload();
    await expect(card).toContainText(
      "No Statbotics prediction for this match and lineup yet.",
    );
    await expect(card.locator(".comp-win-alliances")).toHaveCount(0);
  }
  feed.matchPredictions[0].redWinProbability = 0.7345;
  for (const change of [
    { predictionsAt: Date.now() - 600000 },
    { predictionsAt: Date.now() + 120000 },
    { predictionsError: "Statbotics unavailable" },
    { tbaError: "TBA unavailable" },
  ]) {
    feed.predictionsAt = Date.now();
    feed.predictionsError = null;
    feed.tbaError = null;
    Object.assign(feed, change);
    await page.reload();
    await expect(card).toContainText("Prediction unavailable");
    await expect(card.locator(".comp-win-alliances")).toHaveCount(0);
  }
  feed.predictionsAt = Date.now();
  feed.predictionsError = null;
  feed.tbaError = null;
  feed.matchPredictions[0].red = ["4418", "1619", "1"];
  await page.reload();
  await expect(card).toContainText(
    "No Statbotics prediction for this match and lineup yet.",
  );
  await expect(card.locator(".comp-win-alliances")).toHaveCount(0);
});
test("manual practice and the next official match cannot inherit a different match prediction", async ({
  page,
}) => {
  const { context, feed, card } = await predictionFixture(page);
  context.manual_matches_enabled = true;
  context.matches = [practiceRecord()];
  await page.reload();
  await expect(card).toContainText("manual practice matches");
  await expect(card.locator(".comp-win-alliances")).toHaveCount(0);
  context.matches = [];
  feed.matches[0] = {
    ...feed.matches[0],
    key: "2026test_qm18",
    number: 18,
    label: "Q18",
  };
  await page.reload();
  await expect(card).toContainText("Q18");
  await expect(card.locator(".comp-win-alliances")).toHaveCount(0);
  feed.matches = [];
  await page.reload();
  await expect(page.locator(".comp-live-strip")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No upcoming match published" }),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
});
