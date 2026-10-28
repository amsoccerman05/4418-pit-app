import { test, expect, type Page } from "@playwright/test";
import {
  setupOffline,
  navigate,
  emitAuth,
  assertPrivateSnapshotCleared,
  captureOfflineState,
} from "./offline-fixture";

const conflictMessage =
  "This issue changed on another device. Close and reopen it before saving.";
async function setup(page: Page) {
  const fixture = await setupOffline(page);
  const updates: Record<string, any>[] = [];
  let loseResponse = false,
    held: Promise<void> | null = null,
    release: () => void = () => {};
  await page.route("**/offline-fixture/rpc/pit_update_issue", async (route) => {
    const { p } = route.request().postDataJSON();
    updates.push(p);
    const issue = fixture.data.pit_issues.find((row) => row.id === p.id);
    let error = null;
    if (!issue || issue.updated_at !== p.expected_updated_at)
      error = { code: "P0001", message: conflictMessage };
    else
      Object.assign(issue, p, {
        updated_at: new Date(Date.parse(issue.updated_at) + 1000).toISOString(),
      });
    const response = { data: null, error };
    if (held) await held;
    if (loseResponse) {
      loseResponse = false;
      await route.abort("failed").catch(() => {});
    } else await route.fulfill({ json: response }).catch(() => {});
  });
  await navigate(page, "Robot / Issues");
  await page.getByRole("button", { name: /Private pit repair/ }).click();
  const dialog = page.getByRole("dialog", { name: "Issue #1", exact: true });
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Private pit repair",
  );
  const bump = (values: Record<string, unknown>) =>
    Object.assign(fixture.data.pit_issues[0], values, {
      updated_at: new Date(
        Date.parse(fixture.data.pit_issues[0].updated_at) + 1000,
      ).toISOString(),
    });
  return {
    ...fixture,
    dialog,
    updates,
    bump,
    loseNextResponse() {
      loseResponse = true;
    },
    holdWrite() {
      held = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        release();
        held = null;
      };
    },
  };
}

test("issue conflict preserves draft and reconciles a fresh version without overwriting teammate work", async ({
  page,
}) => {
  const f = await setup(page),
    d = f.dialog;
  await d.getByLabel("Title", { exact: true }).fill("My typed title");
  await d
    .getByLabel("Repair performed", { exact: true })
    .fill("My measured repair notes");
  f.bump({ status: "TESTING", assigned_to: "person" });
  const version = f.data.pit_issues[0].updated_at;
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Your edits are still here");
  await expect(d).not.toContainText("Save not confirmed");
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue(
    "My typed title",
  );
  await expect(
    d.getByRole("button", { name: "Save issue", exact: true }),
  ).toBeDisabled();
  expect(f.updates).toHaveLength(1);
  await d.getByRole("alert").scrollIntoViewIfNeeded();
  await captureOfflineState(
    page,
    test.info(),
    "issue-conflict-retained-draft-warning",
    false,
  );
  await d.getByLabel("Title", { exact: true }).scrollIntoViewIfNeeded();
  await captureOfflineState(
    page,
    test.info(),
    "issue-conflict-retained-draft-fields",
    false,
  );
  await d
    .getByRole("button", { name: "Refresh latest issue", exact: true })
    .click();
  await expect(
    d.getByRole("button", { name: "Review changes", exact: true }),
  ).toBeEnabled();
  await d.getByRole("button", { name: "Review changes", exact: true }).click();
  const review = d.getByRole("region", { name: "Review issue changes" });
  await expect(review).toContainText("TESTING");
  await expect(d.getByLabel("Title", { exact: true })).toBeDisabled();
  await review
    .getByText("Latest saved:", { exact: true })
    .first()
    .scrollIntoViewIfNeeded();
  await captureOfflineState(page, test.info(), "issue-conflict-review", false);
  await d
    .getByRole("button", { name: "Apply reviewed changes", exact: true })
    .click();
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue(
    "My typed title",
  );
  await expect(d.getByLabel("Status", { exact: true })).toHaveValue("TESTING");
  await expect(d.getByLabel("Repair performed", { exact: true })).toHaveValue(
    "My measured repair notes",
  );
  expect(f.updates).toHaveLength(1);
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(d).not.toBeVisible();
  expect(f.updates).toHaveLength(2);
  expect(f.updates[1]).toMatchObject({
    expected_updated_at: version,
    title: "My typed title",
    status: "TESTING",
    repair_notes: "My measured repair notes",
  });
});

test("overlapping edits require a choice, pause typing, and reset choices for a newer background refresh", async ({
  page,
}) => {
  const f = await setup(page),
    d = f.dialog;
  await d.getByLabel("Title", { exact: true }).fill("My title");
  f.bump({ title: "Teammate title" });
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Your edits are still here");
  await d
    .getByRole("button", { name: "Refresh latest issue", exact: true })
    .click();
  await d.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Apply reviewed changes", exact: true }),
  ).toBeDisabled();
  await d.getByLabel("Use for title", { exact: true }).selectOption("mine");
  await expect(
    d.getByRole("button", { name: "Apply reviewed changes", exact: true }),
  ).toBeEnabled();
  await d.getByLabel("Use for title", { exact: true }).scrollIntoViewIfNeeded();
  await captureOfflineState(
    page,
    test.info(),
    "issue-conflict-overlapping-field-choices",
    false,
  );
  f.bump({ title: "Newer teammate title" });
  await page.evaluate(() =>
    (window as any).__offlineFixture.emitRealtime("pit_issues"),
  );
  await expect(
    d.getByRole("region", { name: "Review issue changes" }),
  ).toContainText("Newer teammate title");
  await expect(d.getByLabel("Use for title", { exact: true })).toHaveValue("");
  await expect(
    d.getByRole("button", { name: "Apply reviewed changes", exact: true }),
  ).toBeDisabled();
  await d
    .getByRole("button", { name: "Back to my draft", exact: true })
    .click();
  await expect(d.getByLabel("Title", { exact: true })).toBeEnabled();
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue("My title");
  await d.getByLabel("Title", { exact: true }).fill("My revised title");
  await d.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(d.getByLabel("Use for title", { exact: true })).toHaveValue("");
  await d.getByLabel("Use for title", { exact: true }).selectOption("mine");
  await d
    .getByRole("button", { name: "Apply reviewed changes", exact: true })
    .click();
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue(
    "My revised title",
  );
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(d).not.toBeVisible();
  expect(f.updates).toHaveLength(2);
  expect(f.updates[1].title).toBe("My revised title");
});

