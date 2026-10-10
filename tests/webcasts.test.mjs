import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseEventWebcasts,
  webcastExternalUrl,
  webcastEmbedUrl,
  validEmbedHostname,
} from "../supabase/functions/competition-feed/webcasts.ts";

const video = "AbCdEF12_-3";
const rawYouTube = {
  type: "youtube",
  channel: video,
  stream_title: "Qualification matches",
};
const rawTwitch = { type: "twitch", channel: "FIRSTUpdates_1" };
const parsed = (...rows) => parseEventWebcasts(rows);

test("webcasts normalize only known TBA fields without deriving live presence", () => {
  assert.deepEqual(
    parsed({
      ...rawYouTube,
      status: "online",
      date: "2026-10-10",
      stream_title: "  Match\u0000 stream\n ",
      embed: "<iframe src='https://evil.invalid'></iframe>",
      url: "https://evil.invalid",
    }),
    [
      {
        id: `youtube:${video}`,
        type: "youtube",
        channel: video,
        title: "Match stream",
        status: "online",
        date: "2026-10-10",
      },
    ],
  );
  assert.equal(parsed(rawTwitch)[0].channel, "firstupdates_1");
  for (const status of [undefined, null, "live", "ONLINE", 1, true, {}])
    assert.equal(parsed({ ...rawYouTube, status })[0].status, "unknown");
  assert.equal(
    parsed({ ...rawYouTube, status: "offline" })[0].status,
    "offline",
  );
  assert.equal(
    parsed({ ...rawYouTube, stream_title: "x".repeat(600) })[0].title.length,
    200,
  );
});

test("absent listings are empty; malformed envelopes do not become valid snapshots", () => {
  for (const empty of [undefined, null, []])
    assert.deepEqual(parseEventWebcasts(empty), []);
  for (const invalid of [{}, "https://youtube.com", 1, false])
    assert.throws(() => parseEventWebcasts(invalid), /Invalid TBA webcast/);
  assert.deepEqual(parsed(null, {}, [], "youtube", false), []);
});

test("untrusted listings have bounded row counts and displayed metadata", () => {
  assert.throws(
    () => parseEventWebcasts(Array.from({ length: 101 }, () => rawYouTube)),
    /Invalid TBA webcast/,
  );
  assert.equal(
    parseEventWebcasts(Array.from({ length: 100 }, () => rawYouTube)).length,
    1,
  );
  const many = Array.from({ length: 100 }, (_, i) => ({
    type: "twitch",
    channel: `first_channel_${i}`,
  }));
  assert.equal(parseEventWebcasts(many).length, 20);
  assert.equal(parseEventWebcasts(many)[19].channel, "first_channel_19");
});

test("webcasts reject arbitrary URLs, HTML, unsupported providers and invalid identifiers", () => {
  for (const channel of [
    "",
    "short",
    "AbCdEF12_-34",
    `${video}\n`,
    ` ${video}`,
    "<script>x</script>",
    "javascript:alert(1)",
    "data:text/html,hi",
    `https://www.youtube.com/watch?v=${video}`,
    `https://www.youtube.com.evil.invalid/embed/${video}`,
    `https://www.youtube.com@evil.invalid/embed/${video}`,
    `//youtube.com/embed/${video}`,
    `${video}?autoplay=1`,
    `${video}#fragment`,
    "../anything",
    "%41bCdEF12_-3",
    null,
    123,
  ])
    assert.deepEqual(parsed({ ...rawYouTube, channel }), [], String(channel));
  for (const channel of [
    "",
    "a".repeat(26),
    "foo/bar",
    "foo?parent=evil.invalid",
    "foo&autoplay=true",
    "<iframe>",
    "https://twitch.tv/firstupdates",
    "foo.bar",
    "foo-bar",
    "føø",
    "foo\n",
  ])
    assert.deepEqual(parsed({ ...rawTwitch, channel }), [], channel);
  for (const type of [
    "iframe",
    "html5",
    "ustream",
    "livestream",
    "youtube.com",
    "YouTube",
    "twitch.tv",
    null,
  ])
    assert.deepEqual(parsed({ type, channel: video }), []);
  assert.equal(parsed(rawYouTube, rawTwitch).length, 2);
});

