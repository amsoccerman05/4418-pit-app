import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Real TSX render coverage, using the repository's existing test loader.
const require = createRequire(import.meta.url);
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, path) =>
    module._compile(
      ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      path,
    );
}
require.extensions[".css"] = () => {};
const { CrewQuickStart } = require("../src/competition/CrewQuickStart.tsx");
const render = (props) =>
  renderToStaticMarkup(React.createElement(CrewQuickStart, props));

function fixture() {
  const calls = [];
  return {
    d: {
      config: null,
      can_manage: true,
      manual_matches_enabled: true,
      matches: [],
      templates: [],
      runs: [],
      items: [],
      links: [],
      areas: [],
    },
    data: { events: [{ id: "event", status: "active" }], batteries: [] },
    profile: { id: "crew", active: true, role: "mentor" },
    readOnly: false,
    next: {
      source: "manual",
      key: "manual:practice",
      label: "Driver warmup",
      completed: false,
      archived: false,
    },
    open: (key) => calls.push(["open", key]),
    go: (page) => calls.push(["go", page]),
    report: () => calls.push(["report"]),
    calls,
  };
}

function buttons(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(buttons);
  return [
    ...(element.type === "button" ? [element] : []),
    ...buttons(element.props?.children),
  ];
}
const button = (props, text) =>
  buttons(CrewQuickStart(props)).find((node) => node.props.children === text);

test("crew guide is a collapsed native disclosure with honest battery and physical-work guidance", () => {
  const props = fixture();
  const html = render(props);
  assert.match(html, /^<details class="card comp-crew-guide"><summary>/);
  assert.ok(!html.includes(" open="));
  for (const text of [
    "Crew quick-start",
    "Driver warmup",
    "assign the battery",
    "stays current until leadership finishes",
    "The battery list may be incomplete.",
    "physical label and status",
    "ask a mentor or admin to add it",
    "Assigning a battery does not install it.",
    "Finishing a practice does not check off items or remove the battery.",
  ]) {
    assert.ok(html.includes(text), text);
  }
  assert.deepEqual(props.calls, []);
});

test("active crew guide opens existing workflows without performing mutations itself", () => {
  const props = fixture();
  for (const label of [
    "Open current preparation",
    "Open Batteries",
    "Open Matches",
    "Report an issue",
  ]) {
    const action = button(props, label);
    assert.ok(action, label);
    assert.equal(action.props.type, "button");
    action.props.onClick();
  }
  assert.deepEqual(props.calls, [
    ["open", "manual:practice"],
    ["go", "batteries"],
    ["go", "matches"],
    ["report"],
  ]);
  assert.equal(button(props, "Add next practice"), undefined);
});

test("student guidance separates leadership assignment from crew checklist work", () => {
  const props = fixture();
  props.profile.role = "student";
  props.d.can_manage = false;
  const html = render(props);
  assert.ok(
    html.includes(
      "Leadership starts preparation and assigns the battery; complete",
    ),
  );
  assert.ok(html.includes("Report an issue"));
  props.next = null;
  assert.ok(render(props).includes("Ask competition leadership"));
  assert.equal(button(props, "Add next practice"), undefined);
});

test("readonly, inactive and stale sessions keep browsing and never expose write-entry actions", () => {
  for (const variant of ["readonly", "inactive", "stale"]) {
    const props = fixture();
    if (variant === "readonly") props.profile.role = "readonly";
    if (variant === "inactive") props.profile.active = false;
    if (variant === "stale") props.readOnly = true;
    const html = render(props);
    assert.ok(
      html.includes(
        variant === "stale" ? "Read-only snapshot" : "View-only access",
      ),
      variant,
    );
    assert.ok(html.includes("View current preparation"));
    assert.equal(button(props, "Report an issue"), undefined);
    button(props, "View issues").props.onClick();
    assert.deepEqual(props.calls, [["go", "issues"]]);
    props.next = null;
    assert.equal(button(props, "Add next practice"), undefined);
    assert.ok(!render(props).includes("Use Add next practice above"));
  }
});

test("empty leadership state points to the existing dashboard shortcut without duplicating it", () => {
  const props = fixture();
  props.next = null;
  assert.ok(
    render(props).includes(
      "Use Add next practice above to start preparation without an official schedule.",
    ),
  );
  assert.deepEqual(props.calls, []);
  assert.equal(button(props, "Add next practice"), undefined);
  props.d.manual_matches_enabled = false;
  assert.ok(render(props).includes("Manual practice is not enabled"));
});

test("no active event guides setup instead of opening stale preparation or issue reporting", () => {
  const props = fixture();
  props.data.events[0].status = "completed";
  const html = render(props);
  assert.ok(html.includes("No active event"));
  assert.ok(html.includes("Activate an event in Event before starting."));
  assert.equal(button(props, "Open current preparation"), undefined);
  assert.equal(button(props, "Add next practice"), undefined);
  assert.equal(button(props, "Report an issue"), undefined);
  button(props, "Open Event").props.onClick();
  assert.deepEqual(props.calls, [["go", "admin"]]);
  props.profile.role = "lead";
  assert.ok(
    render(props).includes("Ask a mentor or admin to activate an event"),
  );
});

test("official preparation opens its actual key without manual-practice guidance", () => {
  const props = fixture();
  props.next = { key: "2026test_qm17", label: "Q17", completed: false };
  const html = render(props);
  assert.ok(html.includes("Q17"));
  assert.ok(!html.includes("This practice stays current"));
  button(props, "Open current preparation").props.onClick();
  assert.deepEqual(props.calls, [["open", "2026test_qm17"]]);
});

test("stale official schedule labels its preparation snapshot while manual preparation stays current", () => {
  const props = fixture();
  props.scheduleStale = true;
  let html = render(props);
  assert.ok(html.includes("Current preparation:"));
  assert.ok(!html.includes("Last loaded preparation:"));
  props.next = { key: "2026test_qm17", label: "Q17", completed: false };
  html = render(props);
  assert.ok(html.includes("Last loaded preparation:"));
  assert.ok(!html.includes("Current preparation:"));
  assert.ok(
    html.includes("Confirm the latest match and timing with the field crew."),
  );
  props.scheduleStale = false;
  html = render(props);
  assert.ok(html.includes("Current preparation:"));
  assert.ok(
    !html.includes("Confirm the latest match and timing with the field crew."),
  );
});
