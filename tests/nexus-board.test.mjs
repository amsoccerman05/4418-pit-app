import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseNexusBoard,
  parsePitAddresses,
  parsePitMap,
  findTeamPit,
  NEXUS_BOARD_LIMITS,
} from "../supabase/functions/competition-feed/nexus-board.ts";

const now = 1800000000000;
const event = (extra = {}) => ({
  eventKey: "2026test",
  dataAsOfTime: now,
  announcements: [],
  partsRequests: [],
  ...extra,
});
const post = (extra = {}) => ({
  id: "a1",
  announcement: "Pits close at 7 pm.",
  postedTime: now - 1000,
  ...extra,
});
const request = (extra = {}) => ({
  id: "p1",
  parts: "Need a 3/8-inch wrench",
  requestedByTeam: "4418",
  postedTime: now - 2000,
  ...extra,
});
const shape = (extra = {}) => ({
  position: { x: 100, y: 100 },
  size: { x: 100, y: 100 },
  ...extra,
});
const mapData = (extra = {}) => ({
  size: { x: 840, y: 1293 },
  pits: {
    A1: shape({ team: "4418" }),
    A2: shape({ position: { x: 200, y: 100 } }),
  },
  areas: { a1: shape({ label: "Pit admin" }) },
  labels: { l1: shape({ label: "Field" }) },
  arrows: { r1: shape({ type: "single", angle: -90 }) },
  walls: { w1: shape() },
  ...extra,
});

test("Nexus v1.8 board uses only current announcement/parts fields and source milliseconds", () => {
  const data = parseNexusBoard(
    event({
      announcements: [post()],
      partsRequests: [request()],
      apiKey: "never expose",
    }),
    "2026test",
  );
  assert.deepEqual(data, {
    asOf: now,
    announcements: [{ id: "a1", text: "Pits close at 7 pm.", at: now - 1000 }],
    partsRequests: [
      {
        id: "p1",
        text: "Need a 3/8-inch wrench",
        team: "4418",
        at: now - 2000,
      },
    ],
    announcementCount: 1,
    partsRequestCount: 1,
  });
  assert.ok(!JSON.stringify(data).includes("never expose"));
  assert.deepEqual(parseNexusBoard(event(), "2026test").partsRequests, []);
});

test("missing or malformed board collections cannot silently become no announcements/requests", () => {
  for (const raw of [
    null,
    [],
    {},
    event({ eventKey: "2026other" }),
    event({ dataAsOfTime: "1800000000000" }),
    event({ dataAsOfTime: 1800000000 }),
    event({ announcements: null }),
    event({ announcements: {} }),
    event({ partsRequests: undefined }),
    event({ partsRequests: {} }),
  ])
    assert.throws(() => parseNexusBoard(raw, "2026test"), /Invalid Nexus/);
  for (const malformed of [
    null,
    [],
    {},
    post({ id: null }),
    post({ announcement: {} }),
    post({ postedTime: Infinity }),
    post({ postedTime: -1 }),
    post({ id: "a\u0000" }),
  ])
    assert.throws(
      () => parseNexusBoard(event({ announcements: [malformed] }), "2026test"),
      /Invalid Nexus/,
    );
  for (const team of [4418, "frc4418", "04418", "0", "1<script>", "", "100000"])
    assert.throws(
      () =>
        parseNexusBoard(
          event({ partsRequests: [request({ requestedByTeam: team })] }),
          "2026test",
        ),
      /Invalid Nexus/,
    );
});

test("whole snapshots are validated, duplicate IDs rejected and latest output bounded", () => {
  const announcements = Array.from({ length: 70 }, (_, i) =>
    post({ id: String(i), postedTime: now - i }),
  );
  const partsRequests = Array.from({ length: 70 }, (_, i) =>
    request({ id: String(i), postedTime: now - i }),
  );
  const result = parseNexusBoard(
    event({ announcements: [...announcements].reverse(), partsRequests }),
    "2026test",
  );
  assert.equal(result.announcements.length, NEXUS_BOARD_LIMITS.announcements);
  assert.equal(result.partsRequests.length, NEXUS_BOARD_LIMITS.partsRequests);
  assert.equal(result.announcementCount, 70);
  assert.equal(result.partsRequestCount, 70);
  assert.equal(result.announcements[0].id, "0");
  assert.throws(
    () =>
      parseNexusBoard(
        event({
          announcements: [...announcements, post({ postedTime: null })],
        }),
        "2026test",
      ),
    /Invalid Nexus/,
  );
  assert.throws(
    () =>
      parseNexusBoard(event({ announcements: [post(), post()] }), "2026test"),
    /Invalid Nexus/,
  );
  assert.throws(
    () =>
      parseNexusBoard(
        event({ announcements: Array(1001).fill(post()) }),
        "2026test",
      ),
    /Invalid Nexus/,
  );
});