test("duplicates use canonical identity, conflicting presence is unknown, dates must be real", () => {
  const first = { ...rawTwitch, status: "online", date: "2026-10-10" };
  assert.equal(
    parsed(first, { ...first, channel: first.channel.toLowerCase() }).length,
    1,
  );
  assert.equal(
    parsed(first, { ...first, status: "offline" })[0].status,
    "unknown",
  );
  assert.equal(parsed(first, rawTwitch, first)[0].status, "unknown");
  assert.equal(parsed(first, { ...first, date: "2026-10-11" })[0].date, null);
  for (const date of [
    "2026-02-29",
    "2026-13-01",
    "2026-04-31",
    "today",
    "2026-10-10T00:00:00Z",
    123,
  ])
    assert.equal(parsed({ ...rawYouTube, date })[0].date, null);
  assert.equal(
    parsed({ ...rawYouTube, date: "2024-02-29" })[0].date,
    "2024-02-29",
  );
});

test("direct links and embeds are built from revalidated identities only", () => {
  const youtube = parsed(rawYouTube)[0],
    twitch = parsed(rawTwitch)[0];
  assert.equal(
    webcastExternalUrl(youtube),
    `https://www.youtube.com/watch?v=${video}`,
  );
  assert.equal(
    webcastExternalUrl(twitch),
    "https://www.twitch.tv/firstupdates_1",
  );
  const yt = new URL(webcastEmbedUrl(youtube, null));
  assert.equal(yt.origin, "https://www.youtube-nocookie.com");
  assert.equal(yt.pathname, `/embed/${video}`);
  for (const [key, value] of [
    ["autoplay", "0"],
    ["controls", "1"],
    ["playsinline", "1"],
    ["mute", "1"],
    ["fs", "0"],
  ])
    assert.equal(yt.searchParams.get(key), value);
  const tw = new URL(webcastEmbedUrl(twitch, "amsoccerman05.github.io"));
  assert.equal(tw.origin, "https://player.twitch.tv");
  assert.equal(tw.searchParams.get("parent"), "amsoccerman05.github.io");
  assert.equal(tw.searchParams.get("channel"), "firstupdates_1");
  assert.equal(tw.searchParams.get("autoplay"), "false");
  assert.equal(tw.searchParams.get("muted"), "true");
  for (const bad of [
    { type: "iframe", channel: video },
    { type: "youtube", channel: "javascript:alert(1)" },
    { type: "twitch", channel: "foo&parent=evil.invalid" },
    null,
  ]) {
    assert.equal(webcastExternalUrl(bad), null);
    assert.equal(webcastEmbedUrl(bad, "pit.example.com"), null);
  }
});

test("Twitch parent requires a bare valid hostname, never URLs, ports or injected queries", () => {
  for (const host of [
    "pit.example.com",
    "localhost",
    "127.0.0.1",
    "sub-domain.example.com",
  ])
    assert.equal(validEmbedHostname(host), true, host);
  for (const host of [
    null,
    "",
    "https://pit.example.com",
    "pit.example.com:443",
    "pit.example.com/path",
    "pit.example.com?autoplay=true",
    "pit.example.com&parent=evil.invalid",
    "@evil.invalid",
    "evil..invalid",
    "-bad.example",
    "bad-.example",
    "x".repeat(64) + ".example",
    "999.1.1.1",
    "[::1]",
    "a.123",
    "example.com\n",
    "example.com.",
  ]) {
    assert.equal(validEmbedHostname(host), false, String(host));
    assert.equal(webcastEmbedUrl(parsed(rawTwitch)[0], host), null);
  }
});

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function loadComponent(
  overrides = {},
  cache = new Map(),
  file = "src/competition/EventStream.tsx",
) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("require", "exports", js)((id) => {
    if (id in overrides) return overrides[id]();
    if (id.endsWith(".css")) return {};
    if (!id.startsWith(".")) return require(id);
    let next = path.resolve(path.dirname(file), id);
    if (!path.extname(next)) next += existsSync(next + ".ts") ? ".ts" : ".tsx";
    return loadComponent(overrides, cache, next);
  }, exports);
  return exports;
}
const { EventStream } = loadComponent();
const fixture = () => ({
  webcasts: parsed(rawYouTube, rawTwitch),
  fetchedAt: 1_800_000_000_000,
  error: null,
  stale: false,
  online: true,
  eventKey: "2026test",
});
const render = (props) =>
  renderToStaticMarkup(React.createElement(EventStream, props));

