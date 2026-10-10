import { expect, test } from "@playwright/test";
import { nav, setup } from "./competition-fixture";
import {
  batteryCard,
  batteryIds,
  demoKey,
  expectFits,
  longBatteryName,
  namedBatteryData,
  savedDemo,
  setupNamedDemo,
} from "./battery-name-fixture";

// Every test runs in both the desktop and phone projects. All records are
// synthetic: no production account, physical battery name, or server is used.
test("battery names lead cards, dashboard and repeated dialogs; long names fit", async ({
  page,
}) => {
  await setupNamedDemo(page);
  await expect(
    page
      .locator(".current-battery")
      .getByRole("heading", { name: "Phoenix", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".mini-fleet")).toContainText("Phoenix");
  await expect(page.locator(".mini-fleet")).toContainText(longBatteryName);
  await expectFits(page);
  await nav(page, "Batteries");
  await expect(batteryCard(page, "Phoenix")).toContainText("System ID: B01");
  await expect(
    page.getByRole("heading", { name: "B01", exact: true }),
  ).toHaveCount(0);
  await expect(batteryCard(page, "Twin")).toHaveCount(2);
  await expect(batteryCard(page, "B05")).toBeVisible();
  await expect(batteryCard(page, "B06")).toBeVisible();
  await expect(batteryCard(page, "B07")).toHaveCount(0);
  await expect(batteryCard(page, longBatteryName)).toBeVisible();
  await expectFits(page);
  await page.screenshot({
    path: `test-results/battery-names-${test.info().project.name}.png`,
    fullPage: true,
  });

  for (let repeat = 0; repeat < 2; repeat++) {
    await batteryCard(page, "Phoenix")
      .getByRole("button", { name: "Remove battery", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", {
        name: "Phoenix (B01) · Remove battery",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await batteryCard(page, longBatteryName)
    .getByRole("button", { name: "Ready with voltage" })
    .click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(
    `${longBatteryName} (B04) · Mark ready`,
  );
  await expect(
    page.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeInViewport();
  await expectFits(page);
  await page.screenshot({
    path: `test-results/battery-long-name-dialog-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(
    (await savedDemo(page)).batteries.map(({ id, battery_number, status }) => ({
      id,
      battery_number,
      status,
    })),
  ).toEqual(
    namedBatteryData().batteries.map(({ id, battery_number, status }) => ({
      id,
      battery_number,
      status,
    })),
  );
});

test("duplicate battery names keep distinct UUIDs in issue selectors and history", async ({
  page,
}) => {
  await setupNamedDemo(page);
  await page.getByRole("button", { name: "Report issue", exact: true }).click();
  const selection = page.getByLabel("Battery (optional)", { exact: true });
  await expect(
    selection.locator(`option[value="${batteryIds[1]}"]`),
  ).toHaveText("Twin (B02) · READY");
  await expect(
    selection.locator(`option[value="${batteryIds[2]}"]`),
  ).toHaveText("Twin (B03) · READY");
  await expect(
    selection.locator(`option[value="${batteryIds[6]}"]`),
  ).toHaveCount(0);
  await selection.selectOption(batteryIds[2]);
  await expect(selection).toHaveValue(batteryIds[2]);
  await page.getByLabel("Subsystem *").selectOption("Electrical");
  await page.getByLabel("Severity *").selectOption("LOW");
  await page
    .getByLabel("What happened? *")
    .fill("Duplicate-name battery connector check");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Report issue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await savedDemo(page)).issues.at(-1)?.battery_id)
    .toBe(batteryIds[2]);
  await page.getByLabel("Demo role").selectOption("lead");
  await page
    .getByRole("button", { name: /Duplicate-name battery connector check/ })
    .click();
  await expect(
    page.getByRole("dialog").locator(".detail-summary"),
  ).toContainText("Battery: Twin (B03)");
  const linked = page.getByLabel("Linked battery", { exact: true });
  await expect(linked).toHaveValue(batteryIds[2]);
  await expect(linked.locator(`option[value="${batteryIds[1]}"]`)).toHaveText(
    "Twin (B02)",
  );
  await linked.selectOption(batteryIds[1]);
  await page.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: /Duplicate-name battery connector check/ })
    .click();
  await expect(page.getByRole("dialog").locator(".timeline")).toContainText(
    "Twin (B03) → Twin (B02)",
  );
  const saved = await savedDemo(page);
  const reported = saved.issues.find(
    (issue) => issue.title === "Duplicate-name battery connector check",
  )!;
  expect(reported.battery_id).toBe(batteryIds[1]);
  expect(
    saved.issueEvents.some(
      (event) =>
        event.issue_id === reported.id &&
        event.changes.battery_id?.from === batteryIds[2] &&
        event.changes.battery_id?.to === batteryIds[1],
    ),
  ).toBe(true);
  expect(
    saved.batteryEvents
      .filter((event) => event.issue_id === reported.id)
      .map((event) => event.battery_id),
  ).toEqual([batteryIds[2], batteryIds[1]]);
  await expectFits(page);
});

test("archived unnamed B07 stays reachable from its preserved issue and battery history", async ({
  page,
}) => {
  await setupNamedDemo(page);
  await nav(page, "Batteries");
  await page
    .getByLabel("Battery status", { exact: true })
    .selectOption("ARCHIVED");
  await expect(batteryCard(page, "B07")).toBeVisible();
  await batteryCard(page, "B07")
    .getByRole("button", { name: "Details & history" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "B07 · Details & history", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").locator(".timeline")).toContainText(
    "Preserved history before retirement",
  );
  await expect(page.getByRole("dialog").locator(".timeline")).toContainText(
    "Match: Q9",
  );
  await expect(
    page.getByRole("button", { name: "Save battery activity", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Issue #1", exact: false }).click();
  await expect(
    page.getByRole("dialog").locator(".detail-summary"),
  ).toContainText("Battery: B07");
  await expect(page.getByLabel("Linked battery", { exact: true })).toHaveValue(
    batteryIds[6],
  );
  await expect(page.getByRole("dialog").locator(".timeline")).toContainText(
    "Twin (B02) → B07",
  );
  expect((await savedDemo(page)).batteries[6]).toMatchObject({
    id: batteryIds[6],
    battery_number: "B07",
    label: "",
    active: false,
    status: "RETIRED",
  });
});

test("new batteries use names and generated references while renaming preserves identity", async ({
  page,
}) => {
  await setupNamedDemo(page);
  await page.getByLabel("Demo role").selectOption("admin");
  await nav(page, "Batteries");
  await page.getByRole("button", { name: "Add battery", exact: true }).click();
  await expect(
    page.getByLabel("Battery name *", { exact: true }),
  ).toHaveAttribute("required", "");
  await expect(page.getByLabel("System ID", { exact: true })).toHaveValue(
    "B08",
  );
  await expect(page.getByLabel("System ID", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByRole("button", { name: "Save battery", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Battery name *", { exact: true }).fill("   ");
  await expect(
    page.getByRole("button", { name: "Save battery", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Battery name *", { exact: true })
    .fill("  New practice battery  ");
  await page.getByRole("button", { name: "Save battery", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(batteryCard(page, "New practice battery")).toContainText(
    "TESTING",
  );
  const created = (await savedDemo(page)).batteries.at(-1)!;
  expect(created).toMatchObject({
    label: "New practice battery",
    battery_number: "B08",
    active: true,
    status: "TESTING",
  });
  expect(created.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await batteryCard(page, "Phoenix")
    .getByRole("button", { name: "Details & history" })
    .click();
  await page.getByText("Edit battery details", { exact: true }).click();
  await expect(page.getByLabel("System ID", { exact: true })).toHaveValue(
    "B01",
  );
  await expect(page.getByLabel("System ID", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await page
    .getByLabel("Battery name", { exact: true })
    .fill("Renamed Phoenix");
  await page.getByRole("button", { name: "Save battery", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(
    "Renamed Phoenix (B01) · Details & history",
  );
  expect((await savedDemo(page)).batteries[0]).toMatchObject({
    id: batteryIds[0],
    battery_number: "B01",
    label: "Renamed Phoenix",
    status: "ON ROBOT",
    active: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await nav(page, "Dashboard");
  await expect(
    page
      .locator(".current-battery")
      .getByRole("heading", { name: "Renamed Phoenix", exact: true }),
  ).toBeVisible();
});

test("an open new-battery form retains its reference until explicit collision recovery", async ({
  page,
}) => {
  await setupNamedDemo(page);
  await page.getByLabel("Demo role").selectOption("admin");
  await nav(page, "Batteries");
  await page.getByRole("button", { name: "Add battery", exact: true }).click();
  await page
    .getByLabel("Battery name *", { exact: true })
    .fill("Pending battery");
  await page
    .getByLabel("Battery notes", { exact: true })
    .fill("Keep these notes through refresh");
  await expect(page.getByLabel("System ID", { exact: true })).toHaveValue(
    "B08",
  );
  const collisionName = `${longBatteryName}AddedOnAnotherDevice`;
  await page.evaluate(
    ({ key, collisionName }) => {
      const data = JSON.parse(localStorage.getItem(key)!);
      data.batteries.push({
        ...data.batteries[1],
        id: "other-device-battery",
        battery_number: "B08",
        label: collisionName,
      });
      localStorage.setItem(key, JSON.stringify(data));
      window.dispatchEvent(new Event("storage"));
    },
    { key: demoKey, collisionName },
  );
  await expect(batteryCard(page, collisionName)).toBeVisible();
  await expect(page.getByLabel("System ID", { exact: true })).toHaveValue(
    "B08",
  );
  await expect(
    page.getByRole("button", { name: "Save battery", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    `This ID is already saved as ${collisionName} (B08)`,
  );
  await expectFits(page);
  await expect(page.getByLabel("Battery name *", { exact: true })).toHaveValue(
    "Pending battery",
  );
  await expect(page.getByLabel("System ID", { exact: true })).toHaveValue(
    "B08",
  );
  expect(
    (await savedDemo(page)).batteries.filter(
      (battery) => battery.battery_number === "B08",
    ),
  ).toHaveLength(1);
  expect(
    (await savedDemo(page)).batteries.some(
      (battery) => battery.label === "Pending battery",
    ),
  ).toBe(false);
  await page
    .getByRole("button", {
      name: "Assign a new ID for another battery",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("System ID", { exact: true })).toHaveValue(
    "B09",
  );
  await expect(page.getByLabel("Battery name *", { exact: true })).toHaveValue(
    "Pending battery",
  );
  await expect(page.getByLabel("Battery notes", { exact: true })).toHaveValue(
    "Keep these notes through refresh",
  );
  await expect(
    page.getByRole("button", {
      name: "Assign a new ID for another battery",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save battery", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(batteryCard(page, "Pending battery")).toBeVisible();
  expect((await savedDemo(page)).batteries.at(-1)).toMatchObject({
    battery_number: "B09",
    label: "Pending battery",
    notes: "Keep these notes through refresh",
    status: "TESTING",
  });
  expect(
    (await savedDemo(page)).batteries.filter(
      (battery) => battery.battery_number === "B08",
    ),
  ).toHaveLength(1);
});

test("competition assignment and readiness use name-first references while keeping UUID assignments", async ({
  page,
}) => {
  const { context, data, calls } = await setup(page);
  data.pit_batteries = namedBatteryData().batteries;
  context.matches = [
    {
      id: "ops",
      event_id: "event",
      match_key: "2026test_qm17",
      battery_id: batteryIds[1],
      version: 1,
      note: "",
    },
  ];
  context.runs = [{ id: "pre", kind: "pre", match_id: "ops" }];
  context.items = [
    {
      id: "check",
      run_id: "pre",
      required: true,
      blocking: true,
      completed_at: new Date().toISOString(),
    },
  ];
  await page.reload();
  await expect(page.locator(".comp-readiness")).toContainText(
    "Battery Twin (B02) · READY",
  );
  await expect(page.locator(".comp-attention")).toContainText(
    "Install assigned battery Twin (B02)",
  );
  await page
    .getByRole("button", { name: "Open pit display", exact: true })
    .click();
  const display = page.getByRole("dialog", {
    name: "Pit display",
    exact: true,
  });
  await expect(display).toContainText("Installed: Phoenix (B01)");
  await expect(display).toContainText("Assigned to Q17: Twin (B02) · READY");
  await expect(display).toContainText("does not match");
  await page.getByRole("button", { name: "Close pit display" }).click();
  await page.getByRole("button", { name: "Open Q17", exact: true }).click();
  const selection = page.getByRole("combobox", {
    name: "Battery",
    exact: true,
  });
  await expect(
    selection.locator(`option[value="${batteryIds[1]}"]`),
  ).toHaveText("Twin (B02) · READY");
  await expect(
    selection.locator(`option[value="${batteryIds[2]}"]`),
  ).toHaveText("Twin (B03) · READY");
  await expect(
    selection.locator(`option[value="${batteryIds[6]}"]`),
  ).toHaveCount(0);
  await selection.selectOption(batteryIds[2]);
  await page
    .getByRole("button", { name: "Save preparation", exact: true })
    .click();
  await expect.poll(() => context.matches[0].battery_id).toBe(batteryIds[2]);
  expect(calls.at(-1).p.battery_id).toBe(batteryIds[2]);
  await expect(
    page.getByText("Assigned battery: Twin (B03)", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open battery actions", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(
    "Twin (B03) · Details & history",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(data.pit_batteries[2].status).toBe("READY");
  data.pit_batteries[0].status = "COOLING";
  data.pit_batteries[2].status = "ON ROBOT";
  await page.reload();
  await expect(page.locator(".comp-readiness")).toContainText(
    "Battery Twin (B03) · ON ROBOT",
  );
  await expect(
    page.getByRole("heading", { name: "ROBOT READY", exact: true }),
  ).toBeVisible();
  await expectFits(page);
});

test("archived match assignments stay selected until the crew explicitly changes them", async ({
  page,
}) => {
  const { context, data, calls } = await setup(page);
  data.pit_batteries = namedBatteryData().batteries;
  context.matches = [
    {
      id: "ops",
      event_id: "event",
      match_key: "2026test_qm17",
      battery_id: batteryIds[6],
      version: 1,
      note: "Historical preparation note",
    },
  ];
  await page.reload();
  await expect(page.locator(".comp-readiness")).toContainText(
    "Battery B07 · RETIRED",
  );
  await page.getByRole("button", { name: "Open Q17", exact: true }).click();
  await expect(
    page.getByText("Assigned battery: B07", { exact: true }),
  ).toBeVisible();
  const selection = page.getByRole("combobox", {
    name: "Battery",
    exact: true,
  });
  await expect(selection).toHaveValue(batteryIds[6]);
  await expect(selection.locator("option:checked")).toContainText("B07");
  await page
    .getByRole("textbox", { name: "Operational note", exact: true })
    .fill("An explicit battery change is needed");
  const writesBefore = calls.length;
  await page
    .getByRole("button", { name: "Save preparation", exact: true })
    .click();
  await expect
    .poll(() =>
      selection.evaluate(
        (element: HTMLSelectElement) => element.validationMessage,
      ),
    )
    .toBe("Choose an active battery or Not assigned before saving.");
  expect(calls).toHaveLength(writesBefore);
  expect(context.matches[0].battery_id).toBe(batteryIds[6]);
  await expect(selection).toHaveValue(batteryIds[6]);
  await selection.selectOption("");
  await page
    .getByRole("button", { name: "Save preparation", exact: true })
    .click();
  await expect.poll(() => calls.length).toBe(writesBefore + 1);
  expect(calls.at(-1)).toMatchObject({
    action: "match",
    p: { battery_id: "", note: "An explicit battery change is needed" },
  });
  expect(context.matches[0].battery_id).toBeNull();
  await expect(
    page.getByText("Assigned battery: None", { exact: true }),
  ).toBeVisible();
});
