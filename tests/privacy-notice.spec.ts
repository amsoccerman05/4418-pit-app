import { expect, test } from "@playwright/test";

const noticeUrl = "https://team.frc4418.org/privacy.html";

for (const signedIn of [false, true]) {
  test(`privacy notice is accessible ${signedIn ? "inside the workspace" : "before sign-in"}`, async ({ page, context }) => {
    await context.route(noticeUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Team 4418 privacy notice</title><h1>Privacy notice</h1>",
      }),
    );
    await page.goto("/?demo=1");
    if (signedIn) {
      await page.getByRole("button", { name: "Explore local demo" }).click();
      await expect(page.getByRole("heading", { name: "Competition dashboard" })).toBeVisible();
    }

    const notice = page.locator("footer").getByRole("link", {
      name: "Privacy notice (opens in a new tab)",
      exact: true,
    });
    await expect(notice).toHaveAttribute("href", noticeUrl);
    await expect(notice).toHaveAttribute("target", "_blank");
    await expect(notice).toHaveAttribute("rel", "noopener noreferrer");
    await notice.scrollIntoViewIfNeeded();
    await expect(notice).toBeVisible();
    await notice.focus();
    await expect(notice).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/privacy-${signedIn ? "workspace" : "auth"}-${test.info().project.name}.png`, fullPage: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const popupPromise = page.waitForEvent("popup");
      await notice.press("Enter");
      const popup = await popupPromise;
      await expect(popup).toHaveURL(noticeUrl);
      await expect(popup.getByRole("heading", { name: "Privacy notice" })).toBeVisible();
      expect(await popup.evaluate(() => window.opener === null)).toBe(true);
      await popup.close();
      await expect(page).toHaveURL(/\?demo=1/);
      if (signedIn) {
        await expect(page.getByRole("heading", { name: "Competition dashboard" })).toBeVisible();
      } else {
        await expect(page.getByRole("button", { name: "Explore local demo" })).toBeVisible();
      }
    }

    if (signedIn) {
      await page.locator(".sidebar nav").getByRole("button", { name: "Batteries", exact: true }).click();
      await expect(notice).toBeVisible();
    }
  });
}
