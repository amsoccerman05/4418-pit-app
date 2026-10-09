import { test, expect, type Page } from "@playwright/test";
import { nav } from "./competition-fixture";
import { practiceRecord, setupManual } from "./manual-practice-fixture";

async function openGuide(page: Page) {
  const guide = page.locator(".comp-crew-guide");
  await guide.locator("summary").click();
  await expect(guide).toHaveAttribute("open", "");
  return guide;
}

test("crew quick-start is a collapsible touch-friendly guide with real workflow links", async ({
  page,
}) => {
  const { context, calls } = await setupManual(page, { configured: false });
  context.matches.push(practiceRecord({ manual_label: "Practice 1" }));
  await page.reload();
  const guide = page.locator(".comp-crew-guide");
  await expect(guide).not.toHaveAttribute("open", "");
  await openGuide(page);
  await expect(guide).toContainText("Practice 1");
  await expect(guide).toContainText("The battery list may be incomplete.");
  await expect(guide).toContainText("Assigning a battery does not install it.");
  for (const element of await guide.locator("summary, button").all()) {
    const box = await element.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/crew-quick-start-${test.info().project.name}.png`,
    fullPage: true,
  });
  await guide
    .getByRole("button", { name: "Open current preparation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Practice 1", exact: true }),
  ).toBeVisible();
  await nav(page, "Dashboard");
  await openGuide(page);
  await guide
    .getByRole("button", { name: "Open Matches", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Manual practice", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /All matches/ })).toHaveCount(
    0,
  );
  await nav(page, "Dashboard");
  await openGuide(page);
  await guide
    .getByRole("button", { name: "Open Batteries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Battery tracking", exact: true }),
  ).toBeVisible();
  await nav(page, "Dashboard");
  await openGuide(page);
  await guide
    .getByRole("button", { name: "Report an issue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await guide.locator("summary").click();
  await expect(guide).not.toHaveAttribute("open", "");
  expect(calls).toHaveLength(0);
});

test("crew quick-start keeps readonly and offline users in view-only workflows", async ({
  page,
}) => {
  const { data, calls } = await setupManual(page, { manager: false });
  data.profiles[0].role = "readonly";
  await page.reload();
  let guide = await openGuide(page);
  await expect(guide).toContainText("View-only access");
  await expect(
    guide.getByRole("button", {
      name: "View current preparation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    guide.getByRole("button", { name: "Report an issue", exact: true }),
  ).toHaveCount(0);
  await guide.getByRole("button", { name: "View issues", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Issue log", exact: true }),
  ).toBeVisible();
  data.profiles[0].role = "student";
  await page.reload();
  await nav(page, "Dashboard");
  guide = await openGuide(page);
  await expect(guide).toContainText(
    "Leadership starts preparation and assigns the battery",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(guide).toContainText("Read-only snapshot");
  await expect(
    guide.getByRole("button", { name: "Report an issue", exact: true }),
  ).toHaveCount(0);
  expect(calls).toHaveLength(0);
});
