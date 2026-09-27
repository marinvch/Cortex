// view-repo.test.mjs — the viewer against a real git repository, the way cortex-view runs it.
//
// view.test.mjs drives buildView from literal index objects, which is right for layout and markup
// and blind to everything this file checks: what the page carries about the MACHINE it was built on,
// and whether the numbers it prints are the numbers the other CLIs print about the same repo. Both
// defects reached a real run (pmndrs/zustand, cloned shallow) with every fixture test green — the
// literals had no absolute root to leak and only one surface to agree with.
//
// The fixture is shaped like that repo on purpose: a `src/` whose tests live in a top-level
// `tests/`, three files called `shallow.ts`, a scoped brief one level down, an ADR directory holding
// only its template, and Cortex's own `.claude/` tooling.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir, userInfo } from "node:os";
import { execFileSync } from "node:child_process";

import { buildIndex } from "../lib/build.mjs";
import { buildView } from "../lib/view.mjs";
import { renderHtml } from "../lib/view-html.mjs";
import { buildOverview } from "../lib/overview.mjs";
import { nextSteps } from "../lib/next.mjs";
import { analyse } from "../lib/findings.mjs";
import { runOverview } from "./browser.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });

function put(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function zustandShaped() {
  const root = tempDir("cortex-view-repo-");
  const files = {
    "package.json": '{ "name": "store", "version": "1.0.0" }\n',
    "README.md": "# store\n",
    "AGENTS.md": "# store\n",
    "CONTEXT.md": "# Glossary\n",
    "docs/adr/TEMPLATE.md": "# {{title}}\n",
    "src/index.ts": 'import { create } from "./vanilla";\nimport { persist } from "./middleware";\nexport { create, persist };\n',
    "src/vanilla.ts": "export const create = () => ({});\n",
    "src/shallow.ts": 'import { shallow } from "./vanilla/shallow";\nexport { shallow };\n',
    "src/middleware.ts": 'import { persist } from "./middleware/persist";\nexport { persist };\n',
    "src/types.ts": "export type Store = {};\n",
    "src/middleware/AGENTS.md": "# middleware\n",
    "src/middleware/persist.ts": "export const persist = () => {};\n",
    "src/middleware/devtools.ts": "export const devtools = () => {};\n",
    "src/middleware/immer.ts": "export const immer = () => {};\n",
    "src/react/shallow.ts": 'import { shallow } from "../vanilla/shallow";\nexport const useShallow = shallow;\n',
    "src/vanilla/shallow.ts": "export const shallow = (a, b) => a === b;\n",
    "tests/vanilla.test.ts": 'import { create } from "../src/vanilla";\ncreate();\n',
    "tests/persist.test.ts": 'import { persist } from "../src/middleware/persist";\npersist();\n',
    ".claude/hooks/format-changed.sh": "#!/bin/sh\nexit 0\n",
    ".claude/skills/add-test/SKILL.md": "---\nname: add-test\n---\n",
    ".claude/skills/type-check/SKILL.md": "---\nname: type-check\n---\n",
  };
  for (const [rel, body] of Object.entries(files)) put(root, rel, body);
  git(root, "init", "-q", ".");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "first");
  put(root, "src/vanilla.ts", "export const create = () => ({ v: 2 });\n");
  git(root, "commit", "-qam", "second");
  return root;
}

/** Everything cortex-view does short of writing the file, in the same order. */
function render(root) {
  const index = buildIndex(root);
  const overview = buildOverview(index, root, { stale: false, env: {} });
  const next = nextSteps(root, index, { view: true });
  const view = buildView(index, root, { next, overview });
  return { index, view, html: renderHtml(view) };
}

// ── 1. nothing about the machine ─────────────────────────────────────────────────────────────────