test("hostile text stays bounded inert text; upstream HTML, URLs and arbitrary objects are not projected", () => {
  const board = parseNexusBoard(
    event({
      announcements: [
        post({
          announcement: "<img src=x onerror=alert(1)>\u0000\u202ehello",
          url: "javascript:alert(1)",
        }),
      ],
      partsRequests: [
        request({ parts: "x".repeat(3500), html: "<script>oops</script>" }),
      ],
    }),
    "2026test",
  );
  assert.equal(
    board.announcements[0].text,
    "<img src=x onerror=alert(1)>  hello",
  );
  assert.equal(board.partsRequests[0].text.length, 3000);
  assert.ok(board.partsRequests[0].text.endsWith("…"));
  assert.ok(!JSON.stringify(board).includes("javascript:"));
  assert.throws(
    () =>
      parseNexusBoard(
        event({ announcements: [post({ announcement: "x".repeat(20001) })] }),
        "2026test",
      ),
    /Invalid Nexus/,
  );
});

test("pit addresses preserve exact arbitrary address text and reject unsafe/invalid keys", () => {
  assert.deepEqual(parsePitAddresses({ 4418: "South / A-1" }), {
    4418: "South / A-1",
  });
  assert.deepEqual(parsePitAddresses({}), {});
  for (const raw of [
    null,
    [],
    { frc4418: "A1" },
    { 4418: 1 },
    { 4418: "A1\n" },
    { "04418": "A1" },
    JSON.parse('{"__proto__":"A1"}'),
    { 4418: "" },
  ])
    assert.throws(() => parsePitAddresses(raw), /Invalid Nexus/);
  assert.throws(
    () =>
      parsePitAddresses(
        Object.fromEntries(
          Array.from({ length: 1001 }, (_, i) => [i + 1, "A1"]),
        ),
      ),
    /Invalid Nexus/,
  );
});

test("official center geometry, optional fields, rotations and fixed arrow variants are normalized", () => {
  const map = parsePitMap(mapData());
  assert.equal(map.width, 840);
  assert.equal(map.pits[0].x, 100);
  assert.equal(map.pits[0].y, 100);
  assert.equal(map.pits[0].width, 100);
  assert.equal(map.pits[1].team, null);
  assert.equal(map.arrows[0].angle, -90);
  assert.equal(map.arrows[0].color, "blue");
  const minimal = parsePitMap({ size: { x: 500, y: 500 }, pits: {} });
  assert.deepEqual(minimal, {
    width: 500,
    height: 500,
    pits: [],
    areas: [],
    labels: [],
    arrows: [],
    walls: [],
  });
  assert.equal(parsePitMap(null), null, "Caller maps confirmed 404 to null");
  assert.throws(
    () => parsePitMap(undefined),
    /Invalid Nexus/,
    "Not checked is not confirmed no map",
  );
});

test("malformed or unbounded geometry rejects the entire map snapshot", () => {
  for (const raw of [
    [],
    {},
    mapData({ size: { x: 0, y: 20 } }),
    mapData({ size: { x: Infinity, y: 20 } }),
    mapData({ size: { x: 100001, y: 20 } }),
    mapData({ pits: [] }),
    mapData({ pits: null }),
    mapData({ areas: "url" }),
    mapData({ arrows: { bad: shape({ type: "url" }) } }),
    mapData({
      arrows: {
        bad: shape({ type: "single", color: "url(javascript:alert(1))" }),
      },
    }),
  ])
    assert.throws(() => parsePitMap(raw), /Invalid Nexus/);
  for (const extra of [
    { position: { x: NaN, y: 10 } },
    { position: { x: "100", y: 10 } },
    { position: { x: -1000000, y: 10 } },
    { size: { x: 0, y: 100 } },
    { size: { x: 1e12, y: 100 } },
    { angle: "90" },
    { angle: 361 },
    { team: {} },
  ])
    assert.throws(
      () => parsePitMap(mapData({ pits: { A1: shape(extra) } })),
      /Invalid Nexus/,
    );
  assert.throws(
    () =>
      parsePitMap(
        mapData({
          pits: Object.fromEntries(
            Array.from({ length: 801 }, (_, i) => [String(i), shape()]),
          ),
        }),
      ),
    /Invalid Nexus/,
  );
});