test("failed refresh keeps edits and blocks stale retry until a successful reviewed refresh", async ({
  page,
}) => {
  const f = await setup(page),
    d = f.dialog;
  await d
    .getByLabel("Repair performed", { exact: true })
    .fill("Do not lose my notes");
  f.bump({ status: "TESTING" });
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Your edits are still here");
  f.errors.set("table/pit_issues", "Synthetic refresh interruption");
  await d
    .getByRole("button", { name: "Refresh latest issue", exact: true })
    .click();
  await expect(d).toContainText("Read-only snapshot");
  await expect(d.getByLabel("Repair performed", { exact: true })).toHaveValue(
    "Do not lose my notes",
  );
  await expect(
    d.getByRole("button", { name: "Save issue", exact: true }),
  ).toBeDisabled();
  expect(f.updates).toHaveLength(1);
  f.errors.clear();
  await d
    .getByRole("button", { name: "Refresh latest issue", exact: true })
    .click();
  await d.getByRole("button", { name: "Review changes", exact: true }).click();
  await d
    .getByRole("button", { name: "Apply reviewed changes", exact: true })
    .click();
  await expect(d.getByLabel("Repair performed", { exact: true })).toHaveValue(
    "Do not lose my notes",
  );
  await expect(
    d.getByRole("button", { name: "Save issue", exact: true }),
  ).toBeEnabled();
});

test("an unknown write outcome still needs refresh and review, with no automatic replay", async ({
  page,
}) => {
  const f = await setup(page),
    d = f.dialog;
  await d
    .getByLabel("Repair performed", { exact: true })
    .fill("Saved but response lost");
  f.loseNextResponse();
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Save not confirmed");
  expect(f.updates).toHaveLength(1);
  await expect(
    d.getByRole("button", { name: "Save issue", exact: true }),
  ).toBeDisabled();
  await d
    .getByRole("button", { name: "Refresh before retrying save", exact: true })
    .click();
  await d.getByRole("button", { name: "Review changes", exact: true }).click();
  await d
    .getByRole("button", { name: "Apply reviewed changes", exact: true })
    .click();
  await expect(d.getByLabel("Repair performed", { exact: true })).toHaveValue(
    "Saved but response lost",
  );
  expect(f.updates).toHaveLength(1);
});

test("discarding a draft requires the explicit review action and does not save", async ({
  page,
}) => {
  const f = await setup(page),
    d = f.dialog;
  await d.getByLabel("Title", { exact: true }).fill("Discard only by choice");
  f.bump({ title: "Latest repair title" });
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Your edits are still here");
  await d
    .getByRole("button", { name: "Refresh latest issue", exact: true })
    .click();
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue(
    "Discard only by choice",
  );
  await d.getByRole("button", { name: "Review changes", exact: true }).click();
  await d
    .getByRole("button", {
      name: "Discard my edits and use latest",
      exact: true,
    })
    .click();
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue(
    "Latest repair title",
  );
  expect(f.updates).toHaveLength(1);
});

test("late conflict does not replace a newer dialog and repeated submit sends only once", async ({
  page,
}) => {
  const f = await setup(page),
    d = f.dialog;
  f.bump({ title: "Changed elsewhere" });
  const release = f.holdWrite();
  await d.getByLabel("Title", { exact: true }).fill("Draft for earlier dialog");
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect.poll(() => f.updates.length).toBe(1);
  await d
    .locator("form")
    .evaluate((form) =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  expect(f.updates).toHaveLength(1);
  await d.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: /Private pit repair/ }).click();
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue(
    "Private pit repair",
  );
  release();
  await expect(
    d.getByRole("button", { name: "Save issue", exact: true }),
  ).toBeEnabled();
  await expect(
    d.getByRole("region", { name: "Review issue changes" }),
  ).toHaveCount(0);
  await expect(d.getByRole("alert")).toHaveCount(0);
});

test("session loss clears a conflicted draft and a held refresh cannot restore it", async ({
  page,
}) => {
  const f = await setup(page),
    d = f.dialog;
  await d
    .getByLabel("Title", { exact: true })
    .fill("Private draft that must clear");
  f.bump({ status: "TESTING" });
  await d.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Your edits are still here");
  const hold = f.holdNext("table/pit_issues");
  await d
    .getByRole("button", { name: "Refresh latest issue", exact: true })
    .click();
  await hold.started;
  await emitAuth(page, null);
  await assertPrivateSnapshotCleared(page);
  await expect(page.locator("body")).not.toContainText(
    "Private draft that must clear",
  );
  await hold.release();
  await expect(d).not.toBeVisible();
  expect(f.updates).toHaveLength(1);
});
