// view-html.mjs — the self-contained page. One file, no server, no CDN, no runtime.
//
// Kept apart from view.mjs so the data shape stays testable without asserting against markup.
// The template is a string rather than a bundled asset for the same reason everything else here is
// plain: ADR 0004 rules out runtime dependencies, and a build step for one HTML file is not a
// trade worth making. That rules out web fonts too — every face below is a system stack, so the
// page looks the same offline as on, and a font that is missing falls back instead of blocking.
//
// It follows the viewer's system theme, and a button overrides it. A page that ignores the OS and
// forces dark reads as a tool from a decade ago, and this one is opened next to an editor that
// already made the choice; the override is for the reader whose eyes disagree with their OS.
//
// Legibility is a requirement here, not a finish: every text colour clears 7:1 against every ground
// it can sit on, in both themes, and nothing is set under 13px. `THEMES` and `CONTRAST` are
// exported so view.test.mjs computes those ratios from the same values the page is built from —
// a palette tuned by eye drifts the first time someone "just softens" a grey.

/** The two palettes. Same names in both, or a canvas token renders as an empty string. */
export const THEMES = {
  light: {
    bg: "#f2f3f5", surface: "#ffffff", "surface-2": "#eceef1", raised: "#fbfbfc",
    ink: "#1b140d", "ink-2": "#3a2e22", "ink-3": "#4a3b2c", label: "#6b3300",
    acc: "#733700", "acc-soft": "rgba(115,55,0,.09)", "on-acc": "#ffffff",
    ok: "#054d2c", bad: "#861726", warn: "#5c3d00", focus: "#733700",
    line: "rgba(60,40,20,.26)", "line-2": "rgba(60,40,20,.13)",
    shadow: "0 1px 2px rgba(60,40,20,.08),0 10px 28px -14px rgba(60,40,20,.25)",
    edge: "120,90,60", band: "rgba(60,40,20,.045)", cvshadow: "rgba(60,40,20,.16)",
    // The cloud. On a light ground additive light washes out to nothing, so it is drawn as ink:
    // deep amber particles, normal blending, a dark core where the dark theme has a hot one.
    glow: "184,92,0", "glow-hot": "110,46,0", link: "rgba(140,80,20,.16)", blend: "source-over",
    // Structure kinds: a border colour and a tint to fill with. Text on a tint is always ink.
    "c-ctx": "#a35300", "c-code": "#2a62c4", "c-test": "#0b7a47", "c-gen": "#6c43c9",
    "t-ctx": "#fbead6", "t-code": "#e4ecfa", "t-test": "#dff3e7", "t-gen": "#eee7fb",
  },
  dark: {
    // Warm umber, not near-black: the surfaces have to be layerable, and the amber of the graph
    // needs a ground it belongs to. Nothing here is dimmed to look moody — the inks are near white.
    bg: "#17110b", surface: "#1f1710", "surface-2": "#2a2016", raised: "#271d14",
    ink: "#fbf3e8", "ink-2": "#eadbc6", "ink-3": "#d4bd9e", label: "#ffc98a",
    acc: "#ffb05a", "acc-soft": "rgba(255,176,90,.14)", "on-acc": "#1a0f04",
    ok: "#7ee2a8", bad: "#ffaba1", warn: "#ffd479", focus: "#ffd9a8",
    line: "rgba(255,196,130,.26)", "line-2": "rgba(255,196,130,.13)",
    shadow: "0 1px 2px rgba(0,0,0,.5),0 14px 36px -18px rgba(0,0,0,.8)",
    edge: "255,190,120", band: "rgba(255,196,130,.05)", cvshadow: "rgba(0,0,0,.5)",
    glow: "255,150,50", "glow-hot": "255,232,196", link: "rgba(255,160,80,.085)", blend: "lighter",
    "c-ctx": "#ffb05a", "c-code": "#7fb2ff", "c-test": "#7ee2a8", "c-gen": "#c7a6ff",
    "t-ctx": "#3a2710", "t-code": "#1b2a3f", "t-test": "#15311f", "t-gen": "#2d2140",
  },
};

/**
 * What must clear 7:1, and against what. Every text token on every ground; ink and ink-2 on the
 * structure tints (nothing else is ever written on one); and the fills that carry their own text.
 * A translucent ground is measured composited over the surface it is drawn on.
 */
export const CONTRAST = {
  min: 7,
  text: ["ink", "ink-2", "ink-3", "label", "acc", "ok", "bad", "warn"],
  grounds: ["bg", "surface", "surface-2", "raised", ["acc-soft", "surface"], ["acc-soft", "bg"]],
  tints: { text: ["ink", "ink-2"], grounds: ["t-ctx", "t-code", "t-test", "t-gen"] },
  pairs: [["on-acc", "acc"], ["on-acc", "ok"]],
};

const DISPLAY = `Bahnschrift,"DIN Alternate","Barlow Condensed","Roboto Condensed","Arial Narrow",system-ui,sans-serif`;
const UI = `system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif`;
const MONO = `"Cascadia Mono",ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace`;
const tokens = (t) => Object.entries(t).map(([k, v]) => `--${k}:${v};`).join("");

