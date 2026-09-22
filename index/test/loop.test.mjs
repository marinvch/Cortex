import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync as fsExists, readFileSync as fsRead } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectCommands, readLoopState, loopPlan, LOOP_ARTIFACTS, STAGES } from "../lib/loop.mjs";

function repo(build) {
  const root = mkdtempSync(join(tmpdir(), "cortex-loop-"));
  const put = (rel, body = "x") => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  };
  build({ root, put });
  return root;
}


const indexOf = (paths, extra = {}) => ({
  version: "1",
  files: paths.map((p) => ({ path: p })),
  stats: { files: paths.length, tests: 0 },
  ...extra,
});

// ---------------------------------------------------------------------------
// detectCommands — the fact the whole Test stage rests on
// ---------------------------------------------------------------------------

test("a declared npm script becomes the command, verbatim", () => {
  const root = repo(({ put }) =>
    put("package.json", JSON.stringify({ scripts: { test: "vitest run", build: "tsc", lint: "eslint ." } })),
  );
  assert.deepEqual(detectCommands(root), { build: "npm run build", test: "npm test", lint: "npm run lint" });
  rmSync(root, { recursive: true, force: true });
});

test("a script that is declared empty is not a command", () => {
  // `"test": ""` is a field that exists and runs nothing. Treating presence as declaration is how a
  // CLAUDE.md ends up telling an agent to run a script that exits 0 without testing anything.
  const root = repo(({ put }) => put("package.json", JSON.stringify({ scripts: { test: "   " } })));
  assert.equal(detectCommands(root).test, null);
  rmSync(root, { recursive: true, force: true });
});

test("a manifest that cannot be parsed reports nothing rather than something wrong", () => {
  const root = repo(({ put }) => put("package.json", "{ not json"));
  assert.deepEqual(detectCommands(root), { build: null, test: null, lint: null });
  rmSync(root, { recursive: true, force: true });
});

test("a Makefile target becomes the command", () => {
  const root = repo(({ put }) => put("Makefile", "build:\n\tgo build ./...\ntest:\n\tgo test ./...\n"));
  const cmds = detectCommands(root);
  assert.equal(cmds.build, "make build");
  assert.equal(cmds.test, "make test");
  rmSync(root, { recursive: true, force: true });
});

test(".PHONY names targets without defining one, and is not mistaken for a target", () => {
  // `.PHONY: test build` is the single most common line in a Makefile. Matching it would report
  // `make test` for a Makefile that defines no test target at all.
  const root = repo(({ put }) => put("Makefile", ".PHONY: test build lint\n"));
  assert.deepEqual(detectCommands(root), { build: null, test: null, lint: null });
  rmSync(root, { recursive: true, force: true });
});

test("a variable assignment is not a target", () => {
  const root = repo(({ put }) => put("Makefile", "test := whatever\nbuild ?= no\n"));
  assert.deepEqual(detectCommands(root), { build: null, test: null, lint: null });
  rmSync(root, { recursive: true, force: true });
});

test("make wins over npm when a repo declares both", () => {
  // A repo carrying a Makefile beside a package.json is almost always wrapping the scripts in it,
  // and the wrapper is the command a human on the team actually types.
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { test: "jest" } }));
    put("Makefile", "test:\n\tmake -C sub test\n");
  });
  assert.equal(detectCommands(root).test, "make test");
  rmSync(root, { recursive: true, force: true });
});

test("make does not erase an npm script it has no target for", () => {
  // The merge order is what does this; a naive `fromMake` last would blank `lint` to undefined.
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { lint: "eslint ." } }));
    put("Makefile", "test:\n\techo hi\n");
  });
  const cmds = detectCommands(root);
  assert.equal(cmds.test, "make test");
  assert.equal(cmds.lint, "npm run lint");
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// greenfield — an unbuilt index is an unanswered question
// ---------------------------------------------------------------------------

test("a missing index never makes a repo greenfield", () => {
  // Shipped once: `stats.files ?? 0` was 0 with no index and the header announced "no code yet"
  // over several hundred files. Absence of a measurement is not a measurement of absence.
  const root = repo(({ put }) => put("src/a.js"));
  const s = readLoopState(root, null);
  assert.equal(s.greenfield, false);
  assert.equal(s.indexed, false);
  rmSync(root, { recursive: true, force: true });
});

test("an index reporting zero files is greenfield", () => {
  const root = repo(() => {});
  const s = readLoopState(root, indexOf([]));
  assert.equal(s.greenfield, true);
  assert.equal(s.indexed, true);
  rmSync(root, { recursive: true, force: true });
});

