import { expect, type Page } from "@playwright/test";
import { seed } from "../src/demo";
import type { Data } from "../src/model";

export const demoKey = "4418-pit-demo-v1";
export const batteryIds = Array.from(
  { length: 7 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
export const longBatteryName =
  "LightningMcQueenExtraLongUnbrokenBatteryNameForCompetitionTransport".repeat(
    3,
  );

export function namedBatteryData(): Data {
  const data = seed();
  const labels = [
    "  Phoenix  ",
    "Twin",
    "Twin",
    longBatteryName,
    "",
    "   ",
    "",
  ];
  data.batteries = data.batteries.slice(0, 7).map((battery, index) => ({
    ...battery,
    id: batteryIds[index],
    label: labels[index],
    status:
      index === 0
        ? "ON ROBOT"
        : index === 3
          ? "CHARGING"
          : index === 6
            ? "RETIRED"
            : "READY",
    active: index !== 6,
  }));
  const now = new Date().toISOString();
  data.issues = [
    {
      id: "archived-battery-issue",
      issue_number: 1,
      event_id: "denver",
      title: "Archived connector inspection",
      description: "Historical connector inspection for the retired battery.",
      subsystem: "Electrical",
      severity: "LOW",
      status: "OPEN",
      reported_by: "demo-student",
      assigned_to: null,
      discovered_match: "Q9",
      root_cause: "",
      repair_notes: "",
      resolution_notes: "",
      resolved_by: null,
      resolved_at: null,
      battery_id: batteryIds[6],
      created_at: now,
      updated_at: now,
    },
  ];
  data.issueEvents = [
    {
      id: "historical-link",
      issue_id: data.issues[0].id,
      performed_by: "demo-lead",
      changes: { battery_id: { from: batteryIds[1], to: batteryIds[6] } },
      created_at: now,
    },
  ];
  data.batteryEvents = [
    {
      id: "archived-battery-history",
      battery_id: batteryIds[6],
      event_id: "denver",
      event_type: "issue_linked",
      from_status: null,
      to_status: null,
      voltage: null,
      voltage_kind: null,
      match_number: "Q9",
      issue_id: data.issues[0].id,
      notes: "Preserved history before retirement",
      performed_by: "demo-student",
      created_at: now,
    },
  ];
  return data;
}

export async function setupNamedDemo(page: Page) {
  const data = namedBatteryData();
  await page.addInitScript(
    ({ key, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(data));
    },
    { key: demoKey, data },
  );
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Competition dashboard" }),
  ).toBeVisible();
  return data;
}

export async function savedDemo(page: Page): Promise<Data> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    demoKey,
  );
}

export function batteryCard(page: Page, name: string) {
  return page.locator(".battery-card").filter({
    has: page.getByRole("heading", { name, exact: true }),
  });
}

export async function expectFits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  for (const dialog of await page.getByRole("dialog").all()) {
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
}