// Three blocks and one set of values. The OS preference picks a palette unless the reader has
// chosen one, and a choice wins in both directions — `data-theme=light` has to beat a dark OS as
// surely as `data-theme=dark` beats a light one, or the button only works half the time.
const CSS = `
:root{color-scheme:light;${tokens(THEMES.light)}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;${tokens(THEMES.dark)}}}
:root[data-theme=dark]{color-scheme:dark;${tokens(THEMES.dark)}}
*{box-sizing:border-box}
/* The cooling animation settles instantly under this too — see REDUCED in both scripts. */
@media (prefers-reduced-motion:reduce){*{transition-duration:0s!important;animation-duration:0s!important}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);
  font:15px/1.55 ${UI};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{overflow:hidden}
code,.mono{font-family:${MONO};font-size:13.5px}
button{font:inherit;color:inherit}
/* Focus is drawn, always, in a colour chosen to be seen — never left to a browser default that is
   a 1px dotted line on some platforms and nothing at all on others. */
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ── top bar ─────────────────────────────────────────────────────────── */
#top{display:flex;align-items:center;gap:18px;padding:0 20px;height:60px;
  border-bottom:1px solid var(--line);background:var(--bg);position:relative;z-index:20}
#brand{display:flex;align-items:baseline;gap:10px;white-space:nowrap}
#brand b{font:600 22px/1 ${DISPLAY};letter-spacing:.24em;color:var(--ink)}
#brand span{font-size:15px;color:var(--ink-2)}
#tabs{display:flex;gap:2px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}
.tab{appearance:none;border:0;background:transparent;padding:8px 12px;border-radius:8px;cursor:pointer;
  color:var(--ink-2);font-size:14px;font-weight:550;white-space:nowrap;transition:color .12s,background .12s}
.tab:hover{color:var(--ink);background:var(--surface-2)}
.tab.on{color:var(--ink);background:var(--surface-2);box-shadow:inset 0 -3px 0 var(--acc)}
#q{margin-left:auto;width:240px;min-width:140px;padding:8px 12px 8px 34px;border-radius:9px;border:1px solid var(--line);
  background:var(--surface) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a0784a' stroke-width='2.2' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><path d='M20 20l-3.5-3.5'/></svg>") no-repeat 10px 50%/15px;
  color:var(--ink);font-size:14px;transition:border-color .12s,box-shadow .12s}
#q:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
#q::placeholder{color:var(--ink-3)}
#theme{appearance:none;border:1px solid var(--line);background:var(--surface);border-radius:9px;
  padding:7px 12px;font-size:14px;cursor:pointer;white-space:nowrap}
#theme:hover{border-color:var(--acc)}

/* ── layout ──────────────────────────────────────────────────────────── */
#main{height:calc(100vh - 60px)}
.view{display:none;height:100%;position:relative}
.view.on{display:flex}
.pane{flex:1;overflow-y:auto;padding:30px 34px 60px;scrollbar-width:thin}
.wrap{max-width:900px}

/* The canvas takes its layout size from CSS, never from its width/height attributes — sizing the
   attribute off getBoundingClientRect while the attribute also drives layout is a feedback loop,
   and the page grows a horizontal scrollbar a pixel at a time. */
#cv{flex:1;display:block;cursor:grab;width:100%;height:100%;min-width:0}
#cv:active{cursor:grabbing}

/* ── overview ────────────────────────────────────────────────────────── */
#v-ov.on{display:grid;grid-template-columns:minmax(290px,340px) minmax(0,1fr) minmax(300px,370px);
  grid-template-rows:auto minmax(0,1fr)}
#ovbar{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:10px 24px;
  border-bottom:1px solid var(--line-2)}
.st{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;border:1px solid var(--line);border-radius:99px;
  font-size:13.5px;color:var(--ink);background:var(--surface);white-space:nowrap}
.st::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--ink-3);flex:0 0 9px}
.st.ok::before{background:var(--ok)}.st.warn::before{background:var(--warn)}.st.bad::before{background:var(--bad)}
#ovbar .when{margin-left:auto;font-size:14px;color:var(--ink-2);white-space:nowrap}
#ovbar .when b{color:var(--ink);font-family:${MONO};font-weight:500;font-size:13.5px}
.col{overflow-y:auto;padding:22px 24px 40px;scrollbar-width:thin;scrollbar-color:var(--line) transparent;min-height:0}
#ovl{border-right:1px solid var(--line-2)}#ovr{border-left:1px solid var(--line-2)}
.sh{display:flex;align-items:center;gap:10px;margin:0 0 14px;font:600 14px/1.2 ${DISPLAY};
  letter-spacing:.16em;text-transform:uppercase;color:var(--label)}
.sh small{font:500 13px ${UI};letter-spacing:.02em;text-transform:none;color:var(--ink-2)}
.sh::after{content:"";flex:1;height:1px;background:var(--line)}
.sh.gap{margin-top:30px}
.vt{padding:0 0 15px;margin:0 0 15px;border-bottom:1px solid var(--line-2)}
.vk{display:flex;align-items:baseline;gap:8px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-2);font-weight:600}
.vk .aside{margin-left:auto;letter-spacing:.02em;text-transform:none;font-weight:500;text-align:right}
.vv{font:600 40px/1.1 ${DISPLAY};letter-spacing:.01em;color:var(--ink);font-variant-numeric:tabular-nums;margin-top:4px}
.vv small{font-size:18px;color:var(--ink-2);margin-left:8px;letter-spacing:.04em}
.bar{height:8px;border-radius:99px;background:var(--surface-2);margin-top:9px;overflow:hidden;border:1px solid var(--line-2)}
.bar i{display:block;height:100%;background:var(--acc)}
.spark{display:block;width:100%;height:44px;margin-top:8px;color:var(--acc);overflow:visible}
.spark .fill{fill:var(--acc-soft);stroke:none}
.spark-x{display:flex;justify-content:space-between;font-size:13px;color:var(--ink-2);margin-top:3px}
.sev{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.sev span{padding:3px 10px;border-radius:7px;border:1px solid var(--line);font-size:13.5px;color:var(--ink)}
.sev b{font-variant-numeric:tabular-nums;margin-right:4px}
.sev .critical b,.sev .high b{color:var(--bad)}.sev .medium b{color:var(--warn)}
.chk{list-style:none;margin:0;padding:0}
.chk li{display:flex;gap:12px;padding:8px 0;font-size:14.5px;color:var(--ink);line-height:1.45}
.chk .box{flex:0 0 16px;height:16px;margin-top:3px;border:2px solid var(--ink-2);border-radius:3px}
.chk .sv{display:block;font-size:13px;color:var(--ink-2);text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.chk .sv.medium{color:var(--warn)}.chk .sv.high,.chk .sv.critical{color:var(--bad)}
.na{color:var(--ink-2);font-size:14px;margin:6px 0;padding-left:10px;border-left:3px solid var(--warn);line-height:1.5}
#ovc{position:relative;min-width:0;min-height:0;overflow:hidden}
#ov{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
#ov:active{cursor:grabbing}
#ovcap{position:absolute;left:24px;top:18px;right:24px;max-width:560px;font-size:14px;line-height:1.5;
  color:var(--ink-2);pointer-events:none;text-shadow:0 0 8px var(--bg),0 0 3px var(--bg),0 0 1px var(--bg)}
#ovcap b{color:var(--ink)}
#hero{position:absolute;left:0;right:0;bottom:0;padding:64px 20px 22px;text-align:center;pointer-events:none;
  background:linear-gradient(to top,var(--bg) 0,var(--bg) 60%,transparent)}
#hero .lbl{font:600 15px ${DISPLAY};letter-spacing:.3em;text-transform:uppercase;color:var(--label)}
#hero .big{font:600 84px/1 ${DISPLAY};color:var(--ink);font-variant-numeric:tabular-nums;margin:6px 0 10px}
#hero .rule{width:min(520px,70%);height:2px;margin:0 auto 12px;background:linear-gradient(90deg,transparent,var(--acc),transparent)}
#hero .strip{display:flex;justify-content:center;flex-wrap:wrap;gap:6px 26px;font-size:14px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-2)}
#hero .strip b{color:var(--ink);letter-spacing:.02em;margin-right:6px}
.here{border:1px solid var(--acc);background:var(--acc-soft);border-radius:12px;padding:14px 16px;margin-bottom:14px}
.here .k{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--label);font-weight:600}
.here .t{font-size:16px;font-weight:600;color:var(--ink);margin:3px 0 4px}
.here .w{font-size:14px;color:var(--ink-2);line-height:1.5;margin-bottom:10px}
.deck{display:flex;flex-wrap:wrap;gap:6px 8px}
.deck-h{font-size:13px;color:var(--ink-2);margin:16px 0 8px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
.cmd{appearance:none;display:flex;align-items:center;gap:9px;width:auto;max-width:100%;text-align:left;border:1px solid var(--line);
  background:var(--surface);border-radius:8px;padding:7px 10px;cursor:pointer;font:500 13.5px ${MONO};color:var(--ink)}
.cmd::before{content:"";flex:0 0 7px;height:7px;border-radius:50%;background:var(--acc)}
.cmd .c{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmd:hover{border-color:var(--acc)}
.cmd.copied{border-color:var(--ok)}.cmd.copied::before{background:var(--ok)}
.here .cmd{display:inline-flex;width:auto;max-width:100%}
.tl{list-style:none;margin:0;padding:0}
.tl li{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px;padding:9px 0;border-bottom:1px solid var(--line-2);
  font-size:14px;line-height:1.45}
.tl .when{font:500 13px/1.45 ${MONO};color:var(--label);font-variant-numeric:tabular-nums}
.tl .when small{display:block;font-size:13px;color:var(--ink-2)}
.tl .tag{display:block;font:500 13px/1.45 ${MONO};color:var(--ink-2)}
.tl li.memory .tag{color:var(--acc)}
.tl .tt{color:var(--ink);overflow-wrap:anywhere}
.hint2{font-size:14px;color:var(--ink-2);margin:12px 0 0;line-height:1.5}

/* ── structure ───────────────────────────────────────────────────────── */
.skey{display:flex;flex-wrap:wrap;gap:10px 22px;margin:0 0 26px;font-size:14px;color:var(--ink)}
.skey span{display:inline-flex;align-items:center;gap:8px}
.skey i{width:18px;height:18px;border-radius:5px;border:2px solid var(--c);background:var(--t);display:inline-block}
.skey .dash i{border-style:dashed;background:transparent;border-color:var(--ink-2)}
#stree{position:relative;min-width:960px;padding-bottom:20px}
#swires{position:absolute;left:0;top:0;pointer-events:none;color:var(--ink-3);overflow:visible}
.srow{display:flex;justify-content:center;margin-bottom:58px}
.scols{display:grid;grid-template-columns:230px minmax(0,1fr) 230px;gap:44px;align-items:start}
.scol{display:flex;flex-direction:column;gap:10px}
.sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:40px 16px;margin-top:48px}
.sarea{display:flex;flex-direction:column;gap:8px}
.sb{appearance:none;display:block;width:100%;text-align:left;border:2px solid var(--c);background:var(--t);border-radius:10px;
  padding:9px 13px;color:var(--ink);font:500 14.5px/1.35 ${MONO};position:relative;margin:0}
.sb small{display:block;font:500 13px/1.4 ${UI};color:var(--ink-2);margin-top:2px}
.sb .nm{overflow-wrap:anywhere}
button.sb{cursor:pointer}button.sb:hover{box-shadow:0 0 0 3px var(--acc-soft)}
.k-ctx{--c:var(--c-ctx);--t:var(--t-ctx)}.k-code{--c:var(--c-code);--t:var(--t-code)}
.k-test{--c:var(--c-test);--t:var(--t-test)}.k-gen{--c:var(--c-gen);--t:var(--t-gen)}
.sb.root{width:auto;min-width:320px;text-align:center;font-size:20px;font-weight:600;padding:14px 30px}
.sb.head{text-align:center;font:600 15px/1.3 ${DISPLAY};letter-spacing:.14em;text-transform:uppercase}
.sb.head small{letter-spacing:.02em;text-transform:none}
.sb.area{font-size:16px;font-weight:600;padding-left:24px}
.sb.area::before{content:"";position:absolute;left:9px;top:10px;bottom:10px;width:6px;border-radius:3px;background:var(--sw)}
.sb.leaf{border-width:1px;font-size:13.5px;padding:7px 11px}
.sb.missing{border-style:dashed;background:transparent}
.sother{margin-top:36px;font-size:14px;color:var(--ink-2)}
.sother .chip{cursor:default}

/* ── floating panels over the graph ──────────────────────────────────── */
.float{position:absolute;background:var(--surface);border:1px solid var(--line);
  border-radius:13px;box-shadow:var(--shadow)}
#legend{right:18px;bottom:18px;padding:12px 13px;font-size:13.5px;max-height:52vh;overflow:auto;z-index:6;min-width:190px}
#legend .lg{display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 6px;margin:0 -6px;border-radius:6px;
  color:var(--ink);transition:background .1s,color .1s;user-select:none}
#legend .lg:hover{background:var(--surface-2)}
/* A hidden area is struck through, not faded: fading text is how a label drops under 7:1. */
#legend .lg.off{text-decoration:line-through;color:var(--ink-2)}
#legend .lg.off .sw{background:transparent!important;outline:2px solid var(--ink-2);outline-offset:-2px}
#legend .lg .sw{width:11px;height:11px;border-radius:3px;flex:0 0 11px}
#legend .lg .ct{margin-left:auto;color:var(--ink-2);font-variant-numeric:tabular-nums;font-size:13px}
#legend .note{margin-top:9px;padding-top:9px;border-top:1px solid var(--line-2);color:var(--ink-2);
  font-size:13px;line-height:1.5;max-width:250px}
#hud{left:18px;top:18px;padding:9px 13px;font-size:13.5px;z-index:6;color:var(--ink-2);display:flex;gap:14px;align-items:center}
#hud b{color:var(--ink);font-variant-numeric:tabular-nums;font-weight:600}
#hud .sep{width:1px;height:14px;background:var(--line)}
#tip{position:fixed;pointer-events:none;background:var(--raised);border:1px solid var(--line);
  border-radius:11px;box-shadow:var(--shadow);padding:10px 12px;font-size:13.5px;max-width:340px;display:none;z-index:40}
#tip .t{font-weight:600;margin-bottom:3px;word-break:break-all;color:var(--ink)}
#tip .m{color:var(--ink-2);font-size:13px;line-height:1.55}
#tip .m b{color:var(--ink);font-weight:600}

/* ── file list + reader ──────────────────────────────────────────────── */
.list{width:320px;flex:0 0 320px;border-right:1px solid var(--line-2);overflow-y:auto;
  padding:12px 10px 40px;background:var(--surface);scrollbar-width:thin}
.list .sect{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--label);
  margin:16px 8px 5px;font-weight:600;display:flex}
.list .sect .n{margin-left:auto;font-weight:500;color:var(--ink-2)}
.row{padding:6px 9px;border-radius:8px;cursor:pointer;display:flex;gap:9px;align-items:center;
  font-size:14px;color:var(--ink);transition:background .1s}
.row:hover{background:var(--surface-2)}
.row.on{background:var(--acc-soft);font-weight:600;box-shadow:inset 3px 0 0 var(--acc)}
.row .sw{width:8px;height:8px;border-radius:2.5px;flex:0 0 8px}
.row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#reader{flex:1;overflow-y:auto;padding:34px 40px 70px;scrollbar-width:thin}
#reader .inner{max-width:760px}
#reader h1{font:600 28px/1.2 ${DISPLAY};margin:0 0 4px;letter-spacing:.01em;word-break:break-all}
#reader h2{font:600 14px ${DISPLAY};text-transform:uppercase;letter-spacing:.14em;color:var(--label);margin:30px 0 10px}
#reader .path{color:var(--ink-2);font-size:13.5px;margin-bottom:22px;word-break:break-all}
#empty{display:grid;place-items:center;height:100%;color:var(--ink-2);font-size:15px;text-align:center;padding:20px}

/* ── primitives ──────────────────────────────────────────────────────── */
.kpi{display:flex;flex-wrap:wrap;gap:9px;margin:0 0 6px}
.kpi .k{background:var(--surface);border:1px solid var(--line-2);border-radius:12px;padding:11px 15px;min-width:100px}
.kpi .k b{display:block;font:600 28px/1.15 ${DISPLAY};font-variant-numeric:tabular-nums}
.kpi .k span{font-size:13px;color:var(--ink-2);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.kpi .k.warn b{color:var(--warn)} .kpi .k.bad b{color:var(--bad)}
.chip{display:inline-flex;align-items:center;gap:5px;background:var(--surface-2);border:1px solid var(--line-2);
  border-radius:7px;padding:4px 9px;margin:0 5px 5px 0;font-size:13px;color:var(--ink);
  cursor:pointer;transition:border-color .1s,background .1s;max-width:100%}
.chip:hover{border-color:var(--acc)}
.chip.flat{cursor:default}.chip.flat:hover{border-color:var(--line-2)}
.chip.ok{color:var(--ok);border-color:currentColor}
.chip.bad{color:var(--bad);border-color:currentColor}
.chip .mono{font-size:13px}
.card{background:var(--surface);border:1px solid var(--line-2);border-radius:14px;padding:16px 18px;margin-bottom:10px;max-width:640px}
.card h3{margin:0 0 5px;font-size:15.5px;font-weight:600;display:flex;align-items:center;gap:8px}
.card h3 .sw{width:11px;height:11px;border-radius:3px}
.card .s{color:var(--ink-2);font-size:14px;font-variant-numeric:tabular-nums}
.card .p{color:var(--ink-2);font-size:14px;margin-top:2px}
.card .foot{margin-top:10px}
h2.vh{margin:34px 0 6px;font:600 15px ${DISPLAY};letter-spacing:.14em;text-transform:uppercase;color:var(--label)}
h2.vh:first-child{margin-top:0}
.hint{color:var(--ink-2);font-size:14px;margin:0 0 14px;max-width:680px;line-height:1.6}
code{background:var(--surface-2);border:1px solid var(--line-2);border-radius:6px;padding:2px 7px;color:var(--ink)}
table{border-collapse:separate;border-spacing:0;font-size:14px;width:100%;max-width:680px;
  border:1px solid var(--line-2);border-radius:12px;overflow:hidden;background:var(--surface)}
th{color:var(--ink-2);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.06em;
  text-align:left;padding:9px 14px;background:var(--surface-2);border-bottom:1px solid var(--line-2)}
td{padding:8px 14px;border-bottom:1px solid var(--line-2);vertical-align:middle}
tr:last-child td{border-bottom:0}
td.num{font-variant-numeric:tabular-nums;color:var(--ink-2);width:1%;white-space:nowrap}

/* ── the sequence ────────────────────────────────────────────────────── */
.prog{height:6px;border-radius:99px;background:var(--surface-2);overflow:hidden;max-width:680px;margin:14px 0 26px;border:1px solid var(--line-2)}
.prog i{display:block;height:100%;background:var(--acc);border-radius:99px}
.step{display:flex;gap:14px;padding:15px 18px;border:1px solid var(--line-2);border-radius:14px;
  margin-bottom:9px;background:var(--surface);max-width:720px;align-items:flex-start}
.step.next{border-color:var(--acc);background:var(--acc-soft);box-shadow:var(--shadow)}
.step.done{background:transparent;border-style:dashed}
.step .mk{flex:0 0 22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:13px;
  margin-top:1px;border:1px solid var(--line);color:var(--ink-2)}
.step.done .mk{background:var(--ok);border-color:transparent;color:var(--on-acc)}
.step.next .mk{background:var(--acc);border-color:transparent;color:var(--on-acc)}
.step .ti{font-weight:600;font-size:15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.step.done .ti{color:var(--ink-2);font-weight:500}
.step .wy{color:var(--ink-2);font-size:14px;margin-top:3px;line-height:1.55}
.step .cm{margin-top:9px;display:inline-block}
.badge{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);
  border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-weight:600}
.badge.hot{color:var(--acc);border-color:currentColor}

/* Narrow windows: the three overview columns stack, and the page scrolls instead of clipping. */
@media (max-width:1100px){
  #v-ov.on{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto 520px auto;overflow-y:auto}
  .col{overflow:visible}#ovl{border-right:0}#ovr{border-left:0}
  #top{gap:10px;padding:0 12px}#q{width:160px}
}
`;

