import { test, expect } from "@playwright/test";
test("visual review of issues, forms and empty states", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await page.evaluate(() => document.fonts.ready);
  const shot = async (name: string) => {
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollWidth",
      page.viewportSize()!.width,
    );
    await page.screenshot({
      path: `test-results/visual-${info.project.name}-${name}.png`,
      fullPage: true,
    });
  };
  await page
    .locator("nav")
    .getByRole("button", { name: "Issues", exact: true })
    .click();
  await shot("issues-empty");
  await page.getByRole("button", { name: "Report issue", exact: true }).click();
  await shot("report");
  await page.getByLabel("Subsystem *").selectOption("Electrical");
  await page.getByLabel("Severity *").selectOption("ROBOT DOWN");
  await page
    .getByLabel("What happened? *")
    .fill("Connector loosened during practice");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Report issue", exact: true })
    .click();
  await shot("issues");
  await page.getByLabel("Demo role").selectOption("lead");
  await page.getByRole("button", { name: /Connector loosened/ }).click();
  await shot("issue-detail");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Batteries", exact: true })
    .click();
  await page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "B01", exact: true }) })
    .getByRole("button", { name: "Remove battery", exact: true })
    .click();
  await shot("removal");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate(() => {
    const key = "4418-pit-demo-v1";
    const d = JSON.parse(localStorage.getItem(key)!);
    d.batteries = [];
    d.events = [];
    d.issues = [];
    localStorage.setItem(key, JSON.stringify(d));
  });
  await page.reload();
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await shot("dashboard-empty");
  await page
    .locator("nav")
    .getByRole("button", { name: "Batteries", exact: true })
    .click();
  await shot("batteries-empty");
});