test("map projection drops SVG, URLs and arbitrary colors instead of embedding assets", () => {
  const map = parsePitMap(
    mapData({
      image: "https://evil.example/map.svg",
      svg: "<svg onload=alert(1)>",
      pits: {
        A1: shape({
          team: "4418",
          href: "javascript:alert(1)",
          style: "url(x)",
          color: "red",
        }),
      },
    }),
  );
  const json = JSON.stringify(map);
  for (const disallowed of ["https:", "javascript:", "onload", "href", "style"])
    assert.ok(!json.includes(disallowed));
});

test("pit lookup requires an exact unambiguous assignment and never guesses addresses", () => {
  const map = parsePitMap(mapData());
  assert.equal(findTeamPit("4418", map)?.id, "A1");
  assert.equal(findTeamPit("4418", map, { 4418: "A1" })?.id, "A1");
  assert.equal(findTeamPit("4418", map, {4418:"A1",1619:"A1"}),null);
  assert.equal(findTeamPit("123", map, { 123: "A2" })?.id, "A2");
  assert.equal(findTeamPit("4418", map, { 4418: "a1" }), null);
  assert.equal(findTeamPit("123", map, { 123: "A1" }), null);
  assert.equal(findTeamPit("123", map, { 123: "A2", 456: "A2" }), null);
  assert.equal(findTeamPit("frc4418", map), null);
  assert.equal(findTeamPit("4418", null, { 4418: "A1" }), null);
  const duplicate = parsePitMap(
    mapData({
      pits: { A1: shape({ team: "4418" }), B1: shape({ team: "4418" }) },
    }),
  );
  assert.equal(findTeamPit("4418", duplicate), null);
});

// Real React SSR plus an isolated event-handler harness cover text and repeated
// interactions without opening a browser. These do not establish visual layout.
const require = createRequire(import.meta.url);
for (const ext of [".ts", ".tsx"])
  require.extensions[ext] = (module, path) =>
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
require.extensions[".css"] = () => {};
const { EventBoard } = require("../src/competition/EventBoard.tsx");
const props = (extra = {}) => ({
  board: parseNexusBoard(
    event({ announcements: [post()], partsRequests: [request()] }),
    "2026test",
  ),
  boardAt: now,
  map: parsePitMap(mapData()),
  mapAt: now,
  addresses: { 4418: "A1" },
  addressesAt: now,
  now,
  ...extra,
});
const render = (extra) =>
  renderToStaticMarkup(React.createElement(EventBoard, props(extra)));

test("SSR board distinguishes empty, stale and unavailable snapshots with separate timestamps", () => {
  const current = render();
  for (const text of [
    "Latest event snapshot",
    "Published",
    "Checked",
    "Pits close at 7 pm.",
    "Need a 3/8-inch wrench",
    "Find team 4418 at pit A1",
    "Open pit map",
    "https://frc.nexus",
  ])
    assert.ok(current.includes(text), text);
  assert.ok(!current.includes("<svg"));
  const empty = render({
    board: parseNexusBoard(event(), "2026test"),
    map: null,
    mapAt: now,
  });
  assert.ok(empty.includes("No current announcements."));
  assert.ok(empty.includes("No current parts requests."));
  assert.ok(empty.includes("No pit map published for this event."));
  const old = render({ now: now + 700000 });
  assert.ok(old.includes("Last known board · may be stale"));
  assert.ok(old.includes("Last known map · may be stale"));
  const unavailable = render({
    board: null,
    boardError: "secret credentials",
    map: null,
    mapError: "secret credentials",
  });
  assert.ok(unavailable.includes("Event board unavailable"));
  assert.ok(unavailable.includes("Pit map unavailable"));
  assert.ok(!unavailable.includes("No current announcements"));
  assert.ok(!unavailable.includes("secret credentials"));
});