test("SSR never loads third-party players and honestly labels unknown presence", () => {
  const html = render(fixture());
  assert.ok(!html.includes("<iframe"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("preconnect"));
  for (const text of [
    "Open stream",
    "does not confirm it is live",
    "Live status unknown",
    "TBA listing checked",
    "Choose stream",
    "Watch on YouTube",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes(`href="https://www.youtube.com/watch?v=${video}"`));
  const injected = render({
    ...fixture(),
    webcasts: [
      {
        ...parsed(rawYouTube)[0],
        title: "<script>alert(1)</script>",
        id: "evil",
        externalUrl: "javascript:alert(1)",
      },
    ],
  });
  assert.ok(injected.includes("&lt;script&gt;"));
  assert.ok(!injected.includes("<script"));
  assert.ok(!injected.includes("javascript:"));
});

test("SSR keeps absent, stale, offline and unsupported listings explicit", () => {
  assert.ok(
    render({
      ...fixture(),
      webcasts: Array.from({ length: 101 }, () => parsed(rawYouTube)[0]),
    }).includes("Stream listing unavailable"),
  );
  assert.ok(
    render({ ...fixture(), webcasts: [] }).includes(
      "No supported YouTube or Twitch",
    ),
  );
  assert.ok(
    render({ ...fixture(), eventKey: null }).includes(
      "Connect this event to TBA",
    ),
  );
  assert.ok(
    render({ ...fixture(), error: "upstream failure", webcasts: [] }).includes(
      "Stream listing unavailable",
    ),
  );
  assert.ok(
    render({ ...fixture(), stale: true }).includes(
      "Stream listing may be stale",
    ),
  );
  assert.ok(
    render({ ...fixture(), online: false }).includes("Offline · player closed"),
  );
  assert.ok(
    render({
      ...fixture(),
      webcasts: parsed({ ...rawYouTube, status: "offline" }),
    }).includes("This stream is listed offline"),
  );
  assert.ok(
    render({
      ...fixture(),
      webcasts: parsed({ ...rawYouTube, status: "online" }),
      stale: true,
    }).includes("Last listed online by TBA"),
  );
  assert.ok(
    render({ ...fixture(), fetchedAt: NaN }).includes(
      "listing has not been loaded",
    ),
  );
});

function nodes(element, type) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element))
    return element.flatMap((child) => nodes(child, type));
  return [
    ...(element.type === type ? [element] : []),
    ...nodes(element.props?.children, type),
  ];
}

