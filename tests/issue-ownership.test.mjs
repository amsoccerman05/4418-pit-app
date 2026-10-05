import { test } from "node:test";
import assert from "node:assert/strict";
import { issueOwner } from "../src/model.ts";

test("issue ownership distinguishes unassigned issues from unavailable profiles", () => {
  const profiles = [
    { id: "crew", display_name: "  Jamie Chen  ", active: true },
    { id: "former", display_name: "Former teammate", active: false },
    { id: "blank", display_name: "   " },
    { id: "missing-name", display_name: null },
  ];
  assert.equal(issueOwner({ assigned_to: null }, profiles), "Unassigned");
  assert.equal(issueOwner({ assigned_to: "crew" }, profiles), "Jamie Chen");
  assert.equal(
    issueOwner({ assigned_to: "former" }, profiles),
    "Former teammate",
  );
  for (const id of ["unknown", "blank", "missing-name"])
    assert.equal(
      issueOwner({ assigned_to: id }, profiles),
      "Assigned teammate",
    );
  assert.equal(issueOwner({ assigned_to: "crew" }, []), "Assigned teammate");
});
