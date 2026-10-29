import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import {
  isIssueConflict,
  issueChanges,
  reconcileIssue,
} from "../src/issue-recovery.ts";
import {
  canManage,
  canWork,
  issueOwner,
  batteryReference,
  issueStatuses,
  severities,
} from "../src/model.ts";
import { accessFailure, UNKNOWN_SAVE } from "../src/connection.ts";
import { canDismissCompletedEditor } from "../src/issue-route.ts";

// Execute the production component/save functions with a tiny deterministic
// hook store, not a copied recovery implementation. No browser or HTTP calls.
const source = readFileSync(
  new URL("../src/main.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "main.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function fn(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `${name} exists`);
  return ts.transpileModule(found.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
}
const base = {
  id: "issue",
  issue_number: 1,
  updated_at: "version-1",
  created_at: "2026-10-01",
  title: "Original repair",
  description: "Synthetic repair",
  status: "OPEN",
  severity: "LOW",
  assigned_to: null,
  battery_id: null,
  root_cause: "",
  repair_notes: "",
  resolution_notes: "",
};
function component() {
  const states = [];
  let cursor = 0;
  const useState = (initial) => {
    const slot = cursor++;
    if (!(slot in states))
      states[slot] = typeof initial === "function" ? initial() : initial;
    return [
      states[slot],
      (value) => {
        states[slot] =
          typeof value === "function" ? value(states[slot]) : value;
      },
    ];
  };
  const names = {
    useState,
    React,
    canManage,
  canWork,
    issueOwner,
    batteryReference,
    issueStatuses,
    severities,
    issueChanges,
    reconcileIssue,
    Field: "Field",
    Select: "Select",
    Badge: "Badge",
    UserRound: "UserRound",
    PurchaseLinks: "PurchaseLinks",
    stamp: String,
  };
  const Detail = new Function(
    ...Object.keys(names),
    `${fn("IssueDetail")}; return IssueDetail;`,
  )(...Object.values(names));
  const sent = [];
  const props = {
    issue: base,
    demo: false,
    purchaseScope: {},
    data: { profiles: [], batteries: [], issueEvents: [] },
    profile: { id: "me", role: "lead", active: true },
    busy: false,
    saving: false,
    refreshing: false,
    conflict: false,
    name: String,
    submit: async (p) => {
      sent.push(p);
      return true;
    },
    refresh: async () => false,
    reconciled: () => {
      props.conflict = false;
    },
  };
  const render = () => {
    cursor = 0;
    return Detail(props);
  };
  const flatten = (node) =>
    Array.isArray(node)
      ? node.flatMap(flatten)
      : node && typeof node === "object"
        ? [node, ...flatten(node.props?.children)]
        : [];
  const nodes = () => flatten(render());
  const field = (label) =>
    nodes().find((n) => n.type === "Field" && n.props.label === label).props
      .children;
  const button = (label) =>
    nodes().find((n) => n.type === "button" && n.props.children === label);
  const submit = () =>
    nodes()
      .find((n) => n.type === "form")
      .props.onSubmit({ preventDefault() {} });
  return { props, states, sent, render, nodes, field, button, submit };
}

test("refresh keeps typed draft/token, blocks stale save, and explicit review submits a fresh token", () => {
  const f = component();
  f.field("Title").props.onChange({ target: { value: "My typed title" } });
  f.props.conflict = true;
  f.submit();
  assert.equal(f.sent.length, 0);
  assert.equal(f.field("Title").props.value, "My typed title");
  f.props.issue = { ...base, status: "TESTING", updated_at: "version-2" };
  f.render();
  assert.equal(f.states[0].updated_at, "version-1");
  assert.equal(f.button("Save issue").props.disabled, true);
  f.button("Review changes").props.onClick();
  f.button("Apply reviewed changes").props.onClick();
  assert.equal(f.field("Title").props.value, "My typed title");
  assert.equal(f.states[0].status, "TESTING");
  f.submit();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].expected_updated_at, "version-2");
});

test("overlapping edits require a choice and a newer refresh invalidates previous choices", () => {
  const f = component();
  f.field("Title").props.onChange({ target: { value: "My title" } });
  f.props.issue = { ...base, title: "Their title", updated_at: "version-2" };
  f.button("Review changes").props.onClick();
  assert.equal(f.button("Apply reviewed changes").props.disabled, true);
  f.field("Use for title").props.onChange({ target: { value: "mine" } });
  assert.equal(f.button("Apply reviewed changes").props.disabled, false);
  f.props.issue = {
    ...base,
    title: "Even newer title",
    updated_at: "version-3",
  };
  assert.equal(f.button("Apply reviewed changes").props.disabled, true);
  f.button("Apply reviewed changes").props.onClick();
  assert.equal(f.states[0].updated_at, "version-1");
  f.field("Use for title").props.onChange({ target: { value: "latest" } });
  f.button("Apply reviewed changes").props.onClick();
  assert.equal(f.field("Title").props.value, "Even newer title");
  f.submit();
  assert.equal(f.sent[0].expected_updated_at, "version-3");
});

test("failed or pending refresh cannot discard draft or enable a stale save", async () => {
  const f = component();
  f.field("Repair performed").props.onChange({
    target: { value: "Keep my work" },
  });
  f.props.conflict = true;
  await f.button("Refresh latest issue").props.onClick();
  assert.equal(f.field("Repair performed").props.value, "Keep my work");
  assert.equal(f.states[0].updated_at, "version-1");
  f.submit();
  assert.equal(f.sent.length, 0);
  f.props.issue = { ...base, status: "REPAIRING", updated_at: "version-2" };
  f.button("Review changes").props.onClick();
  f.props.refreshing = true;
  assert.equal(f.button("Apply reviewed changes").props.disabled, true);
  f.button("Apply reviewed changes").props.onClick();
  assert.equal(f.states[0].updated_at, "version-1");
});

