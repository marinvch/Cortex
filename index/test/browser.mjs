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

export function runPage(view, { width = 1900, height = 1000, reducedMotion = true, hover = null } = {}) {
  const html = renderHtml(view);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();

  const ctx = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "measureText") return (s) => ({ width: String(s).length * ADVANCE });
        return () => {};
      },
      set: () => true,
    },
  );
  const el = () =>
    new Proxy(
      {
        getContext: () => ctx,
        getBoundingClientRect: () => ({ width, height: height - 56, left: 0, top: 56 }),
        addEventListener() {},
        querySelectorAll: () => [],
        classList: { toggle() {}, add() {}, remove() {} },
        dataset: {},
        style: {},
        appendChild() {},
        setAttribute() {},
        getAttribute: () => null,
        focus() {},
        blur() {},
      },
      { get: (t, k) => (k in t ? t[k] : undefined), set: () => true },
    );

  const sandbox = {
    DATA: JSON.parse(JSON.stringify(view)),
    document: { getElementById: el, querySelectorAll: () => [], createElement: el, activeElement: null },
    window: { devicePixelRatio: 2 },
    addEventListener() {},
    requestAnimationFrame() {},
    // Reduced motion runs the identical cooling schedule synchronously, which is what makes the
    // settled layout observable at all from here — there are no frames to wait for.
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: () => ({ getPropertyValue: () => "#888888" }),
    innerWidth: width,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // Hovering is where new chips appear — a node and every neighbour of it get promoted at once,
  // onto positions that only ever reserved room for a dot. It is the case the overlap rule exists
  // for, so the harness can drive it.
  const setHover = hover ? `setHover(M.get(${JSON.stringify(hover)})||null);` : "";
  vm.runInContext(
    script + "\n" + setHover +
      "\nglobalThis.__p={N,E,ROWS,RLBL,BTOP,BH,BW,CX,HUB,HUB_MAX,CHIPS,LOOSE,TRAY_Y,TRAY_COLS," +
      "scale,tx,ty,bandL:bandL(),bandR:bandR()};",
    sandbox,
  );

  const p = sandbox.__p;
  const chips = p.N.filter((n) => p.CHIPS.has(n.id));
  return {
    ...p,
    chips,
    dots: p.N.filter((n) => !p.CHIPS.has(n.id)),
    // Every pair of drawn chip rectangles that share any area. The post-condition, in one number.
    overlaps() {
      const hits = [];
      for (let i = 0; i < chips.length; i++) {
        for (let j = i + 1; j < chips.length; j++) {
          const a = chips[i], b = chips[j];
          if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) {
            hits.push(`${a.label} / ${b.label}`);
          }
        }
      }
      return hits;
    },
  };
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