test("the page never carries the machine's absolute path or the OS user name", () => {
  const root = zustandShaped();
  const { html, view } = render(root);
  // Every spelling the root can take once it has been through JSON and a Windows path API.
  const forms = new Set();
  for (const p of [root, resolve(root), homedir()]) {
    forms.add(p);
    forms.add(p.replace(/\\/g, "/"));
    forms.add(p.replace(/\//g, "\\"));
    forms.add(JSON.stringify(p).slice(1, -1));
  }
  const lower = html.toLowerCase();
  for (const f of forms) {
    assert.ok(!lower.includes(f.toLowerCase()), `the page contains ${JSON.stringify(f)}`);
  }
  const user = userInfo().username;
  if (user && user.length >= 3) {
    const esc = user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(html, new RegExp(`[\\\\/]${esc}[\\\\/]`, "i"), "no path segment names the OS user");
  }
  assert.equal(view.generated.repo, root.split(/[\\/]/).pop(), "the page names the repo by its directory name");
  assert.ok(!("root" in view.generated), "and carries no root field at all");
  assert.ok(!("state" in view.next) && !("root" in view.next), "the sequence arrives without its disk state");
});

// ── 2. one number per quantity ───────────────────────────────────────────────────────────────────

test("the page's headline numbers are the index's, the findings report's and cortex-next's", () => {
  const root = zustandShaped();
  const { index, view } = render(root);

  // Files and imports: exactly what cortex-index prints.
  assert.equal(view.stats.files, index.stats.files, "files indexed");
  assert.equal(view.stats.edges, index.stats.edges, "import edges — every resolved import");
  assert.equal(view.stats.edges, index.edges.filter((e) => e.type === "imports").length);

  // Untested: the findings title's number, which is now the whole count.
  const tests = analyse(index, root).find((f) => f.kind === "tests");
  assert.ok(tests, "the fixture has an untested directory, so the finding fires");
  const titled = Number(/^(\d+) modules? appear untested/.exec(tests.title)[1]);
  assert.equal(view.stats.untested, titled, "the page and the findings report count untested code alike");
  assert.equal(view.stats.testable - view.stats.tested, view.stats.untested, "and the coverage tile adds up to it");

  // Steps: the page ticks its own step, and the count still matches cortex-next run before the page
  // existed, because optional steps are listed but never counted.
  const cli = nextSteps(root, index);
  assert.equal(cli.steps.find((s) => s.id === "view").done, false, "cortex-next has not seen a page yet");
  assert.equal(view.next.steps.find((s) => s.id === "view").done, true, "the page knows it is one");
  assert.deepEqual([view.next.done, view.next.total], [cli.done, cli.total], "and both say the same N of M");

  // The subsets are separate fields with separate names, never a relabelled headline.
  const drawn = view.nodes.filter((n) => n.inMap);
  assert.equal(view.stats.mapFiles, drawn.length);
  const ids = new Set(drawn.map((n) => n.id));
  assert.equal(view.stats.mapEdges, view.links.filter((l) => ids.has(l.source) && ids.has(l.target)).length);
});

test("the tiles print those fields, and say which subset the Map draws", () => {
  const root = zustandShaped();
  const { view } = render(root);
  const page = runOverview(view);
  const ovl = page.html("ovl");
  assert.match(ovl, new RegExp(`>${view.stats.edges}</div>`), "the import tile shows every resolved import");
  assert.match(ovl, new RegExp(`${view.stats.mapEdges} between code files`), "and names the drawn subset beside it");
  assert.match(ovl, new RegExp(`${view.stats.untested} modules? with no test found`), "coverage states the findings count");
  assert.match(page.html("ovr"), new RegExp(`${view.next.done} of ${view.next.total} required done`));
  assert.match(page.html("ovbar"), /last commit <b>\d{4}-\d{2}-\d{2}<\/b> UTC/, "the date is the commit's, and says so");
  assert.doesNotMatch(page.html("ovbar"), /indexed/, "never called the index date — the index carries no clock");
});

// ── 3. the Structure tab ─────────────────────────────────────────────────────────────────────────

test("the Structure tab counts, routes and tests areas the way the rest of Cortex does", () => {
  const root = zustandShaped();
  const { view } = render(root);
  const area = (n) => view.structure.areas.find((a) => a.name === n);

  assert.equal(area("src").brief, null, "a child's brief is not its parent's");
  assert.equal(area("src/middleware").brief, "src/middleware/AGENTS.md");
  assert.equal(area("src").suggest, "/cortex-brief src/", "src/ is a findings brief candidate");
  assert.equal(area("root").suggest, null, "there is no directory called root/");
  assert.equal(area("root").brief, "AGENTS.md", "the top-level files are the root brief's");
  assert.equal(area(".claude").suggest, null, "Cortex's own tooling is never offered a brief");
  assert.equal(area("src/react").suggest, null, "a one-file directory is not a candidate");
  assert.equal(area("src/react").inherits, "AGENTS.md");
  assert.ok(area("src").tested > 0, "tests in a top-level tests/ cover src/ — by coverage, not by directory");
  assert.equal(view.structure.adrDir, "docs/adr", "an ADR directory holding only its template exists");
  assert.equal(view.structure.adrGo, "docs/adr/TEMPLATE.md", "and the tab links to the template");

  const s = runOverview(view).html("spane");
  assert.match(s, /1 has a scoped brief/, "one scoped brief exists, so one is counted");
  assert.doesNotMatch(s, /\/cortex-brief root\//);
  assert.doesNotMatch(s, /\/cortex-brief \.claude\//);
  assert.match(s, /\/cortex-brief src\//);
  assert.doesNotMatch(s, /no docs\/adr\//, "the directory is drawn as present");
  assert.doesNotMatch(s, /no tests found/, "the old directory-listing wording is gone");
  // The Areas tab reads the same brief answer, rather than a path suffix test of its own.
  assert.equal(view.areas.find((a) => a.name === "src").hasBrief, false);
  assert.equal(view.areas.find((a) => a.name === "root").hasBrief, true);
});

test("three files called shallow.ts get three different labels", () => {
  const root = zustandShaped();
  const { view } = render(root);
  const label = (p) => view.nodes.find((n) => n.id === p).label;
  const labels = ["src/shallow.ts", "src/react/shallow.ts", "src/vanilla/shallow.ts"].map(label);
  assert.equal(new Set(labels).size, 3, labels.join(", "));
  assert.deepEqual(labels, ["src/shallow.ts", "react/shallow.ts", "vanilla/shallow.ts"]);
  assert.equal(label("src/types.ts"), "types.ts", "a unique name stays short");
  const skills = view.nodes.filter((n) => n.path.endsWith("/SKILL.md")).map((n) => n.label).sort();
  assert.deepEqual(skills, ["add-test/SKILL.md", "type-check/SKILL.md"]);
});

// ── 6. a shallow clone ───────────────────────────────────────────────────────────────────────────

test("a shallow clone reports churn as unavailable, not as a table of ones", () => {
  const origin = zustandShaped();
  const root = tempDir("cortex-view-shallow-");
  execFileSync("git", ["clone", "-q", "--depth", "1", "file://" + resolve(origin).replace(/\\/g, "/"), root], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const { view } = render(root);
  assert.equal(view.overview.shallow, true);
  assert.match(view.overview.churn.unavailable, /shallow clone/);
  assert.equal(view.gaps.churn.known, false);
  assert.match(view.gaps.churn.reason, /shallow clone/);
  assert.deepEqual(view.gaps.hot, [], "no hot spots are invented from a single commit");
  // The untested list is still there, ranked by what leans on it instead.
  assert.ok(view.gaps.untested.length > 0);
  const inbound = view.gaps.untested.map((u) => u.inbound);
  assert.deepEqual(inbound, [...inbound].sort((a, b) => b - a), "ranked by inbound imports");

  // The unshallow origin is unaffected: two commits touched vanilla.ts, so churn is a signal there.
  const full = render(origin).view;
  assert.equal(full.gaps.churn.known, true);
  assert.ok(full.gaps.hot.length > 0);
});
