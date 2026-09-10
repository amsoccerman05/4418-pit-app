// Public-page and local-demo smoke checks. Never signs in or writes production data.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
const origin = "https://pit.frc4418.org/";
await mkdir("test-results/production", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 768, 1280, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const response = await page.goto(origin, { waitUntil: "networkidle" });
    assert.equal(response.status(), 200);
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    await page.getByLabel("Team account email").waitFor();
    assert.equal(
      await page.locator(".setup").count(),
      0,
      "Production Supabase configuration missing",
    );
    assert.equal(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({
      path: `test-results/production/login-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Explore local demo" }).click();
    await page
      .getByRole("heading", { name: "Pit dashboard", exact: true })
      .waitFor();
    await page.getByText("LOCAL DEMO", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({
      path: `test-results/production/dashboard-demo-${width}.png`,
      fullPage: true,
    });
    await page
      .locator("nav")
      .getByRole("button", { name: "Batteries", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Battery tracking", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({
      path: `test-results/production/batteries-demo-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      `PASS HTTPS sign-in page + isolated demo layout at ${width}px; no page errors or horizontal overflow`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