// The Overview and the Structure tab. A script of its own, placed BEFORE the Map's: the test harness
// (index/test/browser.mjs) runs the last plain <script> on the page, and the Map's layout is what
// those tests measure. This one is wrapped in a closure so its names cannot collide with the Map's,
// and reaches the Map only through two globals, at event time: openFile() and the #tip element.
//
// The cloud is the import graph, not decoration. Every point is a code file and every faint line an
// import; a file sits nearer the core the more files import it, and each area leans toward its own
// direction so a package reads as a lobe. Placement is seeded from a hash of the sorted file ids,
// never Math.random, so the same index opens as the same cloud on every machine.
const OV_SCRIPT = `
(function(){
'use strict';
const D=DATA,O=D.overview,S=D.stats;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=n=>Number(n).toLocaleString('en-US');
// Missing data says so and says why. A zero drawn where a fact could not be read is a confident
// wrong number, and this page is read by people deciding what to do next.
const NA=why=>'<p class="na">not available — '+esc(why)+'</p>';
const NOSTATE='the page was rendered without the repo state (git, memory, profile)';
const REDUCED=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion:reduce)').matches;
const root=document.documentElement;
const css=v=>getComputedStyle(root).getPropertyValue(v).trim();
const go=p=>{if(typeof openFile==='function')openFile(p);};
const plural=(n,w)=>fmt(n)+' '+w+(n===1?'':'s');

// ---- status strip --------------------------------------------------------------------------
function status(){const bar=$('ovbar');
  if(!O){bar.innerHTML='<span class="st warn">Repo state not available</span><span class="when">'+esc(NOSTATE)+'</span>';return;}
  const st=(cls,t,title)=>'<span class="st'+(cls?' '+cls:'')+'"'+(title?' title="'+esc(title)+'"':'')+'>'+esc(t)+'</span>';
  const ix={fresh:['ok','Index fresh','the index matches the working tree'],
    stale:['warn','Index stale','files changed since it was built — node index/cortex-index.mjs . rebuilds it'],
    unknown:['','Index freshness unknown','freshness could not be checked']}[O.index]||['','Index freshness unknown',''];
  let h=st(ix[0],ix[1],ix[2]);
  const p=O.profile||{};
  h+=st(p.unavailable?'warn':'','Profile: '+(p.name||'unknown')+(p.source==='default'?' (default)':''),p.unavailable||'');
  const m=O.memory||{};
  h+=m.newest
    ?st(m.lagDays>7?'warn':'ok',m.lagDays===null?'Memory: last written '+m.newest
      :m.lagDays===0?'Memory: current with the code':'Memory: '+plural(m.lagDays,'day')+' behind the code',
      'newest entry '+m.newest+' · '+plural(m.days,'day')+' of entries')
    :st('','Memory: none written yet','/dream writes the first entry to .cortex/memory/');
  h+=st('',O.cortex?'Cortex v'+O.cortex:'Cortex version not available');
  h+='<span class="when">indexed <b>'+esc(O.commitDate||'date not available')+'</b>'
    +(O.commit?' · commit <b>'+esc(O.commit)+'</b>':' · no commit recorded')+'</span>';
  bar.innerHTML=h;}

// ---- left: vitals and findings -------------------------------------------------------------
function spark(days){const w=300,h=44,m=Math.max(1,...days),step=w/Math.max(1,days.length-1);
  const pts=days.map((d,i)=>(i*step).toFixed(1)+','+(h-3-(d/m)*(h-8)).toFixed(1));
  return '<svg class="spark" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="commits per day over '+days.length+' days, most '+m+'">'
    +'<polygon class="fill" points="0,'+h+' '+pts.join(' ')+' '+w+','+h+'"/>'
    +'<polyline points="'+pts.join(' ')+'" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';}
function vital(k,aside,body){return '<div class="vt"><div class="vk">'+esc(k)+(aside?'<span class="aside">'+aside+'</span>':'')+'</div>'+body+'</div>';}
function vitals(){let h='<h2 class="sh">Repo vitals</h2>';
  h+=vital('Files indexed',S.lines?plural(S.lines,'line'):'','<div class="vv">'+fmt(S.files)+'</div>');
  h+=vital('Import edges','between code files','<div class="vv">'+fmt(S.edges)+'</div>');
  if(S.tested===null||S.tested===undefined)h+=vital('Test coverage','',NA('the coverage pass could not run'));
  else if(!S.testable)h+=vital('Test coverage','',NA('there is no non-test code to cover'));
  else{const pct=Math.round(S.tested/S.testable*100);
    h+=vital('Test coverage',fmt(S.tested)+' of '+fmt(S.testable)+' code files',
      '<div class="vv">'+pct+'<small>%</small></div><div class="bar" role="img" aria-label="'+pct+' percent"><i style="width:'+pct+'%"></i></div>');}
  const c=O&&O.churn;
  if(!O)h+=vital('Commits · 30 days','',NA(NOSTATE));
  else if(c.unavailable)h+=vital('Commits · 30 days','',NA(c.unavailable));
  else h+=vital('Commits · 30 days','','<div class="vv">'+fmt(c.commits)+'</div>'+spark(c.days)
    +'<div class="spark-x"><span>'+esc(c.from)+'</span><span>'+esc(c.to)+'</span></div>');
  const f=O&&O.findings;
  if(!O)h+=vital('Findings','',NA(NOSTATE));
  else if(f.unavailable)h+=vital('Findings','',NA(f.unavailable));
  else h+=vital('Findings',plural(f.total,'finding'),'<div class="sev">'
    +['critical','high','medium','low'].map(s=>'<span class="'+s+'"><b>'+f.counts[s]+'</b>'+s+'</span>').join('')+'</div>');
  h+='<h2 class="sh gap">Top findings <small>by severity</small></h2>';
  if(!O)h+=NA(NOSTATE);
  else if(f.unavailable)h+=NA(f.unavailable);
  else if(!f.top.length)h+='<p class="hint2">Nothing ranked — the findings pass found no gaps.</p>';
  else h+='<ul class="chk">'+f.top.map(t=>'<li><span class="box" aria-hidden="true"></span><span><span class="sv '+esc(t.severity)+'">'+esc(t.severity)+' · '+esc(t.kind)+'</span>'+esc(t.title)+'</span></li>').join('')+'</ul>'
    +'<p class="hint2"><code>/cortex</code> reads the full report and walks you through it.</p>';
  $('ovl').innerHTML=h;}

// ---- right: next steps and timeline --------------------------------------------------------
const cmdBtn=(cmd,title)=>'<button type="button" class="cmd" data-copy="'+esc(cmd)+'" title="'+esc(title)+' — click to copy"><span class="c">'+esc(cmd)+'</span></button>';
function rightCol(){const n=D.next;let h='<h2 class="sh">Next steps'+(n?' <small>'+n.done+' of '+n.total+' done</small>':'')+'</h2>';
  if(!n)h+=NA('no install sequence was computed for this page');
  else{const cur=n.steps.find(s=>s.next);
    if(cur)h+='<div class="here"><div class="k">Run this next</div><div class="t">'+esc(cur.title)+'</div><div class="w">'+esc(cur.why)+'</div>'+cmdBtn(cur.cmd,cur.title)+'</div>';
    else h+='<p class="hint2">Every step in the sequence is done.</p>';
    const seen=new Set(cur?[cur.cmd]:[]),rest=[];
    for(const s of n.steps)if(!s.done&&!seen.has(s.cmd)){seen.add(s.cmd);rest.push(s);}
    if(rest.length)h+='<div class="deck-h">Then</div><div class="deck">'+rest.slice(0,8).map(s=>cmdBtn(s.cmd,s.title)).join('')+'</div>';
    if(n.perChange&&n.perChange.length)h+='<div class="deck-h">Per change</div><div class="deck">'
      +n.perChange.slice(0,6).map(r=>cmdBtn(r.cmd,r.when)).join('')+'</div>';}
  h+='<h2 class="sh gap">Timeline <small>memory and commits</small></h2>';
  if(!O)h+=NA(NOSTATE);
  else{if(!O.timeline.length)h+=NA(O.timelineNote||'no memory entries and no commits were found');
    else h+='<ol class="tl">'+O.timeline.map(e=>'<li class="'+esc(e.kind)+'"><span class="when">'+esc(e.date)
      +(e.time?'<small>'+esc(e.time)+'</small>':'')+'</span><span><span class="tag">'
      +(e.kind==='memory'?'memory · '+esc(e.tag):'commit '+esc(e.tag))+'</span><span class="tt">'+esc(e.title)+'</span></span></li>').join('')+'</ol>';
    if(O.timelineNote&&O.timeline.length)h+=NA(O.timelineNote);
    if(!O.memory||!O.memory.newest)h+='<p class="hint2">No team memory yet. <code>/dream</code> writes the first entry, and it lands here.</p>';}
  $('ovr').innerHTML=h;}

// Copy with a visible answer. The async clipboard needs a secure context, which a file:// page may
// or may not be depending on the browser, so the old selection path is the fallback — and when both
// fail the button says what to do instead of pretending.
function copy(text,btn){const label=btn.querySelector('.c'),was=label?label.textContent:'';
  const done=ok=>{if(label)label.textContent=ok?'Copied':'Select and press Ctrl+C';btn.classList.add('copied');
    const live=$('live');if(live)live.textContent=ok?'Copied '+text+' to the clipboard':'Copying failed';
    setTimeout(()=>{if(label)label.textContent=was;btn.classList.remove('copied');},1600);};
  const fallback=()=>{try{const t=document.createElement('textarea');t.value=text;t.setAttribute('readonly','');
      t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();
      const ok=document.execCommand('copy');t.remove();done(ok);}catch(e){done(false);}};
  try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(()=>done(true),fallback);return;}}catch(e){}
  fallback();}

// ---- centre: the cloud ---------------------------------------------------------------------
const cv=$('ov'),ctx=cv&&cv.getContext?cv.getContext('2d'):null,tip=$('tip');
const NODES=D.nodes.filter(x=>x.inMap),n=NODES.length;
const ID=new Map(NODES.map((x,i)=>[x.id,i]));
const L=[];for(const l of D.links){const a=ID.get(l.source),b=ID.get(l.target);if(a!==undefined&&b!==undefined)L.push(a,b);}
const ADJ=NODES.map(()=>[]);for(let k=0;k<L.length;k+=2){ADJ[L[k]].push(L[k+1]);ADJ[L[k+1]].push(L[k]);}
const IND=new Float32Array(n);for(let k=1;k<L.length;k+=2)IND[L[k]]+=1;
let maxI=1;for(let i=0;i<n;i++)if(IND[i]>maxI)maxI=IND[i];
const HS=new Float32Array(n);for(let i=0;i<n;i++)HS[i]=Math.sqrt(IND[i]/maxI);
// FNV-1a over the sorted ids seeds mulberry32. Same files, same cloud; one file added, a new cloud —
// which is honest, because it is a new graph.
let seed=2166136261>>>0;
for(const s of NODES.map(x=>x.id).sort()){for(let i=0;i<s.length;i++){seed^=s.charCodeAt(i);seed=Math.imul(seed,16777619)>>>0;}}
const rnd=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
const AREAS=[...new Set(NODES.map(x=>x.area))].sort(),AD=new Map();
AREAS.forEach((a,i)=>{const y=1-2*(i+.5)/AREAS.length,r=Math.sqrt(1-y*y),t=i*2.399963;AD.set(a,[Math.cos(t)*r,y,Math.sin(t)*r]);});
const X=new Float32Array(n),Y=new Float32Array(n),Z=new Float32Array(n);
for(let i=0;i<n;i++){const d=AD.get(NODES[i].area),u=rnd()*2-1,th=rnd()*6.2832,s=Math.sqrt(1-u*u);
  let dx=d[0]*.8+Math.cos(th)*s*.62,dy=d[1]*.8+u*.62,dz=d[2]*.8+Math.sin(th)*s*.62;const m=Math.hypot(dx,dy,dz)||1;
  // Hubs sink toward the core: the file most of the repo imports is the centre of gravity.
  const rad=(.24+.76*Math.pow(rnd(),.55))*(1-.62*HS[i]);X[i]=dx/m*rad;Y[i]=dy/m*rad;Z[i]=dz/m*rad;}
// Three passes toward the mean of each file's neighbours, so what imports what sits together.
for(let it=0;it<3;it++){const ax=new Float32Array(n),ay=new Float32Array(n),az=new Float32Array(n);
  for(let i=0;i<n;i++){const A=ADJ[i];if(!A.length)continue;for(const j of A){ax[i]+=X[j];ay[i]+=Y[j];az[i]+=Z[j];}
    ax[i]/=A.length;ay[i]/=A.length;az[i]/=A.length;}
  for(let i=0;i<n;i++)if(ADJ[i].length){X[i]+=(ax[i]-X[i])*.22;Y[i]+=(ay[i]-Y[i])*.22;Z[i]+=(az[i]-Z[i])*.22;}}
let ext=1e-6;for(let i=0;i<n;i++)ext=Math.max(ext,Math.hypot(X[i],Y[i],Z[i]));
for(let i=0;i<n;i++){X[i]/=ext;Y[i]/=ext;Z[i]/=ext;}
const PX=new Float32Array(n),PY=new Float32Array(n),PS=new Float32Array(n),PZ=new Float32Array(n);
let W=0,H=0,dpr=1,cx=0,cy=0,R=0,yaw=.6,pitch=-.3,hover=-1,NB=new Set(),drag=null,moved=false,run=false,visible=false,cur='ov';
let T={},sprite=null,ambient=null;
function makeSprite(){const c=document.createElement('canvas');c.width=64;c.height=64;const g=c.getContext&&c.getContext('2d');if(!g)return c;
  const gr=g.createRadialGradient(32,32,0,32,32,32);
  gr.addColorStop(0,'rgba('+T.hot+',1)');gr.addColorStop(.12,'rgba('+T.hot+',.9)');gr.addColorStop(.3,'rgba('+T.glow+',.5)');
  gr.addColorStop(.62,'rgba('+T.glow+',.1)');gr.addColorStop(1,'rgba('+T.glow+',0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return c;}
function retheme(){T={glow:css('--glow'),hot:css('--glow-hot'),link:css('--link'),blend:css('--blend'),ink:css('--ink')};
  sprite=makeSprite();ambient=null;paintToggle();if(visible&&!run)frame();}
function resize(){if(!ctx)return;const r=cv.getBoundingClientRect();if(!r.width||!r.height){W=0;return;}
  dpr=Math.min(window.devicePixelRatio||1,2);W=r.width;H=r.height;cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);
  cx=W/2;cy=H*.43;R=Math.max(60,Math.min(W*.44,H*.4));ambient=null;}
function project(){const cy_=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  for(let i=0;i<n;i++){const x=X[i]*cy_-Z[i]*sy,z1=X[i]*sy+Z[i]*cy_,y=Y[i]*cp-z1*sp,z=Y[i]*sp+z1*cp,f=2.6/(2.6+z);
    PX[i]=cx+x*R*f;PY[i]=cy+y*R*f;PS[i]=f;PZ[i]=z;}}
const sizeOf=i=>(3+12*HS[i])*PS[i]*(R/240);
function frame(){if(!ctx||!W)return;project();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const add=T.blend==='lighter';ctx.globalCompositeOperation='source-over';
  if(!ambient){ambient=ctx.createRadialGradient(cx,cy,0,cx,cy,R*1.5);
    ambient.addColorStop(0,'rgba('+T.glow+','+(add?.16:.07)+')');ambient.addColorStop(1,'rgba('+T.glow+',0)');}
  ctx.fillStyle=ambient;ctx.fillRect(0,0,W,H);
  ctx.globalCompositeOperation=add?'lighter':'source-over';
  // Every import in one path and one stroke: a thousand strokes is where a canvas stops being smooth.
  ctx.lineWidth=1;ctx.strokeStyle=T.link;ctx.beginPath();
  for(let k=0;k<L.length;k+=2){const a=L[k],b=L[k+1];ctx.moveTo(PX[a],PY[a]);ctx.lineTo(PX[b],PY[b]);}
  ctx.stroke();
  const dim=hover>=0;
  for(let i=0;i<n;i++){const s=sizeOf(i);let a=.4+.6*(1-(PZ[i]+1)/2);if(dim&&!NB.has(i))a*=.3;
    ctx.globalAlpha=a;ctx.drawImage(sprite,PX[i]-s,PY[i]-s,s*2,s*2);}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  if(hover>=0){ctx.strokeStyle='rgba('+T.hot+',.95)';ctx.lineWidth=1.5;ctx.beginPath();
    for(const j of ADJ[hover]){ctx.moveTo(PX[hover],PY[hover]);ctx.lineTo(PX[j],PY[j]);}ctx.stroke();
    ctx.strokeStyle=T.ink;ctx.lineWidth=2;ctx.beginPath();ctx.arc(PX[hover],PY[hover],sizeOf(hover)*.5+7,0,6.2832);ctx.stroke();}}
function pick(mx,my){let b=-1,bd=1e9;for(let i=0;i<n;i++){const dx=PX[i]-mx,dy=PY[i]-my,d=dx*dx+dy*dy,r=Math.max(9,sizeOf(i)*.6);
  if(d<r*r&&d<bd){bd=d;b=i;}}return b;}
function setHover(i){if(i===hover)return;hover=i;NB=new Set(i>=0?[i,...ADJ[i]]:[]);if(!run)frame();}
function showTip(i,e){if(!tip)return;const x=NODES[i];tip.style.display='block';
  const flip=e.clientX>innerWidth-370;tip.style.left=(flip?e.clientX-356:e.clientX+16)+'px';tip.style.top=(e.clientY+16)+'px';
  tip.innerHTML='<div class="t">'+esc(x.path)+'</div><div class="m">'+esc(x.area)+' · '+esc(x.lang)
    +'<br><b>'+x.in+'</b> imported by · <b>'+x.out+'</b> imports'
    +(x.category==='code'&&!x.isTest?(x.tested?'<br>test found':'<br>no test found'):'')+'<br>click to open</div>';}
const hideTip=()=>{if(tip)tip.style.display='none';};
function tick(){if(!run)return;if(!visible||document.hidden){run=false;return;}
  // The turn stops under the cursor, so the point being read does not slide out from under it.
  if(!drag&&hover<0)yaw+=.0016;frame();requestAnimationFrame(tick);}
function start(){if(!visible||!ctx)return;if(REDUCED){frame();return;}if(!run){run=true;requestAnimationFrame(tick);}}
if(cv&&ctx){
  cv.setAttribute('aria-label','Import graph: '+plural(n,'code file')+' and '+plural(L.length/2,'import')+'. Arrow keys turn it. The Files tab lists every file.');
  cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,yaw,pitch};moved=false;try{cv.setPointerCapture(e.pointerId);}catch(err){}});
  cv.addEventListener('pointermove',e=>{const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
    if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;
      if(moved){yaw=drag.yaw+dx*.006;pitch=Math.max(-1.2,Math.min(1.2,drag.pitch+dy*.006));hideTip();if(!run)frame();}return;}
    const i=pick(mx,my);setHover(i);if(i>=0)showTip(i,e);else hideTip();});
  cv.addEventListener('pointerup',()=>{const click=drag&&!moved;drag=null;if(click&&hover>=0){hideTip();go(NODES[hover].id);}});
  cv.addEventListener('pointerleave',()=>{if(!drag){setHover(-1);hideTip();}});
  cv.addEventListener('keydown',e=>{const k=e.key,s=.14;
    if(k==='ArrowLeft')yaw-=s;else if(k==='ArrowRight')yaw+=s;else if(k==='ArrowUp')pitch=Math.max(-1.2,pitch-s);
    else if(k==='ArrowDown')pitch=Math.min(1.2,pitch+s);else return;e.preventDefault();if(!run)frame();});}
function hero(){$('hero').innerHTML='<div class="lbl">Files indexed</div><div class="big">'+fmt(S.files)+'</div><div class="rule"></div>'
  +'<div class="strip"><span><b>'+fmt(S.edges)+'</b>import edges</span><span><b>'+fmt(D.areas.length)+'</b>areas</span>'
  +'<span><b>'+fmt(S.tests)+'</b>'+(S.tests===1?'test':'tests')+'</span><span><b>'+fmt(S.lines)+'</b>'+(S.lines===1?'line':'lines')+'</span></div>';
  $('ovcap').innerHTML=n?'<b>The import graph.</b> Each point is one of '+plural(n,'code file')+'; the larger and brighter it is, the more files import it. Drag to turn it, click a point to open the file.'
    :'<b>No code files to draw.</b> The Files tab lists everything that was indexed.';}

// ---- structure -----------------------------------------------------------------------------
// The context layer as a tree: the root brief, what sits beside it, the areas it routes to with
// each area's scoped brief, busiest files and tests, and what Cortex itself generates. A box with
// a dashed border is a thing that is MISSING, and it names the command that writes it — an absent
// brief is the most useful thing this tab can show.
const FILES=new Set(D.nodes.map(x=>x.id));
function B(o){const tag=o.go&&FILES.has(o.go)?'button':'div';
  return '<'+tag+(tag==='button'?' type="button" data-go="'+esc(o.go)+'" title="Open '+esc(o.go)+'"':'')
    +' class="sb '+o.k+(o.cls?' '+o.cls:'')+'"'+(o.id?' id="'+o.id+'"':'')+(o.from?' data-from="'+o.from+'"':'')
    +(o.sw?' style="--sw:'+esc(o.sw)+'"':'')+'><span class="nm">'+esc(o.t)+'</span>'+(o.s?'<small>'+esc(o.s)+'</small>':'')+'</'+tag+'>';}
const base=p=>p.slice(p.lastIndexOf('/')+1);
function structure(){const s=D.structure,p=$('spane');if(!p)return;
  let h='<div class="wrap" style="max-width:none"><h2 class="vh">How this repo is explained to an agent</h2>'
    +'<div class="hint">What an agent opening this repo is handed, and where each area’s own brief lives. Click any file to open it.</div>'
    +'<div class="skey"><span class="k-ctx"><i></i>Context docs</span><span class="k-code"><i></i>Code areas and their busiest files</span>'
    +'<span class="k-test"><i></i>Tests</span><span class="k-gen"><i></i>Generated by Cortex</span><span class="dash"><i></i>Missing — the box names what writes it</span></div>';
  if(!s){p.innerHTML=h+NA('this page was rendered without structure data')+'</div>';return;}
  h+='<div id="stree"><svg id="swires" aria-hidden="true"></svg><div class="srow">'
    +(s.root?B({k:'k-ctx',cls:'root',id:'s-root',t:'AGENTS.md',s:'root brief — every agent reads it first',go:'AGENTS.md'})
      :B({k:'k-ctx',cls:'root missing',id:'s-root',t:'no root AGENTS.md',s:'/cortex-scaffold writes it'}))+'</div><div class="scols">';
  // Left: what sits beside the root brief.
  h+='<div class="scol">'+B({k:'k-ctx',cls:'head',id:'s-hc',from:'s-root',t:'Context docs',s:'beside the root brief'});
  for(const sh of s.shims)h+=B({k:'k-ctx',cls:'leaf',t:sh,s:'shim — points its tool at AGENTS.md',go:sh});
  if(!s.shims.length)h+=B({k:'k-ctx',cls:'leaf missing',t:'no agent shims',s:'/cortex-scaffold writes CLAUDE.md and GEMINI.md'});
  h+=s.glossary?B({k:'k-ctx',cls:'leaf',t:'CONTEXT.md',s:'glossary — what the words mean here',go:'CONTEXT.md'})
    :B({k:'k-ctx',cls:'leaf missing',t:'no CONTEXT.md',s:'/domain-modeling writes the glossary'});
  h+=s.adrs?B({k:'k-ctx',cls:'leaf',t:'docs/adr/',s:plural(s.adrs,'decision')+' recorded'})
    :B({k:'k-ctx',cls:'leaf missing',t:'no docs/adr/',s:'/domain-modeling records decisions'});
  h+=s.review?B({k:'k-ctx',cls:'leaf',t:'REVIEW.md',s:'what a review checks',go:'REVIEW.md'})
    :B({k:'k-ctx',cls:'leaf missing',t:'no REVIEW.md',s:'/cortex writes the review rules'});
  h+='</div>';
  // Centre: the areas the root routes to.
  const code=s.areas.filter(a=>a.code>0),docs=s.areas.filter(a=>a.code===0),shown=code.slice(0,12);
  h+='<div class="scol">'+B({k:'k-code',cls:'head',id:'s-ha',from:'s-root',t:'Code areas',
    s:plural(code.length,'area')+' hold code · '+code.filter(a=>a.brief).length+' have a scoped brief'});
  h+='<div class="sgrid">'+shown.map((a,i)=>{let c='<div class="sarea">'+B({k:'k-code',cls:'area',id:'s-a'+i,from:'s-ha',sw:a.color,t:a.name+'/',s:plural(a.files,'file')+' · '+fmt(a.code)+' code'});
    c+=a.brief?B({k:'k-ctx',cls:'leaf',t:a.brief,s:'scoped brief',go:a.brief}):B({k:'k-ctx',cls:'leaf missing',t:'no scoped brief',s:'/cortex-brief '+a.name+'/'});
    for(const f of a.key)c+=B({k:'k-code',cls:'leaf',t:base(f.path),s:'imported by '+fmt(f.inbound),go:f.path});
    c+=a.tests?B({k:'k-test',cls:'leaf',t:plural(a.tests,'test file'),s:'in '+a.name+'/'}):B({k:'k-test',cls:'leaf missing',t:'no tests found',s:'in '+a.name+'/'});
    return c+'</div>';}).join('')+'</div>';
  if(code.length>shown.length)h+='<p class="sother">'+plural(code.length-shown.length,'more code area')+' — the Areas tab lists every one.</p>';
  if(docs.length)h+='<div class="sother">Areas with no code: '+docs.map(a=>'<span class="chip flat">'+esc(a.name)+' · '+fmt(a.files)+'</span>').join('')+'</div>';
  h+='</div>';
  // Right: what Cortex generates.
  h+='<div class="scol">'+B({k:'k-gen',cls:'head',id:'s-hg',from:'s-root',t:'Generated',s:'written by Cortex, under .cortex/'});
  if(!O)h+=NA(NOSTATE);
  else for(const g of O.generated)h+=B({k:'k-gen',cls:'leaf'+(g.present?'':' missing'),t:g.path,s:g.what+(g.present?'':' — not written yet')});
  h+='</div></div></div></div>';
  p.innerHTML=h;}
// Arrows are drawn after layout, from the boxes where they actually landed — a tree whose lines are
// computed from assumed sizes points at the wrong box the first time a name wraps.
function wires(){const t=$('stree'),svg=$('swires');if(!t||!svg)return;const b=t.getBoundingClientRect();if(!b.width)return;
  svg.setAttribute('width',b.width);svg.setAttribute('height',b.height);svg.setAttribute('viewBox','0 0 '+b.width+' '+b.height);
  const at=el=>{const r=el.getBoundingClientRect();return{x:r.left-b.left+r.width/2,top:r.top-b.top,bot:r.bottom-b.top};};
  let d='';const els=[...t.querySelectorAll('[data-from]')],first=new Map();
  // Only the first row of a parent's children gets an arrow. A line to the second row of areas has
  // to cross the first to get there, and an arrow drawn through a box points at the wrong one.
  for(const el of els){const f=el.getAttribute('data-from'),top=at(el).top;first.set(f,Math.min(first.has(f)?first.get(f):1e9,top));}
  for(const el of els){const from=$(el.getAttribute('data-from'));if(!from)continue;
    const a=at(from),c=at(el),my=(a.bot+c.top)/2;if(c.top>first.get(el.getAttribute('data-from'))+4)continue;
    d+='<path marker-end="url(#sarr)" d="M'+a.x.toFixed(1)+' '+a.bot.toFixed(1)+' C'+a.x.toFixed(1)+' '+my.toFixed(1)+' '+c.x.toFixed(1)+' '+my.toFixed(1)+' '+c.x.toFixed(1)+' '+(c.top-3).toFixed(1)+'"/>';}
  svg.innerHTML='<defs><marker id="sarr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>'
    +'<g fill="none" stroke="currentColor" stroke-width="1.6">'+d+'</g>';}

// ---- theme ---------------------------------------------------------------------------------
const KEY='cortex-view-theme',MQ=typeof matchMedia==='function'?matchMedia('(prefers-color-scheme:dark)'):null;
const theme=()=>root.getAttribute('data-theme')||(MQ&&MQ.matches?'dark':'light');
function paintToggle(){const b=$('theme');if(!b)return;const dark=theme()==='dark';
  b.textContent=dark?'Light theme':'Dark theme';b.setAttribute('aria-label','Switch to the '+(dark?'light':'dark')+' theme');}
$('theme').addEventListener('click',()=>{const next=theme()==='dark'?'light':'dark';root.setAttribute('data-theme',next);
  // Storage can be missing or throw — a private window, a locked-down profile. The choice still
  // applies to this page; it just is not remembered.
  try{localStorage.setItem(KEY,next);}catch(e){}
  retheme();});
if(MQ&&MQ.addEventListener)MQ.addEventListener('change',()=>{if(!root.getAttribute('data-theme'))retheme();});

function show(v){cur=v;visible=v==='ov';if(visible){resize();start();}else{run=false;hideTip();}
  if(v==='structure')requestAnimationFrame(wires);}
addEventListener('resize',()=>{if(visible){resize();if(!run)frame();}if(cur==='structure')wires();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)start();});
$('ovr').addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-copy]');if(b)copy(b.getAttribute('data-copy'),b);});
$('spane').addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-go]');if(b)go(b.getAttribute('data-go'));});
status();vitals();rightCol();hero();structure();retheme();
window.OV={show,frame,resize,count:n,links:L.length/2,points:()=>[...X,...Y,...Z]};
show('ov');
})();
`;

