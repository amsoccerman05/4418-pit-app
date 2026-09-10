import { test, expect, type Page } from "@playwright/test";
async function demo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Pit dashboard" }),
  ).toBeVisible();
}
async function role(page: Page, r: string) {
  await page.getByLabel("Demo role").selectOption(r);
}
async function nav(page: Page, name: string) {
  await page.locator("nav").getByRole("button", { name, exact: true }).click();
}
async function report(
  page: Page,
  description: string,
  severity = "ROBOT DOWN",
  battery = "",
) {
  await page.getByRole("button", { name: "Report issue", exact: true }).click();
  await page.getByLabel("Subsystem *").selectOption("Shooter");
  await page.getByLabel("Severity *").selectOption(severity);
  await page.getByLabel("What happened? *").fill(description);
  if (battery)
    await page.getByLabel("Battery (optional)").selectOption(battery);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Report issue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
test("issue acceptance: student reports, lead repairs, dashboard returns ready", async ({
  page,
}) => {
  await demo(page);
  await report(page, "Shooter wheel stopped after Q41.");
  await expect(
    page.getByRole("heading", { name: "NOT READY", exact: true }),
  ).toBeVisible();
  await role(page, "lead");
  for (const status of ["DIAGNOSING", "REPAIRING", "TESTING", "RESOLVED"]) {
    await page.getByRole("button", { name: /Shooter wheel stopped/ }).click();
    await page.getByLabel("Status", { exact: true }).selectOption(status);
    await page
      .getByLabel("Root cause", { exact: true })
      .fill("Loose motor connector");
    await page
      .getByLabel("Repair performed")
      .fill("Reseated and secured connector");
    await page.getByRole("button", { name: "Save issue" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "READY", exact: true }),
  ).toBeVisible();
});
test("battery acceptance: match assignment, quick removal and ready voltage", async ({
  page,
}) => {
  await demo(page);
  await nav(page, "Batteries");
  const card = (id: string) =>
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: id, exact: true }) });
  await card("B01")
    .getByRole("button", { name: "Remove battery", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove battery", exact: true })
    .click();
  await card("B07").getByRole("button", { name: "Install with match" }).click();
  await page.getByLabel("Match (optional)").fill("Q42");
  await page
    .getByRole("button", { name: "Install battery", exact: true })
    .click();
  await expect(card("B07").getByText("Assigned: Q42")).toBeVisible();
  await nav(page, "Dashboard");
  await expect(
    page.locator(".current-battery").getByText("Assigned: Q42"),
  ).toBeVisible();
  await page.getByRole("button", { name: "View battery history" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove battery", exact: true })
    .click();
  await expect(page.getByLabel("Match (optional)")).toHaveValue("Q42");
  await page.getByLabel("Post-match voltage (optional)").fill("12.18");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove battery", exact: true })
    .click();
  await nav(page, "Batteries");
  await expect(card("B07").getByText("Last used: Q42")).toBeVisible();
  await card("B07").getByRole("button", { name: "Start charging" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await card("B07").getByRole("button", { name: "Ready with voltage" }).click();
  await page.getByLabel("Voltage (optional)").fill("12.92");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark ready", exact: true })
    .click();
  await expect(card("B07").locator(".badge")).toHaveText("READY");
  await expect(card("B07").getByText("Last used: Q42")).toBeVisible();
  await card("B07").getByRole("button", { name: "Details & history" }).click();
  await expect(
    page.getByText("12.18 V · post-match", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("12.92 V · pre-match", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Match: Q42", { exact: true }),
  ).toHaveCount(2);
});
test("brownout links issue to flagged battery and readonly hides writes", async ({
  page,
}) => {
  await demo(page);
  await report(page, "Brownout during Q34", "HIGH", "b7");
  await expect(
    page.getByRole("heading", { name: "NEEDS ATTENTION" }),
  ).toBeVisible();
  await nav(page, "Batteries");
  const b07 = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "B07", exact: true }) });
  await b07.getByRole("button", { name: "Details & history" }).click();
  await expect(
    page.getByRole("button", { name: "Issue #1", exact: false }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("Battery status", { exact: true })
    .selectOption("FLAGGED");
  await page.getByRole("button", { name: "Save battery activity" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(b07.locator(".badge")).toHaveText("FLAGGED");
  await role(page, "readonly");
  await expect(
    page.getByRole("button", { name: "Report issue", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Install on robot" }),
  ).toHaveCount(0);
  await nav(page, "Dashboard");
  await expect(
    page.getByRole("button", { name: /Flagged batteries 2/ }),
  ).toBeVisible();
});
for (const width of [390, 768, 1280, 1440])
  test(`responsive at ${width}px: dashboard, form, fleet fit viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await demo(page);
    await expect(
      page.getByRole("heading", { name: "READY", exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await page.screenshot({
      path: `test-results/dashboard-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Report issue", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Close dialog" }).click();
    await nav(page, "Batteries");
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await page.screenshot({
      path: `test-results/batteries-${width}.png`,
      fullPage: true,
    });
  });
test("admin manages events and batteries; completed issues stay accessible", async ({
  page,
}) => {
  await demo(page);
  await report(page, "Historical issue", "LOW");
  await role(page, "admin");
  await nav(page, "Manage");
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Event name *").fill("Next regional");
  await page.getByLabel("Start date *").fill("2027-04-01");
  await page.getByLabel("End date *").fill("2027-04-03");
  await page.getByRole("button", { name: "Save event" }).click();
  await page
    .locator(".event-row")
    .filter({ hasText: "Next regional" })
    .getByRole("button", { name: "Activate event" })
    .click();
  await nav(page, "Dashboard");
  await expect(
    page.getByRole("heading", { name: "READY", exact: true }),
  ).toBeVisible();
  await nav(page, "Issues");
  await page.getByLabel("Event", { exact: true }).selectOption("denver");
  await expect(
    page.getByRole("button", { name: /Historical issue/ }),
  ).toBeVisible();
  await nav(page, "Batteries");
  await page.getByRole("button", { name: "Add battery" }).click();
  await page.getByLabel("Battery number *").fill("B11");
  await page.getByRole("button", { name: "Save battery", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "B11", exact: true }),
  ).toBeVisible();
});

test("battery header respects management permissions and simple actions stay one tap", async ({
  page,
}) => {
  await demo(page);
  await nav(page, "Batteries");
  for (const r of ["student", "lead", "readonly"]) {
    await role(page, r);
    await expect(
      page.getByRole("button", { name: "Add battery", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Report issue", exact: true }),
    ).toHaveCount(0);
  }
  for (const r of ["admin", "mentor"]) {
    await role(page, r);
    await expect(
      page
        .locator(".page-heading")
        .getByRole("button", { name: "Add battery", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add battery", exact: true }),
    ).toHaveCount(1);
  }
  await role(page, "student");
  const b04 = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "B04", exact: true }) });
  await b04.getByRole("button", { name: "Mark ready", exact: true }).click();
  await expect(b04.locator(".badge")).toHaveText("READY");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const b01 = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "B01", exact: true }) });
  await b01
    .getByRole("button", { name: "Remove battery", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove battery", exact: true })
    .click();
  await b04
    .getByRole("button", { name: "Install on robot", exact: true })
    .click();
  await expect(b04.locator(".badge")).toHaveText("ON ROBOT");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
for (const [status, match] of [
  ["TESTING", "SF3-1"],
  ["FLAGGED", "F2"],
])
  test(`quick removal to ${status} preserves match`, async ({ page }) => {
    await demo(page);
    await nav(page, "Batteries");
    const b01 = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: "B01", exact: true }) });
    await b01
      .getByRole("button", { name: "Remove battery", exact: true })
      .click();
    await page.getByLabel("Match (optional)").fill(match);
    await page.getByLabel("Next status").selectOption(status);
    await expect(page.getByLabel("Next status").locator("option")).toHaveCount(
      3,
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove battery", exact: true })
      .click();
    await expect(b01.locator(".badge")).toHaveText(status);
    await expect(b01.getByText(`Last used: ${match}`)).toBeVisible();
    await b01.getByRole("button", { name: "Details & history" }).click();
    await expect(
      page.getByRole("dialog").getByText(`Match: ${match}`, { exact: true }),
    ).toBeVisible();
  });
