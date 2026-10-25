// browser.mjs — run the page's own script and report what it DREW.
//
// Not a test file (no `.test.mjs`), so the runner does not pick it up; it is the harness the
// geometry tests in `view.test.mjs` stand on.
//
// It exists because every lint-style assertion in that file passed while the picture was
// unreadable. Those check that a decision is still written in the source. They cannot see the one
// thing a reader sees: 43 chips on one line at 1900px is 44px each against the 86-210px a filename
// needs, so every one clipped its neighbour into a sliver. The bug was not in any string — it was
// in the geometry, and only running the layout finds it.
//
// `node:vm` and a hand-written stub, because ADR 0004 rules out a runtime dependency and that
// applies to the tests too. The stub is deliberately thin: the script only asks the canvas for
// `measureText`, and a fixed advance per character is enough to reproduce chip widths consistently.
import vm from "node:vm";

import { renderHtml } from "../lib/view-html.mjs";

const ADVANCE = 7.8; // 13px in a monospace face; the real value differs per platform and per
// font, which is exactly why the layout must not depend on it being right — only on it being the
// same number the script measured with.

export function runPage(view, { width = 1900, height = 1000, hover = null } = {}) {
  const html = renderHtml(view);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();

  // What a draw costs is counted in canvas calls, not in milliseconds a stub cannot measure.
  const calls = { stroke: 0, fill: 0, fillText: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "measureText") return (s) => ({ width: String(s).length * ADVANCE });
        if (k in calls) return () => { calls[k] += 1; };
        return () => {};
      },
      set: () => true,
    },
  );
  // An element remembers what it was given (markup, attributes, listeners), so a test can read the
  // legend the page wrote, the label on the canvas, or press a key on it.
  const els = new Map();
  const el = (id) => {
    if (id !== undefined && els.has(id)) return els.get(id);
    const e = new Proxy(
      {
        listeners: {},
        attrs: {},
        innerHTML: "",
        getContext: () => ctx,
        getBoundingClientRect: () => ({ width, height: height - 56, left: 0, top: 56 }),
        addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
        querySelectorAll: () => [],
        classList: { toggle() {}, add() {}, remove() {} },
        dataset: {},
        style: {},
        appendChild() {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] ?? null; },
        focus() {},
        blur() {},
      },
      { get: (t, k) => (k in t ? t[k] : undefined), set: (t, k, v) => { t[k] = v; return true; } },
    );
    if (id !== undefined) els.set(id, e);
    return e;
  };

  const sandbox = {
    DATA: JSON.parse(JSON.stringify(view)),
    document: { getElementById: el, querySelectorAll: () => [], createElement: () => el(), activeElement: null },
    window: { devicePixelRatio: 2 },
    addEventListener() {},
    // Drawing is on demand and waits for a frame; there are none here, so a test calls draw() itself.
    requestAnimationFrame() {},
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ getPropertyValue: () => "#888888" }),
    innerWidth: width,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // Hovering is where new names appear, around a file and its neighbours, onto a picture laid out
  // without them. It is the case the collision rule exists for, so the harness can drive it.
  const setHover = hover ? `setHover(M.get(${JSON.stringify(hover)})||null);` : "";
  vm.runInContext(script + "\n" + setHover, sandbox);
  // The page's state is read fresh on every access, so a test that runs more of the page (a click on
  // the legend, a switch of grouping) sees the layout that produced.
  const state = (k) => vm.runInContext(k, sandbox);
  const p = {
    calls,
    run: (code) => vm.runInContext(code, sandbox),
    html: (id) => (els.has(id) ? els.get(id).innerHTML : ""),
    attr: (id, k) => (els.has(id) ? els.get(id).attrs[k] ?? null : null),
    /** Deliver an event to the listeners the page put on one element. */
    fire(id, type, ev = {}) {
      for (const fn of els.get(id)?.listeners[type] ?? []) fn({ preventDefault() {}, ...ev });
    },
    get N() { return state("N"); },
    get E() { return state("E"); },
    get BY() { return state("BY"); },
    get W() { return state("W"); },
    get H() { return state("H"); },
    get P() { return state("P"); },
    get CELLS() { return state("CELLS"); },
    get LABELS() { return state("LABELS"); },
    get BUNDLES() { return state("BUNDLES"); },
    get BOX() { return state("BOX"); },
    get scale() { return state("scale"); },
    get tx() { return state("tx"); },
    get ty() { return state("ty"); },
    get NB() { return state("NB"); },
    get MARGIN() { return state("MARGIN"); },
    get LABEL_MAX() { return state("LABEL_MAX"); },
  };
  return Object.assign(p, {
    /** The graph's bounding box on screen, from the boxes the page drew. */
    bounds() {
      const c = p.CELLS;
      const x0 = Math.min(...c.map((r) => r.x)), x1 = Math.max(...c.map((r) => r.x + r.w));
      const y0 = Math.min(...c.map((r) => r.y)), y1 = Math.max(...c.map((r) => r.y + r.h));
      return { x0: x0 * p.scale + p.tx, x1: x1 * p.scale + p.tx, y0: y0 * p.scale + p.ty, y1: y1 * p.scale + p.ty };
    },
    /** Every word the page placed that covers a dot, or another word. The post-condition. */
    collisions() {
      const hits = [];
      const L = p.LABELS, inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (let i = 0; i < L.length; i++) {
        for (let j = i + 1; j < L.length; j++) if (inter(L[i], L[j])) hits.push(`${L[i].text} / ${L[j].text}`);
        for (const n of p.N) {
          if (!n.g) continue;
          if (inter(L[i], { x: n.x - n.r, y: n.y - n.r, w: 2 * n.r, h: 2 * n.r })) hits.push(`${L[i].text} on ${n.id}`);
        }
      }
      return hits;
    },
  });
}

// ── the Overview script ──────────────────────────────────────────────────────────────────────────
// The Overview and Structure tabs are a separate <script id="ov-js">, so runPage above never sees
// them. This runs that one against a stub that remembers what each element was given as innerHTML,
// which is what the not-available states are asserted on, and counts what the cloud draws per frame.
export function runOverview(view, { width = 1600, height = 1000 } = {}) {
  const html = renderHtml(view);
  const m = /<script id="ov-js">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no overview script on the page");
  const calls = { drawImage: 0, lineTo: 0, stroke: 0 };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "createRadialGradient") return () => gradient;
        if (k in calls) return () => { calls[k] += 1; };
        return () => {};
      },
      set: () => true,
    },
  );
  const els = new Map();
  const el = (id) => {
    if (els.has(id)) return els.get(id);
    const e = {
      id, innerHTML: "", textContent: "", style: {}, attrs: {},
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width, height, left: 0, top: 0, right: width, bottom: height }),
      addEventListener() {},
      querySelectorAll: () => [],
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      classList: { toggle() {}, add() {}, remove() {} },
    };
    els.set(id, e);
    return e;
  };
  const sandbox = {
    DATA: JSON.parse(JSON.stringify(view)),
    document: {
      getElementById: el, createElement: () => el(Symbol("created")), documentElement: el("html"),
      addEventListener() {}, hidden: false,
    },
    devicePixelRatio: 1,
    addEventListener() {},
    requestAnimationFrame() {},
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "255,150,50" }),
    innerWidth: width,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox);
  return { OV: sandbox.OV, calls, html: (id) => (els.has(id) ? els.get(id).innerHTML : "") };
}