test("SSR escapes untrusted announcement and address content as text", () => {
  const html = render({
    board: parseNexusBoard(
      event({
        announcements: [post({ announcement: '<img src=x onerror="oops">' })],
        partsRequests: [request()],
      }),
      "2026test",
    ),
    addresses: { 4418: "<script>oops</script>" },
  });
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script"));
});

function harness(initial = props()) {
  const slots = [];
  let cursor = 0;
  const react = {
    useId: () => "test-board",
    useRef: () => ({ current: null }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(
      new URL("../src/competition/EventBoard.tsx", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(
    (id) =>
      id === "react"
        ? react
        : id.endsWith(".css")
          ? {}
          : id.includes("nexus-board")
            ? { findTeamPit }
            : require(id),
    exports,
  );
  let tree;
  const rerender = () => {
    cursor = 0;
    tree = exports.EventBoard(initial);
    return tree;
  };
  const walk = (node, predicate) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node))
      return node.flatMap((child) => walk(child, predicate));
    return [
      ...(predicate(node) ? [node] : []),
      ...walk(node.props?.children, predicate),
    ];
  };
  rerender();
  return {
    rerender,
    html: () => renderToStaticMarkup(tree),
    find: (predicate) => walk(tree, predicate),
    props: initial,
  };
}

test("team click, keyboard selection, lookup, Clear and repeated Close remain read-only inline flows", () => {
  const h = harness();
  h.find(
    (n) => n.props?.["aria-label"] === "Find team 4418 at pit A1",
  )[0].props.onClick();
  h.rerender();
  assert.ok(h.html().includes("is highlighted"));
  assert.ok(h.html().includes("<svg"));
  assert.ok(!h.html().includes('role="dialog"'));
  const pit = h.find((n) => n.type === "g" && n.props.role === "button")[0];
  assert.equal(pit.props["aria-label"], "Team 4418, pit A1");
  let prevented = false;
  pit.props.onKeyDown({
    key: " ",
    preventDefault() {
      prevented = true;
    },
  });
  h.rerender();
  assert.equal(prevented, true);
  h.find((n) => n.type === "input")[0].props.onChange({
    target: { value: "999" },
  });
  h.rerender();
  h.find((n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  h.rerender();
  assert.ok(h.html().includes("No pit location is published for team"));
  h.find(
    (n) => n.type === "button" && n.props.children === "Clear",
  )[0].props.onClick();
  h.rerender();
  assert.ok(h.html().includes("Enter a team number or select a labeled pit."));
  for (let i = 0; i < 2; i++) {
    h.find(
      (n) => n.type === "button" && n.props.children === "Close pit map",
    )[0].props.onClick();
    h.rerender();
    assert.ok(!h.html().includes("<svg"));
    h.find(
      (n) => n.type === "button" && n.props.children === "Open pit map",
    )[0].props.onClick();
    h.rerender();
    assert.ok(h.html().includes("<svg"));
  }
  let stopped = false;
  h.find(
    (n) => n.props.className === "event-board-map-content",
  )[0].props.onKeyDown({
    key: "Escape",
    preventDefault() {},
    stopPropagation() {
      stopped = true;
    },
  });
  h.rerender();
  assert.equal(stopped, true);
  assert.ok(!h.html().includes("<svg"));
});

test("expanded map draws centered rotated local geometry and offers textual fallback without a map", () => {
  const h = harness();
  h.find(
    (n) => n.type === "button" && n.props.children === "Open pit map",
  )[0].props.onClick();
  h.rerender();
  const html = h.html();
  assert.ok(html.includes("translate(100 100) rotate(-90)"));
  assert.ok(html.includes('x="-50" y="-50" width="100" height="100"'));
  for (const forbidden of ["<image", "<foreignObject", "<script", "<iframe"])
    assert.ok(!html.includes(forbidden));
  h.props.map = null;
  h.rerender();
  h.find((n) => n.type === "input")[0].props.onChange({
    target: { value: "4418" },
  });
  h.rerender();
  h.find((n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  h.rerender();
  assert.ok(h.html().includes("No unambiguous map location is available."));
  assert.ok(h.html().includes("<strong>A1</strong>"));
});