const SCRIPT = `
const $=s=>document.getElementById(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const NODE=new Map(DATA.nodes.map(n=>[n.id,n]));
const OUT=new Map(),IN=new Map();
const push=(m,k,v)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(v);};
for(const l of DATA.links){push(OUT,l.source,l.target);push(IN,l.target,l.source);}
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// The Overview opens first. The Map is built while it is hidden and fitted the first time it is
// shown, because a canvas in a display:none view has no size to fit to.
let TAB='ov';
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.v));
function showTab(v){TAB=v;document.querySelectorAll('.tab').forEach(t=>{const on=t.dataset.v===v;
    t.classList.toggle('on',on);t.setAttribute('aria-selected',on?'true':'false');});
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));$('v-'+v).classList.add('on');if(v==='map')resize();
  // The Overview script owns the cloud and the Structure tree; it is absent when only this script runs.
  if(typeof OV==='object'&&OV)OV.show(v);}

// ---- file reader -------------------------------------------------------------------------
function openFile(id){const n=NODE.get(id);if(!n)return;showTab('files');
  const outs=(OUT.get(id)||[]).slice().sort(),ins=(IN.get(id)||[]).slice().sort();
  const link=p=>'<span class="chip" tabindex="0" role="button" data-go="'+esc(p)+'"><span class="mono">'+esc(p)+'</span></span>';
  const facts=['area: '+n.area,n.lang,n.category,n.depth!==null?'layer '+n.depth:'',n.isEntry?'entry point':'',n.isTest?'test':'']
    .filter(Boolean).map(t=>'<span class="chip flat">'+esc(t)+'</span>').join('');
  let h='<div class="inner"><h1>'+esc(n.label)+'</h1><div class="path mono">'+esc(n.path)+'</div>';
  h+='<div class="kpi"><div class="k"><b>'+n.lines.toLocaleString()+'</b><span>lines</span></div>'
    +'<div class="k"><b>'+n.commits+'</b><span>commits</span></div>'
    +'<div class="k"><b>'+n.in+'</b><span>imported by</span></div>'
    +'<div class="k"><b>'+n.out+'</b><span>imports</span></div></div>';
  h+='<div style="margin-top:14px">'+facts
    +(n.isTest||n.category!=='code'?'':'<span class="chip flat '+(n.tested?'ok':'bad')+'">'+(n.tested?'✓ test found':'✗ no test found')+'</span>')+'</div>';
  if(n.summary)h+='<h2>What it does</h2><div class="hint" style="color:var(--ink-2)">'+esc(n.summary)
    +(n.role?'<br><b>Role:</b> '+esc(n.role):'')+'</div>'
    +(n.tags&&n.tags.length?'<div>'+n.tags.map(t=>'<span class="chip flat">'+esc(t)+'</span>').join('')+'</div>':'');
  h+='<h2>Imported by · '+ins.length+'</h2>'+(ins.length?ins.map(link).join('')
    :'<div class="hint">Nothing resolvable imports this. Import resolution is regex-based, so a dynamic import would not appear here — worth checking, never proof it is dead.</div>');
  h+='<h2>Imports · '+outs.length+'</h2>'+(outs.length?outs.map(link).join(''):'<div class="hint">No resolved imports.</div>');
  const r=$('reader');r.innerHTML=h+'</div>';r.scrollTop=0;
  r.querySelectorAll('.chip[data-go]').forEach(p=>p.onclick=()=>openFile(p.dataset.go));
  document.querySelectorAll('#flist .row').forEach(x=>x.classList.toggle('on',x.dataset.id===id));}

function buildList(q){const L=$('flist');L.innerHTML='';const by={};
  DATA.nodes.filter(n=>!q||n.path.toLowerCase().includes(q)).forEach(n=>{(by[n.area]=by[n.area]||[]).push(n);});
  const keys=Object.keys(by).sort();
  if(!keys.length){L.innerHTML='<div class="hint" style="padding:14px 9px">No path matches that.</div>';return;}
  keys.forEach(a=>{const h=document.createElement('div');h.className='sect';
    h.innerHTML=esc(a)+'<span class="n">'+by[a].length+'</span>';L.appendChild(h);
    by[a].sort((x,y)=>y.deg-x.deg||x.path.localeCompare(y.path)).forEach(n=>{const d=document.createElement('div');
      d.className='row';d.dataset.id=n.id;d.title=n.path;d.tabIndex=0;d.setAttribute('role','button');
      d.innerHTML='<span class="sw" style="background:'+n.color+'"></span><span class="nm">'+esc(n.label)+'</span>';
      d.onclick=()=>openFile(n.id);L.appendChild(d);});});}

// ---- areas -------------------------------------------------------------------------------
function buildAreas(){let h='<div class="wrap"><h2 class="vh">Areas</h2>'
  +'<div class="hint">The top-level shape of this repo. A scoped <code>AGENTS.md</code> means agents load narrow context for that area instead of the whole root brief — run <code>/cortex-brief &lt;dir&gt;</code> on the ones holding real invariants, not on all of them.</div>';
  DATA.areas.forEach(a=>{h+='<div class="card"><h3><span class="sw" style="background:'+a.color+'"></span>'+esc(a.name)+'</h3>'
    +'<div class="s">'+a.files+' files · '+a.code+' code · '+a.lines.toLocaleString()+' lines</div>'
    +(a.description?'<div class="p">'+esc(a.description)+'</div>':'')
    +'<div class="foot"><span class="chip flat '+(a.hasBrief?'ok':'')+'">'+(a.hasBrief?'✓ scoped brief':'no scoped brief')+'</span></div></div>';});
  $('apane').innerHTML=h+'</div>';}

// ---- gaps --------------------------------------------------------------------------------
function buildGaps(){const g=DATA.gaps;
  let h='<div class="wrap"><div class="kpi">'
   +'<div class="k"><b>'+DATA.stats.files+'</b><span>files</span></div>'
   +'<div class="k"><b>'+DATA.stats.edges+'</b><span>import edges</span></div>'
   +'<div class="k"><b>'+DATA.stats.tests+'</b><span>tests</span></div>'
   +'<div class="k'+(g.orphans.length?' warn':'')+'"><b>'+g.orphans.length+'</b><span>orphans</span></div>'
   +'<div class="k'+(g.cyclicFiles.length?' bad':'')+'"><b>'+g.cyclicFiles.length+'</b><span>in cycles</span></div></div>';
  h+='<h2 class="vh">Orphans</h2><div class="hint">Code files nothing imports and which import nothing. Import resolution is regex-based, so dynamic and computed imports are invisible — treat every row as a question, never a delete list.</div>';
  h+=g.orphans.length?g.orphans.map(p=>'<span class="chip" tabindex="0" role="button" data-go="'+esc(p)+'"><span class="mono">'+esc(p)+'</span></span>').join(''):'<div class="hint">None.</div>';
  h+='<h2 class="vh">Files in import cycles</h2><div class="hint">These import each other, directly or through a chain, so they cannot be understood — or tested — one at a time. They also share one layer depth, because mutually importing files genuinely have no order among themselves.</div>';
  h+=g.cyclicFiles.length?g.cyclicFiles.map(p=>'<span class="chip" tabindex="0" role="button" data-go="'+esc(p)+'"><span class="mono">'+esc(p)+'</span></span>').join(''):'<div class="hint">None.</div>';
  h+='<h2 class="vh">Busiest code with no test found</h2><div class="hint">Ranked by commits, because churn is where an untested file actually costs you. Coverage uses three signals — a test named for the file, a test importing it, or a test naming it in a quoted string — so a file exercised only through a subprocess reads as untested here. That is the safe direction to be wrong in.</div>';
  h+=g.untested.length?'<table><tr><th>file</th><th>commits</th></tr>'+g.untested.map(u=>'<tr><td><span class="chip" data-go="'+esc(u.path)+'"><span class="mono">'+esc(u.path)+'</span></span></td><td class="num">'+u.commits+'</td></tr>').join('')+'</table>':'<div class="hint">None.</div>';
  h+='<h2 class="vh">Hot spots</h2><div class="hint">The most-changed code in this repo\\'s history — what a new agent, or a new hire, should read first, and where a scoped brief pays for itself.</div>';
  h+='<table><tr><th>file</th><th>commits</th><th>lines</th><th>test</th></tr>'
   +g.hot.map(f=>'<tr><td><span class="chip" data-go="'+esc(f.path)+'"><span class="mono">'+esc(f.path)+'</span></span></td><td class="num">'+f.commits+'</td><td class="num">'+f.lines+'</td><td class="num" style="color:'+(f.tested?'var(--ok)':'var(--ink-3)')+'">'+(f.tested?'✓':'—')+'</td></tr>').join('')+'</table>';
  const p=$('gpane');p.innerHTML=h+'</div>';
  p.querySelectorAll('.chip[data-go]').forEach(el=>el.onclick=()=>openFile(el.dataset.go));}

// ---- the sequence ------------------------------------------------------------------------
function buildNext(){const n=DATA.next;const p=$('npane');
  if(!n){p.innerHTML='<div class="wrap hint">No sequence data.</div>';return;}
  let h='<div class="wrap"><h2 class="vh">Where this repo is</h2>'
   +'<div class="hint">'+n.done+' of '+n.total+' steps. Every ✓ is a file on disk, not a guess — run the highlighted command next.</div>'
   +'<div class="prog"><i style="width:'+Math.round(n.done/n.total*100)+'%"></i></div>';
  n.steps.forEach(s=>{const mk=s.done?'✓':s.next?'→':'';
    h+='<div class="step'+(s.done?' done':'')+(s.next?' next':'')+'"><div class="mk">'+mk+'</div><div style="min-width:0">'
     +'<div class="ti">'+esc(s.title)
     +(s.optional?'<span class="badge">optional</span>':'')
     +(s.blocking?'<span class="badge hot">do this first</span>':'')
     +(s.next?'<span class="badge hot">you are here</span>':'')+'</div>'
     +'<div class="wy">'+esc(s.why)+'</div>'
     +(s.done?'':'<code class="cm">'+esc(s.cmd)+'</code>')+'</div></div>';});
  h+='<h2 class="vh">Per change</h2><div class="hint">Not a sequence — a lookup. These are triggered by what you are doing, never by how far along the install is.</div>';
  h+='<table><tr><th>when</th><th>run</th></tr>'+n.perChange.map(r=>'<tr><td>'+esc(r.when)+'</td><td><code>'+esc(r.cmd)+'</code></td></tr>').join('')+'</table>';
  p.innerHTML=h+'</div>';}

// ---- graph -------------------------------------------------------------------------------
// Layered, and wrapped. The index knows each file's import depth and the page used to throw that
// away: depth sized the loose-file tray and positioned nothing, so the map was a force hairball
// while the docs claimed it read top-down. A band is now a horizontal *region* owned by one depth,
// and its files fill it in wrapped sub-rows the way words fill a paragraph. One line per depth was
// the first attempt and it does not survive real data — 43 files on one line at 1900px is 44px
// each, against the 86-210px a filename needs, so every chip clipped its neighbour into an
// unreadable sliver while the two sparse bands below sat empty. Wrapping spends that dead height
// on the crowded layers, which is also the honest shape: most files live at depth 0-2.
const cv=$('cv'),ctx=cv.getContext('2d'),tip=$('tip');
let W,H,tx=0,ty=0,scale=1,query='',hover=null,drag=null,pan=false,px=0,py=0,dpr=1;
// Settle instead of animate when the reader has asked for that. Same steps, same cooling, same
// final layout — the only difference is that none of it happens on screen.
const REDUCED=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion:reduce)').matches;
function resize(){const r=cv.getBoundingClientRect();if(!r.width)return;
  // Back the canvas with device pixels and draw in CSS pixels. Without this the whole graph is
  // soft on every HiDPI screen, which is most of them.
  dpr=Math.min(window.devicePixelRatio||1,2);W=r.width;H=r.height;
  cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  // Re-fit a window that changed shape, but only once there is a layout to fit — the first call
  // runs before pack() has placed anything, and fitting an empty box sets a camera the opening
  // frames then have to undo.
  // Re-wrap as well as re-fit. A band is as wide as the window, so a window that changed shape
  // needs a new BW and a new pack(); fitting alone would just scale yesterday's wrap.
  if(frames){BW=bandWidth();pack();chipSet();if(!touched)fit();}}
addEventListener('resize',resize);
// Deterministic seeding: index-derived, never Math.random, so the same index opens the same way.
// There is no y to seed — pack() derives it from depth, and nothing else ever writes it.
const N=DATA.nodes.filter(n=>n.inMap).map(n=>({...n,x:0,y:0,u:0,a:0}));
const M=new Map(N.map(n=>[n.id,n]));
const RGB=h=>{const v=parseInt(String(h).slice(1),16);return (v>>16&255)+','+(v>>8&255)+','+(v&255);};
for(const n of N)n.rgb=RGB(n.color);
// A node is a filename, and a filename is code — so it is set in the mono face the rest of the
// page uses for paths, not in the UI sans. The dot-with-a-floating-label had the labels colliding
// with each other and belonging to nothing; a chip is one object you can read without hovering.
const MONO='"Cascadia Mono",ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace';
// 13px is the floor for every word on this page, the canvas included — a chip is read, not glanced at.
const CHIP_H=26,CHIP_PAD=9,BAR=4,GLY=7;
function measure(){ctx.font='500 13px '+MONO;
  for(const n of N){n.text=n.label.length>24?n.label.slice(0,23)+'…':n.label;
    n.w=Math.min(236,Math.max(90,Math.round(ctx.measureText(n.text).width)+BAR+CHIP_PAD*2+GLY+6));
    n.h=CHIP_H;}}
const E=DATA.links.map(l=>({s:M.get(l.source),t:M.get(l.target)})).filter(e=>e.s&&e.t);
const hidden=new Set();
const vis=n=>!hidden.has(n.area);

// Prominence follows inbound count. Drawing every node as a chip put 162 labels on screen at equal
// weight, which says nothing about structure: the file a third of the repo imports looked exactly
// like a leaf test. The budget is a hard cap and it does NOT grow with zoom — a chip overlaps in
// graph coordinates or it does not, and zooming changes neither, so "zoom in to read the rest" was
// a promise the geometry could not keep. Hover and search reach the other names instead.
const IND=new Map();for(const e of E)IND.set(e.t.id,(IND.get(e.t.id)||0)+1);
const HUB_MIN=2,HUB_MAX=20;
for(const n of N){n.ind=IND.get(n.id)||0;n.r=3.2+3.1*Math.sqrt(n.ind);}
const byRank=(a,b)=>b.ind-a.ind||b.commits-a.commits||(a.path<b.path?-1:1);

// Files with no import edge Cortex could resolve. Simulated alongside everything else they had
// nothing but repulsion acting on them, so they were flung outward into a halo of loose labels
// orbiting the structure — the picture said "half this repo is disconnected" when the truth was
// narrower: shell tests sourced through a loop variable, and tests that read files instead of
// importing them. Parked in a labelled band below the graph instead. Still drawn, still clickable,
// still searchable; they have simply stopped pretending to be part of the layout.
const WIRED=new Set();for(const e of E){WIRED.add(e.s.id);WIRED.add(e.t.id);}
const LOOSE=N.filter(n=>!WIRED.has(n.id))
  .sort((a,b)=>a.area<b.area?-1:a.area>b.area?1:a.path<b.path?-1:1);
const GRAPH=N.filter(n=>WIRED.has(n.id));
const MAXD=GRAPH.reduce((m,n)=>n.depth===null?m:Math.max(m,n.depth),0);
// A wired file the layer pass could not place gets a band of its own under the deepest one. Folding
// it into band 0 would claim it is foundation, which is a different statement from "not known".
const rowOf=n=>n.depth===null?MAXD+1:n.depth;
const ROWS=[];for(let i=0;i<=MAXD+1;i++)ROWS.push([]);
for(const n of GRAPH)ROWS[rowOf(n)].push(n);
while(ROWS.length&&!ROWS[ROWS.length-1].length)ROWS.pop();
const RLBL=ROWS.map((r,i)=>r.some(n=>n.depth===null)?'· no layer found':(i===0?'0 · foundation':String(i)));
// The budget is spent per band, not globally. Ranked across the whole graph it all went to bands 0
// and 1 — every hub is foundation, by definition — and the deeper layers rendered as rows of
// anonymous dots, which is where a reader most wants a name: those are the files that DO the work.
// A band small enough to name outright gets named outright; otherwise a file has to be imported by
// something to be worth a label, and every declared entry point gets one wherever it sits.
const RANKED=ROWS.map(r=>[...r].sort(byRank));
const PER_BAND=Math.max(1,Math.min(3,Math.floor(HUB_MAX/Math.max(1,ROWS.length))));
const HUB=new Set(),addHub=n=>{if(n&&HUB.size<HUB_MAX)HUB.add(n.id);};
for(const n of [...GRAPH].sort(byRank))if(n.isEntry)addHub(n);
// Round-robin by rank position, so a tight budget gives every band its most-imported file before
// any band gets its second. HUB_MAX is a hard cap — addHub is the only way in, and it stops.
for(let k=0;k<PER_BAND;k++)for(const R of RANKED){const n=R[k];if(n&&(n.ind>=1||R.length<=6))addHub(n);}
for(const n of [...GRAPH].sort(byRank))if(n.ind>=HUB_MIN)addHub(n);
// Which nodes sit above and below this one. The ordering inside a band is a barycentre pass.
const UPN=new Map(),DNN=new Map();
for(const e of E){if(!UPN.has(e.s.id))UPN.set(e.s.id,[]);UPN.get(e.s.id).push(e.t);
  if(!DNN.has(e.t.id))DNN.set(e.t.id,[]);DNN.get(e.t.id).push(e.s);}

// The room a node takes along its sub-row: a hub takes its whole chip, everything else takes its
// dot. Reserving a chip for all 162 was what made the slivers — the drawn width has to be the
// reserved width or the packing below is solving the wrong problem.
const slot=n=>HUB.has(n.id)?n.w+14:Math.max(30,n.r*2+16);
const CX=520;
const LANE_H=36,LABEL_H=30,PAD_B=12,AREA_GAP=16,BPAD=24,TOP=40,LEGEND_GUTTER=300;
let BW=1200,TRAY_Y=0,TRAY_COLS=6;const TRAY_W=224;
const BTOP=ROWS.map(()=>0),BH=ROWS.map(()=>LABEL_H+LANE_H+PAD_B);
const bandL=()=>CX-BW/2-BPAD,bandR=()=>CX+BW/2+BPAD;
// A band is as wide as the window, so fit() below lands near 1:1 and a chip is drawn at the size
// it was measured at. Wrapping means width is never what overflows — height is, and height is the
// axis this graph is read along anyway.
const bandWidth=()=>Math.max(520,(W||1400)-150);

// pack() is the whole layout, and it is a projection rather than a force: given an order, it
// assigns every position. Nothing downstream can move a node, so two nodes cannot overlap —
// non-overlap is a post-condition here, not something the simulation is asked to achieve.
function pack(){let y=TOP;
  for(let i=0;i<ROWS.length;i++){
    // Ordered by n.u, a rank in [0,1], never by x. Sorting by pixel x looks equivalent and is not:
    // every lane is packed from the centre outwards, so the first node of lane 2 has a smaller x
    // than the middle of lane 1, and re-sorting by x next frame interleaves the two. The order
    // never settled and the barycentre below had nothing stable to converge on.
    const R=ROWS[i].filter(vis).sort((a,b)=>a.u-b.u||(a.path<b.path?-1:1));
    BTOP[i]=y;
    // Wrap like a paragraph: fill a sub-row up to the band's width, then start another. An extra
    // gap where the area changes is what repulsion used to buy — a visible seam between clusters —
    // except this one cannot push anything off screen.
    const lanes=[];let cur=[],w=0;
    for(const n of R){const g=cur.length&&cur[cur.length-1].area!==n.area?AREA_GAP:0,s=slot(n);
      if(cur.length&&w+g+s>BW){lanes.push(cur);cur=[n];w=s;}
      else{cur.push(n);w+=g+s;}}
    if(cur.length)lanes.push(cur);
    if(!lanes.length)lanes.push([]);
    for(let li=0;li<lanes.length;li++){const L=lanes[li];
      let tw=0;for(let k=0;k<L.length;k++)tw+=slot(L[k])+(k&&L[k-1].area!==L[k].area?AREA_GAP:0);
      let x=CX-tw/2;const ly=y+LABEL_H+li*LANE_H+LANE_H/2;
      for(let k=0;k<L.length;k++){const n=L[k];
        if(k&&L[k-1].area!==n.area)x+=AREA_GAP;
        n.x=x+slot(n)/2;n.y=ly;x+=slot(n);}}
    // Re-rank, so u stays monotone in reading order and comparable across bands of different size.
    R.forEach((n,k)=>{n.u=(k+.5)/R.length;});
    BH[i]=LABEL_H+lanes.length*LANE_H+PAD_B;
    y+=BH[i];}
  // The tray is a list, so it is set left-aligned rather than centred, and it stops short of the
  // right edge: the legend is an overlay pinned to the bottom right, which is exactly where a long
  // tray ends up. Centred and full width, its last column rendered under the legend and four
  // filenames were cut off — invisible in every measurement, obvious in a screenshot.
  TRAY_Y=y+110;TRAY_COLS=Math.max(3,Math.floor((BW-LEGEND_GUTTER)/TRAY_W));
  LOOSE.forEach((n,i)=>{n.pin=1;
    n.x=bandL()+BPAD+(i%TRAY_COLS)*TRAY_W+TRAY_W/2;n.y=TRAY_Y+Math.floor(i/TRAY_COLS)*34;});}

function layout(){
  // Seed sorted by area then path, so files that belong together begin together and the barycentre
  // only has to refine an ordering rather than discover one. Deterministic, like everything else
  // here: there is no Math.random in this file.
  ROWS.forEach(r=>{r.sort((a,b)=>a.area<b.area?-1:a.area>b.area?1:a.path<b.path?-1:1);
    r.forEach((n,i)=>{n.u=(i+.5)/r.length;});});
  BW=bandWidth();
  pack();}

function step(){const A=N.filter(n=>vis(n)&&!n.pin);
  // The layout cools to a stop instead of drifting forever. A graph that never settles cannot be
  // fitted to the window — every fit is undone by the next frame — and a picture that keeps moving
  // under the cursor is harder to read than one that is merely imperfect.
  const cool=Math.max(0,1-frames/760);
  if(cool){const move=[];
    // The only force left, and it settles an ORDER rather than a position: a node drifts toward
    // the mean rank of what it imports, and what imports it pulls back at about half that, so
    // related files end up at the same place along their bands and the edges between them stay
    // short. Repulsion and centring went when pack() took over placement — a force that can only
    // reshuffle the order can only move it away from the barycentre, which is the one thing the
    // order is there to say. Ranks, not pixels, so a 43-file band and a 3-file band are on the
    // same scale; targets are read for the whole graph before any of them is written, or a band
    // would be chasing the half of its neighbour that already moved this frame.
    for(const a of A){const up=UPN.get(a.id),dn=DNN.get(a.id);let su=0,sw=0;
      if(up)for(const m of up){if(vis(m)){su+=m.u;sw+=1;}}
      if(dn)for(const m of dn){if(vis(m)){su+=m.u*.55;sw+=.55;}}
      if(sw)move.push([a,su/sw]);}
    for(const [a,t] of move)a.u+=(t-a.u)*.6*cool;}
  pack();chipSet();}

// A graph laid out in its own coordinates has no reason to match the window, and this one opened
// with a third of itself past the edge. Fit once, after the simulation has settled — and never
// after the user has touched the view, because moving someone's camera out from under them is worse
// than a bad first frame.
let frames=0,touched=false;
function fit(){if(!ROWS.length||!W)return;
  // The bands ARE the bounding box, and the band label lives inside one. Fitting the nodes instead
  // put the left edge of the box off screen and the row-0 label rendered as "ounda…".
  const x0=bandL(),x1=bandR(),y0=BTOP[0],y1=BTOP[ROWS.length-1]+BH[ROWS.length-1];
  const pad=Math.max(22,Math.min(W,H)*.035);
  // The HUD is an overlay pinned to the top left of the canvas, which is also where band 0 puts its
  // label. Reserve the room rather than letting the two share it — a band label under a floating
  // panel is a band label nobody can read.
  const padT=Math.max(pad,74),availW=W-pad*2,availH=H-padT-pad;
  // Never fit below the point where the chips stop being readable: a page that fits
  // perfectly and cannot be read has optimised the wrong thing. Past that, panning is the answer.
  const s=Math.max(CHIP_LOD+.08,Math.min(availW/(x1-x0||1),availH/(y1-y0||1),1.15));
  // The scale comes from the bands alone — a long tray must never shrink the graph — but the
  // tray counts for where the picture sits, because it is part of the answer and on a short graph
  // it is a section of the page nobody knows is there. Taking it into the scale only when it
  // happened to fit produced a cliff: one extra row of loose files and the tray dropped out of the
  // extent, the bands re-centred, and the page opened with 270px of nothing above them.
  const bottom=LOOSE.length?TRAY_Y+Math.ceil(LOOSE.length/TRAY_COLS)*34+24:y1;
  const gw=(x1-x0)*s,gh=(bottom-y0)*s;
  scale=s;
  // Centre what fits; anchor what does not to the top left. When the floor above wins, something
  // has to go off screen, and centring it cropped both ends — including band 0's label, which is
  // where the reading starts. Overflow belongs at the end you pan towards, not at the start.
  tx=(gw<=availW?(W-gw)/2:pad)-x0*s;
  ty=(gh<=availH?padT+(availH-gh)/2:padT)-y0*s;}
function shapePath(shape,x,y,r){ctx.beginPath();
  if(shape==='square')ctx.roundRect(x-r,y-r,r*2,r*2,r*.42);
  else if(shape==='diamond'){ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();}
  else if(shape==='triangle'){ctx.moveTo(x,y-r);ctx.lineTo(x+r*.92,y+r*.72);ctx.lineTo(x-r*.92,y+r*.72);ctx.closePath();}
  else ctx.arc(x,y,r,0,7);}
function path(n,r){shapePath(n.shape,n.x,n.y,r);}

// One chip = one file, readable without hovering. The accent bar carries the area colour and
// thickens with inbound count, the glyph keeps the category encoding the dots used to carry alone,
// and the name is set in the mono face because a filename is code. Below CHIP_LOD nothing is
// labelled at all, because nothing would be legible.
const CHIP_LOD=.55;
function chip(n,focus){
  const w=n.w,h=n.h,x=n.x-w/2,y=n.y-h/2,rad=8;
  // Glow is focus only. Everything else gets a shadow, which is depth rather than light: ambient
  // glow on 160 nodes is the cheap-futuristic look, and it flattens the one thing being pointed at.
  if(focus){ctx.shadowColor='rgba('+n.rgb+',.55)';ctx.shadowBlur=20;ctx.shadowOffsetY=0;}
  else{ctx.shadowColor=css('--cvshadow');ctx.shadowBlur=8;ctx.shadowOffsetY=2;}
  ctx.beginPath();ctx.roundRect(x,y,w,h,rad);
  ctx.fillStyle=css('--raised');ctx.fill();
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  // The accent bar, clipped to the chip's own rounding so it reads as part of the card.
  ctx.save();ctx.clip();ctx.globalAlpha=n.a*.10;ctx.fillStyle=n.color;ctx.fillRect(x,y,w,h);
  ctx.globalAlpha=n.a;ctx.fillRect(x,y,BAR+(n.ind>=5?3:n.ind>=2?1.5:0),h);ctx.restore();
  const untested=n.category==='code'&&!n.isTest&&!n.tested;
  ctx.lineWidth=focus?1.6:1;
  ctx.strokeStyle=focus?css('--ink'):(untested?css('--bad'):css('--line'));
  ctx.beginPath();ctx.roundRect(x,y,w,h,rad);ctx.stroke();
  ctx.fillStyle=n.color;shapePath(n.shape,x+BAR+9,n.y,GLY/2);ctx.fill();
  ctx.fillStyle=css('--ink');ctx.font=(n.ind>=5?'600 ':'500 ')+'13px '+MONO;
  ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.fillText(n.text,x+BAR+CHIP_PAD+GLY+2,n.y+.5);
  ctx.textBaseline='alphabetic';}

// Hover and search state are kept as sets rather than recomputed in two places, because picking has
// to agree with drawing about which nodes are chips — a chip you can see and cannot click is worse
// than no chip at all.
let NB=new Set(),MT=new Set(),CHIPS=new Set(),qOn=false;
function setHover(n){if(hover===n)return;hover=n;NB=new Set();
  if(n){NB.add(n.id);for(const e of E){if(e.s===n)NB.add(e.t.id);if(e.t===n)NB.add(e.s.id);}}
  chipSet();}
function setQuery(v){query=v;const q=v.trim().toLowerCase();qOn=!!q;MT=new Set();
  if(q)for(const n of N)if(n.path.toLowerCase().includes(q))MT.add(n.id);
  chipSet();}
// A parked node keeps its chip. The tray is a list, not a picture: naming the files with no
// resolvable edge is its whole purpose, and 48 anonymous dots on a 224px grid name none of them.
const wantChip=n=>HUB.has(n.id)||n.pin||NB.has(n.id)||MT.has(n.id);
// The overlap rule, enforced rather than hoped for. Candidates are taken in priority order — what
// the cursor is on first, then by inbound count — and one that would intersect a chip already
// placed is demoted to its dot. A legible dot beats a chip clipped to an 8px sliver, which is what
// shipped when the reserved width and the drawn width disagreed. Cheap: the budget is ~20, plus a
// hovered neighbourhood.
function chipSet(){CHIPS=new Set();if(scale<CHIP_LOD)return;
  const cand=N.filter(n=>vis(n)&&wantChip(n))
    .sort((a,b)=>(a===hover?-1:b===hover?1:0)||byRank(a,b));
  const ok=[];
  for(const n of cand){let clash=false;
    for(const m of ok){if(Math.abs(n.x-m.x)<(n.w+m.w)/2+2&&Math.abs(n.y-m.y)<(n.h+m.h)/2+2){clash=true;break;}}
    if(!clash){ok.push(n);CHIPS.add(n.id);}}}
const showChip=n=>scale>=CHIP_LOD&&CHIPS.has(n.id);

function bands(){if(!ROWS.length)return;
  const x0=bandL(),x1=bandR(),tint=css('--band'),lab=css('--ink-2');
  // The bands are what make the layering legible. Without them a reader sees sub-rows and has no
  // way to know which layer they belong to — and "laid out by import depth" is a claim the picture
  // has to keep, not one the docs can keep for it.
  for(let i=0;i<ROWS.length;i++){
    if(i%2===0){ctx.fillStyle=tint;ctx.beginPath();ctx.roundRect(x0,BTOP[i],x1-x0,BH[i],18);ctx.fill();}
    ctx.fillStyle=lab;ctx.font='600 13px system-ui,sans-serif';ctx.textAlign='left';
    ctx.fillText(RLBL[i],x0+18,BTOP[i]+23);}}

function draw(){if(!W||TAB!=='map')return;ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(tx,ty);ctx.scale(scale,scale);
  const EC=css('--edge');
  bands();
  ctx.lineCap='round';
  for(const e of E){if(!vis(e.s)||!vis(e.t))continue;const on=hover?(e.s===hover||e.t===hover):true;
    // A slight curve keeps parallel edges from stacking into one thick line, and reads as a
    // relationship rather than a wire.
    const mx=(e.s.x+e.t.x)/2,my=(e.s.y+e.t.y)/2,dx=e.t.x-e.s.x,dy=e.t.y-e.s.y;
    const qx=mx-dy*.09,qy=my+dx*.09;
    // Each edge carries its source area's colour, so a bundle can be traced across bands. One flat
    // grey for 154 edges says only "there are edges here". They dim to a neutral when something
    // else has focus, so the hovered pair is the only colour left on screen.
    // Quiet at rest. Wrapping puts related files on different sub-rows, so 154 edges drawn at any
    // real weight read as a thicket laid over the thing you came to look at. At rest they are a
    // texture that says where the traffic is; hover is what traces one.
    ctx.strokeStyle=hover?(on?'rgba('+e.s.rgb+',.7)':'rgba('+EC+',.13)'):'rgba('+e.s.rgb+',.12)';
    ctx.lineWidth=on&&hover?1.7:.7;
    ctx.beginPath();ctx.moveTo(e.s.x,e.s.y);ctx.quadraticCurveTo(qx,qy,e.t.x,e.t.y);ctx.stroke();
    if(on&&hover){ // direction only where the eye is, so the picture stays calm
      const ang=Math.atan2(e.t.y-qy,e.t.x-qx),r=e.t.r+3.5;
      const ax=e.t.x-Math.cos(ang)*r,ay=e.t.y-Math.sin(ang)*r;
      ctx.fillStyle='rgba('+e.s.rgb+',.8)';ctx.beginPath();
      ctx.moveTo(ax,ay);ctx.lineTo(ax-Math.cos(ang-.42)*7,ay-Math.sin(ang-.42)*7);
      ctx.lineTo(ax-Math.cos(ang+.42)*7,ay-Math.sin(ang+.42)*7);ctx.closePath();ctx.fill();}}
  if(LOOSE.length){ // the band's own caption, so a parked node is never mistaken for a stray one
    const l=bandL()+BPAD,r=l+TRAY_COLS*TRAY_W;ctx.globalAlpha=.42;
    ctx.strokeStyle=css('--ink-2');ctx.lineWidth=1;
    ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(l,TRAY_Y-40);ctx.lineTo(r,TRAY_Y-40);
    ctx.stroke();ctx.setLineDash([]);
    // The rule is faint; the words are not. A caption at .42 alpha is a label nobody can read.
    ctx.globalAlpha=1;ctx.fillStyle=css('--ink-2');ctx.font='600 13px system-ui,sans-serif';
    ctx.textAlign='left';ctx.fillText(LOOSE.length+' files with no import edge found',l,TRAY_Y-50);
    ctx.globalAlpha=1;}
  // The hovered node goes last, so its glow and its border are not painted over by a neighbouring
  // chip that happens to come later in the file order.
  for(const n of (hover?[...N.filter(n=>n!==hover),hover]:N)){if(!vis(n))continue;
    const mt=MT.has(n.id);
    const want=((hover&&!NB.has(n.id))||(qOn&&!mt))?.13:1;
    n.a=REDUCED?want:n.a+(want-n.a)*.22;       // eased focus, so hovering does not strobe
    ctx.globalAlpha=n.a;
    if(showChip(n)){chip(n,hover===n||mt);continue;}
    const lift=(hover===n)?1.35:1,r=n.r*lift;
    if(hover===n||mt){ctx.shadowColor='rgba('+n.rgb+',.7)';ctx.shadowBlur=14;}
    path(n,r);ctx.fillStyle=n.color;ctx.fill();ctx.shadowBlur=0;
    if(n.category==='code'&&!n.isTest&&!n.tested){ctx.lineWidth=1.3;ctx.strokeStyle=css('--bad');ctx.stroke();}}
  ctx.globalAlpha=1;ctx.restore();}
function settle(){for(let i=0;i<800;i++){step();frames++;}fit();chipSet();}
function loop(){if(!REDUCED){step();frames++;
    if(!touched&&(frames===200||frames===480||frames===800))fit();}
  draw();requestAnimationFrame(loop);}
function tw(mx,my){return{x:(mx-tx)/scale,y:(my-ty)/scale};}
// Hit-testing follows what is actually drawn: the chip's rectangle when this node has one, the dot
// otherwise. A radius test against a 200px-wide chip means most of the card is not clickable.
function pick(mx,my){const p=tw(mx,my);let b=null,bd=1e9;
  for(const n of N){if(!vis(n))continue;
    const dx=n.x-p.x,dy=n.y-p.y;
    if(showChip(n)){if(Math.abs(dx)<=n.w/2&&Math.abs(dy)<=n.h/2){const d=dx*dx+dy*dy;if(d<bd){bd=d;b=n;}}}
    else{const d=dx*dx+dy*dy;if(d<bd&&d<(n.r+9)*(n.r+9)){bd=d;b=n;}}}
  return b;}
cv.addEventListener('mousedown',e=>{const n=pick(e.offsetX,e.offsetY);
  touched=true;if(n){drag=n;drag._dn=0;}else{pan=true;px=e.offsetX;py=e.offsetY;}});
// The listener is on the window, so it hears the mouse over every tab. Only the Map answers it —
// picking against a hidden canvas put a Map tooltip on top of the Overview's cloud.
addEventListener('mousemove',e=>{if(TAB!=='map'&&!drag&&!pan)return;const r=cv.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;
  // Only a parked node drags freely. A wired one is placed by pack(), and a node you could drag out
  // of its band would be a node claiming a layer it is not on.
  if(drag){const p=tw(mx,my);if(drag.pin){drag.x=p.x;drag.y=p.y;}drag._dn=1;}
  else if(pan){tx+=mx-px;ty+=my-py;px=mx;py=my;}
  else{const n=pick(mx,my);setHover(n);
    if(n){tip.style.display='block';
      const flip=e.clientX>innerWidth-360;
      tip.style.left=(flip?e.clientX-350:e.clientX+16)+'px';tip.style.top=(e.clientY+16)+'px';
      tip.innerHTML='<div class="t">'+esc(n.path)+'</div><div class="m">'
        +esc(n.area)+' · '+esc(n.lang)+' · <b>'+n.lines+'</b> lines · <b>'+n.commits+'</b> commits<br>'
        +(n.depth!==null?'layer <b>'+n.depth+'</b> · ':'')
        +'<b>'+n.in+'</b> imported by · <b>'+n.out+'</b> imports'
        +(n.category==='code'&&!n.isTest?(n.tested?'<br>✓ test found':'<br>✗ no test found'):'')
        +(n.summary?'<br>'+esc(n.summary.slice(0,150)):'')+'<br>click to open</div>';}
    else tip.style.display='none';}});
addEventListener('mouseup',()=>{if(drag&&!drag._dn)openFile(drag.id);drag=null;pan=false;});
cv.addEventListener('wheel',e=>{e.preventDefault();touched=true;const f=e.deltaY<0?1.1:.9;const mx=e.offsetX,my=e.offsetY;
  tx=mx-(mx-tx)*f;ty=my-(my-ty)*f;scale*=f;chipSet();},{passive:false});
function buildHud(){$('hud').innerHTML='<span><b>'+N.length+'</b> files</span><span class="sep"></span>'
  +'<span><b>'+E.length+'</b> imports</span><span class="sep"></span>'
  +'<span><b>'+ROWS.length+'</b> layers</span><span class="sep"></span><span>scroll to zoom · drag to pan</span>';}
function buildLegend(){const L=$('legend');const shown=new Set(N.map(n=>n.area));
  L.innerHTML=DATA.areas.filter(a=>shown.has(a.name)).map(a=>'<div class="lg" tabindex="0" role="button" aria-pressed="true" data-a="'+esc(a.name)+'">'
    +'<span class="sw" style="background:'+a.color+'"></span>'+esc(a.name)
    +'<span class="ct">'+N.filter(n=>n.area===a.name).length+'</span></div>').join('')
   +'<div class="note">Click an area to hide it. Each band is one import depth — band 0 is what the '
   +'rest is built on, and a band wraps onto as many sub-rows as it needs. A dot grows with how many '
   +'files import it; the '+HUB.size+' most-imported are named, and hover or search reaches the rest. '
   +'A red outline means no test was found. '
   +(DATA.nodes.length-N.length)+' docs and config files live in <b>Files</b>, not here — they have no imports to draw.'
   +(LOOSE.length?' The '+LOOSE.length+' files in the band below the graph have no import edge Cortex could resolve — which is a question, not a verdict: a file loaded dynamically, or sourced through a variable, looks exactly like an unused one.':'')+'</div>';
  L.querySelectorAll('.lg[data-a]').forEach(el=>el.onclick=()=>{const a=el.dataset.a;
    if(hidden.has(a)){hidden.delete(a);el.classList.remove('off');}else{hidden.add(a);el.classList.add('off');}
    el.setAttribute('aria-pressed',hidden.has(a)?'false':'true');
    pack();chipSet();});}
// Search answers where it can be seen: on the Map it highlights, anywhere else it opens the list.
$('q').addEventListener('input',e=>{setQuery(e.target.value);buildList(query.trim().toLowerCase());
  if(TAB!=='map'&&TAB!=='files')showTab('files');});
addEventListener('keydown',e=>{const t=e.target;
  if(e.key==='/'&&document.activeElement!==$('q')&&!(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'))){e.preventDefault();$('q').focus();}
  if(e.key==='Escape'){$('q').blur();}
  // Rows, chips and legend entries are clickable spans, so they answer the keys a button would.
  if((e.key==='Enter'||e.key===' ')&&t&&t.getAttribute&&t.getAttribute('role')==='button'&&t.tagName!=='BUTTON'){e.preventDefault();t.click();}});
buildList('');buildAreas();buildGaps();buildNext();buildLegend();buildHud();
resize();measure();layout();if(REDUCED)settle();loop();
`;

