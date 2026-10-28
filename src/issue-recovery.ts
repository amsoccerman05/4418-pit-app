import type { Issue } from "./model";

// Match the explicit rejected-write response, not a timeout or unknown outcome.
export function isIssueConflict(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return (
    message ===
    "This issue changed on another device. Close and reopen it before saving."
  );
}

export const issueEditFields = [
  ["title", "Title"],
  ["status", "Status"],
  ["severity", "Severity"],
  ["assigned_to", "Assigned to"],
  ["battery_id", "Linked battery"],
  ["root_cause", "Root cause"],
  ["repair_notes", "Repair performed"],
  ["resolution_notes", "Resolution notes"],
] as const;
export type IssueEditField = (typeof issueEditFields)[number][0];
export type IssueChoices = Partial<Record<IssueEditField, "mine" | "latest">>;

export function issueChanges(base: Issue, draft: Issue, latest: Issue) {
  return issueEditFields
    .filter(([key]) => latest[key] !== base[key])
    .map(([key, label]) => ({
      key,
      label,
      conflict: draft[key] !== base[key] && draft[key] !== latest[key],
    }));
}

// Rebase only after explicit review. Untouched fields always take the latest
// value; a field changed by both people needs an explicit choice. This does not
// save or relax the server's expected_updated_at check.
export function reconcileIssue(
  base: Issue,
  draft: Issue,
  latest: Issue,
  choices: IssueChoices,
): Issue | null {
  if (base.id !== draft.id || base.id !== latest.id) return null;
  const conflicts = issueChanges(base, draft, latest).filter(
    (change) => change.conflict,
  );
  if (
    conflicts.some(
      ({ key }) => choices[key] !== "mine" && choices[key] !== "latest",
    )
  )
    return null;
  const result = { ...latest };
  for (const [key] of issueEditFields) {
    if (draft[key] === base[key] || choices[key] === "latest") continue;
    Object.assign(result, { [key]: draft[key] });
  }
  return result;
}