test("an index with files is not greenfield", () => {
  const root = repo(({ put }) => put("src/a.js"));
  assert.equal(readLoopState(root, indexOf(["src/a.js"])).greenfield, false);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// presence is a file fact, never a quality judgment
// ---------------------------------------------------------------------------

test("a hollow REVIEW.md still counts as present", () => {
  // Silently replacing a file someone wrote is the worse failure, so presence never grades content.
  const root = repo(({ put }) => put("REVIEW.md", "\n"));
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  assert.ok(plan.present.some((e) => e.id === "review"));
  assert.ok(!plan.missing.some((e) => e.id === "review"));
  rmSync(root, { recursive: true, force: true });
});

test("an empty directory is not a served artifact", () => {
  const root = repo(({ root: r }) => mkdirSync(join(r, "intent"), { recursive: true }));
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  assert.ok(plan.missing.some((e) => e.id === "intent"), "an empty intent/ is still missing");
  rmSync(root, { recursive: true, force: true });
});

test("the verification block is found by heading, not by CLAUDE.md existing", () => {
  const bare = repo(({ put }) => put("CLAUDE.md", "# Project\nSome prose.\n"));
  assert.equal(readLoopState(bare, null).verification, false);
  rmSync(bare, { recursive: true, force: true });

  const full = repo(({ put }) => put("CLAUDE.md", "# Project\n\n## Verifying your work\n\n- Test: make test\n"));
  assert.equal(readLoopState(full, null).verification, true);
  rmSync(full, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// no evidence sentence may render a hole
// ---------------------------------------------------------------------------

test("no why() renders null or undefined, for any row, on any shape", () => {
  // "null runs here — a verdict from a fresh context…" shipped on the first real run. Asserted over
  // every row against several states rather than over the one sentence that broke, because a test
  // naming one symptom passes for every other way of failing.
  const shapes = [
    { name: "bare", build: () => {}, index: null },
    { name: "greenfield", build: () => {}, index: indexOf([]) },
    { name: "code, no manifest", build: ({ put }) => put("src/a.js"), index: indexOf(["src/a.js"]) },
    {
      name: "full",
      build: ({ put }) => {
        put("package.json", JSON.stringify({ scripts: { test: "jest", build: "tsc", lint: "eslint ." } }));
        put("REVIEW.md");
        put("AGENTS.md");
        put("CLAUDE.md");
        put(".github/workflows/ci.yml");
      },
      index: indexOf(["src/gen/api.ts", "dist/out.js"], { stack: { languages: ["typescript"], frameworks: [], data: [], services: [], test: ["jest"], delivery: [], manifests: ["package.json"] } }),
    },
  ];

  for (const shape of shapes) {
    const root = repo(shape.build);
    const s = readLoopState(root, shape.index);
    for (const row of LOOP_ARTIFACTS) {
      const why = row.why(s);
      assert.equal(typeof why, "string", `${row.id} on ${shape.name}: why is not a string`);
      assert.ok(why.trim().length > 0, `${row.id} on ${shape.name}: why is empty`);
      assert.doesNotMatch(why, /\bnull\b|\bundefined\b|\bNaN\b/, `${row.id} on ${shape.name}: "${why}"`);
    }
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// the rows themselves
// ---------------------------------------------------------------------------

test("every artifact declares a stage that exists, and a rank that orders it", () => {
  for (const row of LOOP_ARTIFACTS) {
    assert.ok(STAGES.includes(row.stage), `${row.id}: stage "${row.stage}" is not one of the six`);
    assert.equal(typeof row.rank, "number", `${row.id}: no rank`);
    assert.ok(row.paths.length > 0, `${row.id}: names no path`);
    assert.ok(row.brief.length > 20, `${row.id}: brief is too thin to write from`);
  }
});

test("ranks are unique, so the walk order cannot depend on sort stability", () => {
  const ranks = LOOP_ARTIFACTS.map((r) => r.rank);
  assert.equal(new Set(ranks).size, ranks.length, "two artifacts share a rank");
});

test("every blocked row, on every shape, names at least one unmet prerequisite", () => {
  // The first version of this test read `(row.needs ?? []).length`, which stopped meaning anything
  // the moment `needs` became a function — a function's length is its arity, so it passed for any
  // row at all. Asserted through the plan instead, which is what a user actually sees.
  const shapes = [
    () => {},
    ({ put }) => put("src/a.js"),
    ({ put }) => put(".github/workflows/ci.yml"),
    ({ put }) => { put("REVIEW.md"); put("AGENTS.md"); },
  ];
  for (const build of shapes) {
    for (const index of [null, indexOf([]), indexOf(["src/a.js"])]) {
      const root = repo(build);
      for (const e of loopPlan(root, index).blocked) {
        assert.ok(e.needs.length > 0, `${e.id} is blocked and names nothing it is waiting on`);
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a blocked row names only the prerequisites that are unmet", () => {
  // Seen on `got` and `fzf`: evals printed ".github/workflows is present" above "needs: a CI
  // system". It was blocked on the missing AGENTS.md, and it named the one prerequisite already met.
  const root = repo(({ put }) => put(".github/workflows/ci.yml"));
  const evals = loopPlan(root, indexOf(["src/a.js"])).blocked.find((e) => e.id === "evals");
  assert.ok(evals, "evals is blocked on a repo with CI and no agent docs");
  assert.ok(!evals.needs.some((n) => /CI system/.test(n)), `names a met prerequisite: ${evals.needs.join("; ")}`);
  assert.ok(evals.needs.some((n) => /AGENTS\.md/.test(n)), "and names the one that is actually missing");
  rmSync(root, { recursive: true, force: true });
});

test("the brief cites the project's own manifest before a nested example's", () => {
  // Seen on `flask`: `examples/celery/pyproject.toml` sorts before `pyproject.toml`, so the evidence
  // named a sample app's manifest as the source of the project's stack.
  const root = repo(() => {});
  const stack = {
    languages: ["python"], frameworks: ["flask"], data: [], services: [], test: [], delivery: [],
    manifests: ["examples/celery/pyproject.toml", "examples/celery/requirements.txt", "pyproject.toml"],
  };
  const s = readLoopState(root, indexOf(["src/a.py"], { stack }));
  const why = LOOP_ARTIFACTS.find((r) => r.id === "brief").why(s);
  assert.match(why, /read from pyproject\.toml/, why);
  rmSync(root, { recursive: true, force: true });
});

test("blocked rows carry their needs through the plan, not just the row", () => {
  const root = repo(({ put }) => put("src/a.js"));
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  for (const e of plan.blocked) {
    assert.ok(e.needs.length > 0, `${e.id} is blocked and the plan does not say what it needs`);
  }
  rmSync(root, { recursive: true, force: true });
});

test("blocked artifacts do not hold complete open", () => {
  // A repo with no CI is legitimately finished without an eval suite. Reporting it incomplete
  // forever would train the reader to ignore the number.
  const root = repo(({ put }) => {
    put("AGENTS.md");
    put("CLAUDE.md");
    put("REVIEW.md");
    put("intent/README.md");
  });
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  assert.equal(plan.complete, true, `still missing: ${plan.missing.map((e) => e.id).join(", ")}`);
  assert.ok(plan.blocked.length > 0, "and some rows really were blocked");
  rmSync(root, { recursive: true, force: true });
});

test("reading the plan writes nothing", () => {
  const root = repo(({ put }) => put("src/a.js"));
  loopPlan(root, indexOf(["src/a.js"]));
  readLoopState(root, null);
  assert.equal(fsExists(join(root, ".cortex")), false);
  rmSync(root, { recursive: true, force: true });
});

test("every template a row or the /cortex skill names exists on disk", () => {
  // `/cortex` applies from templates/loop/ in step 7, after the user has already said yes. A
  // renamed template would surface there — mid-apply, with half the chain written — rather than here.
  const here = new URL("../../templates/loop/", import.meta.url);
  for (const row of LOOP_ARTIFACTS) {
    if (!row.template) continue;
    assert.ok(fsExists(new URL(row.template, here)), `${row.id}: templates/loop/${row.template} is missing`);
  }
  const skill = fsRead(new URL("../../skills/cortex/SKILL.md", import.meta.url), "utf8");
  const table = skill.slice(skill.indexOf("| Template | Lands at |"), skill.indexOf("**Never invent a command.**"));
  const named = [...table.matchAll(/^\| `([^`]+)`(?:, `([^`]+)`)? \|/gm)].flatMap((m) => [m[1], m[2]]).filter(Boolean);
  assert.ok(named.length >= 8, `parsed only ${named.length} template names from the skill's table`);
  for (const name of named) {
    assert.ok(fsExists(new URL(name, here)), `the /cortex skill names templates/loop/${name}, which does not exist`);
  }
});