// Inlined JSON sits inside a <script> element, where the parser looks for "</script" before it
// looks for a string literal. An enrichment summary quoting markup would otherwise end the script
// mid-object and blank the page.
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The tabs, in reading order. The Overview answers "what state is this repo in"; everything after it
// is a closer look at one part of that answer.
const TABS = [
  ["ov", "Overview"], ["map", "Map"], ["structure", "Structure"], ["files", "Files"],
  ["areas", "Areas"], ["gaps", "Gaps"], ["next", "Next steps"],
];

// A stored theme is applied in <head>, before the first paint — applied after it, a reader who chose
// light gets a flash of dark on every open, which is exactly what they chose light to avoid.
const THEME_BOOT =
  `try{var t=localStorage.getItem("cortex-view-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function renderHtml(view) {
  const repo = escHtml(view.generated.root.split(/[\\/]/).filter(Boolean).pop() || "repo");
  const tabs = TABS.map(([v, label]) =>
    `<button type="button" class="tab${v === "ov" ? " on" : ""}" role="tab" aria-selected="${v === "ov"}" data-v="${v}">${label}</button>`,
  ).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<title>Cortex — ${repo}</title>
<script>${THEME_BOOT}</script>
<style>${CSS}</style></head><body>
<div id="top">
<div id="brand"><b>CORTEX</b><span>· ${repo}</span></div>
<nav id="tabs" role="tablist" aria-label="Views">
${tabs}
</nav>
<input id="q" placeholder="Search paths…  /" aria-label="Search file paths" autocomplete="off" spellcheck="false"/>
<button type="button" id="theme">Theme</button></div>
<div id="main">
<div class="view on" id="v-ov"><div id="ovbar" role="status"></div><aside class="col" id="ovl" aria-label="Repo vitals"></aside><section id="ovc" aria-label="Import graph"><canvas id="ov" tabindex="0" role="img" aria-label="Import graph"></canvas><div id="ovcap"></div><div id="hero"></div></section><aside class="col" id="ovr" aria-label="Next steps and timeline"></aside></div>
<div class="view" id="v-map"><canvas id="cv"></canvas><div class="float" id="hud"></div><div class="float" id="legend"></div></div>
<div class="view" id="v-structure"><div class="pane" id="spane"></div></div>
<div class="view" id="v-files"><div class="list" id="flist"></div><div id="reader"><div id="empty">Pick a file on the left, or click a point on the Overview or the Map.</div></div></div>
<div class="view" id="v-areas"><div class="pane" id="apane"></div></div>
<div class="view" id="v-gaps"><div class="pane" id="gpane"></div></div>
<div class="view" id="v-next"><div class="pane" id="npane"></div></div>
</div><div id="tip"></div><div id="live" class="sr" aria-live="polite"></div>
<script>const DATA=${safeJson(view)};</script>
<script id="ov-js">${OV_SCRIPT}</script>
<script>${SCRIPT}</script>
</body></html>`;
}