test("review pauses draft editing and returning to the draft clears prior choices", () => {
  const f = component();
  f.field("Title").props.onChange({ target: { value: "My title" } });
  f.props.issue = { ...base, title: "Their title", updated_at: "version-2" };
  f.button("Review changes").props.onClick();
  assert.equal(
    f.nodes().find((n) => n.type === "fieldset").props.disabled,
    true,
  );
  f.field("Use for title").props.onChange({ target: { value: "latest" } });
  f.button("Back to my draft").props.onClick();
  assert.equal(
    f.nodes().find((n) => n.type === "fieldset").props.disabled,
    false,
  );
  f.field("Title").props.onChange({ target: { value: "New typing" } });
  f.button("Review changes").props.onClick();
  assert.equal(f.field("Use for title").props.value, "");
  assert.equal(f.button("Apply reviewed changes").props.disabled, true);
  assert.equal(f.states[0].title, "New typing");
});

test("discard is explicit and ordinary refresh never replaces work", () => {
  const f = component();
  f.field("Title").props.onChange({ target: { value: "My title" } });
  f.props.issue = { ...base, title: "Latest title", updated_at: "version-2" };
  assert.equal(f.field("Title").props.value, "My title");
  f.button("Review changes").props.onClick();
  f.button("Discard my edits and use latest").props.onClick();
  assert.equal(f.field("Title").props.value, "Latest title");
  assert.equal(f.sent.length, 0);
});

test("readonly and blocked editors never submit a programmatic stale form", () => {
  const f = component();
  f.props.profile.role = "student";
  f.submit();
  assert.equal(f.sent.length, 0);
  f.props.profile.role = "lead";
  f.props.busy = true;
  f.submit();
  assert.equal(f.sent.length, 0);
});

test("read-only recovery does not claim a save is still running", () => {
  const f = component();
  f.props.busy = true;
  assert.equal(f.button("Save issue").props.disabled, true);
  f.props.saving = true;
  assert.equal(f.button("Saving…").props.disabled, true);
});

async function saveFailure(error, { moved = false, expired = false, demoted = false } = {}) {
  const modal = { kind: "issue", id: "issue" },
    states = {};
  let calls = 0;
  const names = {
    profile: { id: "me", role:"lead", active:true },
    latestProfile: { current: { id:"me", role:"lead", active:true } },
    canWork,
    saving: { current: false },
    demo: false,
    pitReadOnly: false,
    offlineNow: () => false,
    accessCurrent: () => true,
    setError: (v) => (states.error = v),
    modalIdentity: { current: modal },
    location: { hash: "" },
    accountRequests: { current: new AbortController() },
    appLive: { current: true },
    setBusy: (v) => (states.busy = v),
    setNotice: (v) => (states.notice = v),
    mutate: async () => {
      calls++;
      if (moved) names.modalIdentity.current = { kind: "issue", id: "other" };
      if (expired) names.accountRequests.current.abort();
      if (demoted) names.latestProfile.current = {...names.latestProfile.current,role:"readonly"};
      throw error;
    },
    refresh: async () => {
      throw Error("No automatic read/write retry expected");
    },
    canDismissCompletedEditor,
    closeModal: () => {
      states.closed = true;
    },
    accessFailure,
    invalidateAccess: () => {
      states.invalidated = true;
    },
    isIssueConflict,
    setIssueConflict: (v) => (states.conflict = v),
    setUncertainSave: (v) => (states.uncertain = v),
    UNKNOWN_SAVE,
  };
  const save = new Function(
    ...Object.keys(names),
    `${fn("save")}; return save;`,
  )(...Object.values(names));
  assert.equal(
    await save("update_issue", {
      id: "issue",
      expected_updated_at: "version-1",
    }),
    false,
  );
  return { states, calls };
}

test("known rejected conflict is not marked uncertain and never automatically retried", async () => {
  const { states, calls } = await saveFailure({
    code: "P0001",
    message:
      "This issue changed on another device. Close and reopen it before saving.",
  });
  assert.equal(calls, 1);
  assert.equal(states.conflict, "issue");
  assert.match(states.error, /Your edits are still here/);
  assert.equal(states.uncertain, undefined);
  assert.equal(states.busy, false);
});

test("unknown transport outcomes keep existing refresh-before-retry safety", async () => {
  const { states, calls } = await saveFailure(new Error("Failed to fetch"));
  assert.equal(calls, 1);
  assert.equal(states.uncertain, true);
  assert.equal(states.error, UNKNOWN_SAVE);
  assert.equal(states.conflict, undefined);
});

test("late conflict cannot affect a newer editor or cleared account scope", async () => {
  const conflict = new Error(
    "This issue changed on another device. Close and reopen it before saving.",
  );
  for (const options of [{ moved: true }, { expired: true }]) {
    const { states } = await saveFailure(conflict, options);
    assert.equal(states.conflict, undefined);
    assert.equal(states.uncertain, undefined);
    assert.equal(states.closed, undefined);
  }
  const { states } = await saveFailure({
    code: "42501",
    message: "Permission denied",
  });
  assert.equal(states.invalidated, true);
  assert.equal(states.conflict, undefined);
});

 test("same-identity permission loss releases in-flight lock without closing the draft",async()=>{
 const {states,calls}=await saveFailure(new Error("Pit account changed."),{demoted:true});
 assert.equal(calls,1);assert.equal(states.busy,false);assert.equal(states.closed,undefined);assert.equal(states.uncertain,true);
 });
