import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isIssueConflict,
  issueChanges,
  reconcileIssue,
  issueEditFields,
} from "../src/issue-recovery.ts";

const base = {
  id: "issue",
  updated_at: "version-1",
  title: "Original repair",
  status: "OPEN",
  severity: "LOW",
  assigned_to: null,
  battery_id: null,
  root_cause: "",
  repair_notes: "",
  resolution_notes: "",
};

test("only the explicit issue-conflict response is treated as a rejected write", () => {
  const message =
    "This issue changed on another device. Close and reopen it before saving.";
  assert.equal(isIssueConflict({ code: "P0001", message }), true);
  assert.equal(isIssueConflict(new Error(message)), true);
  for (const error of [
    null,
    undefined,
    new Error("Failed to fetch"),
    new Error("Connection timed out."),
    { message: "Permission denied" },
    { message: "Issue not found" },
    { message: `Network error: ${message}` },
  ])
    assert.equal(isIssueConflict(error), false);
});

test("review preserves local edits and adopts remotely changed untouched fields and token", () => {
  const draft = {
    ...base,
    title: "My typed repair",
    repair_notes: "My measurements",
  };
  const latest = {
    ...base,
    status: "TESTING",
    assigned_to: "teammate",
    updated_at: "version-2",
  };
  const merged = reconcileIssue(base, draft, latest, {});
  assert.equal(merged.title, draft.title);
  assert.equal(merged.repair_notes, draft.repair_notes);
  assert.equal(merged.status, latest.status);
  assert.equal(merged.assigned_to, latest.assigned_to);
  assert.equal(merged.updated_at, latest.updated_at);
  assert.equal(
    draft.updated_at,
    "version-1",
    "the old draft is not mutated by refresh/review",
  );
});

test("each editable field requires an explicit choice when both people changed it differently", () => {
  for (const [key] of issueEditFields) {
    const draft = { ...base, [key]: "mine" },
      latest = { ...base, [key]: "latest", updated_at: "version-2" };
    assert.deepEqual(issueChanges(base, draft, latest), [
      {
        key,
        label: issueEditFields.find(([field]) => field === key)[1],
        conflict: true,
      },
    ]);
    assert.equal(reconcileIssue(base, draft, latest, {}), null, key);
    assert.equal(
      reconcileIssue(base, draft, latest, { [key]: "mine" })[key],
      "mine",
    );
    assert.equal(
      reconcileIssue(base, draft, latest, { [key]: "latest" })[key],
      "latest",
    );
  }
});

test("identical edits need no conflict choice and clearing an assignment is preserved", () => {
  const assigned = { ...base, assigned_to: "teammate" };
  const draft = { ...assigned, assigned_to: null, title: "Same title" };
  const latest = { ...assigned, title: "Same title", updated_at: "version-2" };
  assert.equal(
    issueChanges(assigned, draft, latest).some((change) => change.conflict),
    false,
  );
  const merged = reconcileIssue(assigned, draft, latest, {});
  assert.equal(merged.title, "Same title");
  assert.equal(merged.assigned_to, null);
});

test("repeated changes are reconciled against the newly adopted base, not the original record", () => {
  const latest = { ...base, status: "TESTING", updated_at: "version-2" };
  const first = reconcileIssue(
    base,
    { ...base, title: "My title" },
    latest,
    {},
  );
  const newer = {
    ...latest,
    status: "RESOLVED",
    title: "Teammate title",
    updated_at: "version-3",
  };
  assert.equal(reconcileIssue(latest, first, newer, {}), null);
  const reviewed = reconcileIssue(latest, first, newer, { title: "mine" });
  assert.equal(reviewed.title, "My title");
  assert.equal(reviewed.status, "RESOLVED");
  assert.equal(reviewed.updated_at, "version-3");
});

test("review never mixes another issue into the draft", () => {
  assert.equal(reconcileIssue(base, base, { ...base, id: "other" }, {}), null);
  assert.equal(reconcileIssue(base, { ...base, id: "other" }, base, {}), null);
});