// Execute real component hooks and handlers with deterministic state/effects.
// This tests mount eligibility/lifecycle, not browser playback or layout.
function harness(initial = {}) {
  const originals = new Map(
    ["window", "ResizeObserver"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  let props = { ...fixture(), ...initial },
    cursor = 0,
    dirty = false,
    result;
  let width = 800,
    disconnected = false;
  const slots = [],
    effects = [],
    memos = [],
    listeners = new Map();
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          const next = typeof value === "function" ? value(slots[i]) : value;
          if (!Object.is(next, slots[i])) {
            slots[i] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      return (slots[cursor++] ??= { current: initial });
    },
    useId() {
      return (slots[cursor++] ??= "stream-picker");
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!memos[i] || !same(memos[i].deps, deps))
        memos[i] = { value: fn(), deps };
      return memos[i].value;
    },
    useEffect(setup, deps) {
      const i = cursor++,
        old = effects[i];
      if (!old || !same(old.deps, deps))
        effects[i] = { setup, deps, cleanup: old?.cleanup, pending: true };
    },
  };
  globalThis.window = {
    location: { hostname: "pit.example.com", protocol: "https:" },
    innerWidth: 1024,
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  globalThis.ResizeObserver = class {
    constructor(handler) {
      this.handler = handler;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  const { EventStream: Component } = loadComponent({ react: () => react });
  const draw = () => {
    cursor = 0;
    dirty = false;
    result = Component(props);
    for (const node of nodes(result, "div"))
      if (node.props.ref)
        node.props.ref.current = { getBoundingClientRect: () => ({ width }) };
    return result;
  };
  const settle = () => {
    for (let n = 0; n < 10; n++) {
      for (const effect of effects.filter((e) => e?.pending)) {
        effect.pending = false;
        effect.cleanup?.();
        effect.cleanup = effect.setup();
      }
      if (!dirty) return result;
      draw();
    }
    throw new Error("Stream component did not settle");
  };
  draw();
  settle();
  return {
    get iframe() {
      return nodes(result, "iframe")[0];
    },
    button(label) {
      return nodes(result, "button").find(
        (node) => node.props.children === label,
      );
    },
    click(label) {
      const node = this.button(label);
      assert.ok(node, label);
      assert.ok(!node.props.disabled, label);
      node.props.onClick();
      draw();
      return settle();
    },
    select(id) {
      nodes(result, "select")[0].props.onChange({ target: { value: id } });
      draw();
      return settle();
    },
    update(patch, flush = true) {
      props = { ...props, ...patch };
      draw();
      if (flush) settle();
    },
    settle,
    resize(next) {
      width = next;
      window.innerWidth = next;
      listeners.get("resize")();
      draw();
      settle();
    },
    dispose() {
      for (const effect of effects) effect?.cleanup?.();
      assert.equal(listeners.size, 0);
      assert.equal(disconnected, true);
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("player requires explicit open, closes repeatedly and retains a stable src across feed ticks", () => {
  const h = harness();
  try {
    assert.equal(h.iframe, undefined);
    h.click("Open stream");
    const src = h.iframe.props.src,
      key = h.iframe.key;
    assert.match(src, /^https:\/\/www.youtube-nocookie.com\/embed\//);
    assert.equal(h.iframe.props.allow, "encrypted-media");
    assert.equal(h.iframe.props.allowFullScreen, undefined);
    assert.equal(
      h.iframe.props.referrerPolicy,
      "strict-origin-when-cross-origin",
    );
    h.update({
      fetchedAt: 1_800_000_030_000,
      webcasts: parsed(rawYouTube, rawTwitch),
    });
    assert.equal(h.iframe.props.src, src);
    assert.equal(h.iframe.key, key);
    h.update({ stale: true, error: "temporary outage" });
    assert.equal(h.iframe.props.src, src);
    h.click("Close stream");
    assert.equal(h.iframe, undefined);
    h.click("Open stream");
    assert.equal(h.iframe.props.src, src);
    h.click("Close stream");
    assert.equal(h.iframe, undefined);
  } finally {
    h.dispose();
  }
});

test("selection changes unmount before another provider can load", () => {
  const h = harness();
  try {
    h.click("Open stream");
    h.select("twitch:firstupdates_1");
    assert.equal(h.iframe, undefined);
    h.click("Open stream");
    const url = new URL(h.iframe.props.src);
    assert.equal(url.hostname, "player.twitch.tv");
    assert.equal(url.searchParams.get("parent"), "pit.example.com");
    h.select(`youtube:${video}`);
    assert.equal(h.iframe, undefined);
  } finally {
    h.dispose();
  }
});

test("network/provider offline transitions remove the iframe immediately and never auto-reopen", () => {
  const h = harness();
  try {
    h.click("Open stream");
    h.update({ online: false }, false);
    assert.equal(h.iframe, undefined);
    h.settle();
    h.update({ online: true });
    assert.equal(h.iframe, undefined);
    h.click("Open stream");
    h.update({ webcasts: parsed({ ...rawYouTube, status: "offline" }) }, false);
    assert.equal(h.iframe, undefined);
    h.settle();
    h.update({ webcasts: parsed({ ...rawYouTube, status: "online" }) });
    assert.equal(h.iframe, undefined);
  } finally {
    h.dispose();
  }
});

test("event-scope and removed-stream transitions require fresh opt-in, including returning to the old event", () => {
  const h = harness();
  try {
    h.click("Open stream");
    h.update({ eventKey: "2026different" }, false);
    assert.equal(h.iframe, undefined);
    h.settle();
    h.update({ eventKey: "2026test" });
    assert.equal(h.iframe, undefined);
    h.click("Open stream");
    h.update({ webcasts: [] }, false);
    assert.equal(h.iframe, undefined);
    h.settle();
    h.update({ webcasts: parsed(rawYouTube) });
    assert.equal(h.iframe, undefined);
    h.click("Open stream");
    h.update({ eventKey: null });
    assert.equal(h.iframe, undefined);
  } finally {
    h.dispose();
  }
});

test("Twitch stays external-only below actual 400px player width and shrinking unloads it", () => {
  const h = harness({ webcasts: parsed(rawTwitch) });
  try {
    h.resize(399);
    assert.equal(h.button("Open stream").props.disabled, true);
    assert.equal(h.iframe, undefined);
    h.resize(400);
    h.click("Open stream");
    assert.ok(h.iframe);
    h.resize(360);
    assert.equal(h.iframe, undefined);
    h.resize(800);
    assert.equal(h.iframe, undefined);
    h.click("Open stream");
    assert.ok(h.iframe);
  } finally {
    h.dispose();
  }
  const css = readFileSync(
    path.join(root, "src/competition/event-stream.css"),
    "utf8",
  );
  assert.match(css, /\.comp-stream-twitch\s*\{\s*min-height:\s*300px/);
});
