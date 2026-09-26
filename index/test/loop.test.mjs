import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync as fsExists, readFileSync as fsRead } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectCommands, detectFormatters, readLoopState, loopPlan, LOOP_ARTIFACTS, STAGES } from "../lib/loop.mjs";

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

// The package manager is read off the repo, because `npm test` in a pnpm workspace installs
// nothing it can resolve and fails on the first workspace dependency.

test("a pnpm lockfile makes the scripts pnpm commands", () => {
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { build: "tsc", test: "vitest run", lint: "eslint ." } }));
    put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  });
  assert.deepEqual(detectCommands(root), { build: "pnpm run build", test: "pnpm test", lint: "pnpm run lint" });
  rmSync(root, { recursive: true, force: true });
});

test("a pnpm workspace with no lockfile committed is still pnpm", () => {
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { test: "pnpm -r test" } }));
    put("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
  });
  assert.equal(detectCommands(root).test, "pnpm test");
  rmSync(root, { recursive: true, force: true });
});

test("the packageManager field wins over a stale lockfile", () => {
  // Corepack runs whatever `packageManager` names; a package-lock.json left over from before the
  // switch is the file that is wrong, not the field.
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ packageManager: "pnpm@9.15.9", scripts: { build: "x" } }));
    put("package-lock.json", "{}");
  });
  assert.equal(detectCommands(root).build, "pnpm run build");
  rmSync(root, { recursive: true, force: true });
});

test("yarn and bun lockfiles select their own runner", () => {
  const yarn = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { test: "jest", build: "tsc" } }));
    put("yarn.lock", "");
  });
  assert.deepEqual(detectCommands(yarn), { build: "yarn run build", test: "yarn test", lint: null });
  rmSync(yarn, { recursive: true, force: true });

  for (const lock of ["bun.lockb", "bun.lock"]) {
    const bun = repo(({ put }) => {
      put("package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
      put(lock, "");
    });
    // `bun test` is Bun's own test runner, not the script — only `bun run test` runs what is declared.
    assert.equal(detectCommands(bun).test, "bun run test", lock);
    rmSync(bun, { recursive: true, force: true });
  }
});

test("a plain package-lock.json stays npm", () => {
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { test: "jest" } }));
    put("package-lock.json", "{}");
  });
  assert.equal(detectCommands(root).test, "npm test");
  rmSync(root, { recursive: true, force: true });
});

// JVM build files declare their lifecycle: a pom.xml always has `verify` and `test`, a Gradle build
// always has `build` and `test`. The wrapper is preferred because it pins the version CI runs.

test("the Maven wrapper beside a pom.xml becomes the command", () => {
  const root = repo(({ put }) => {
    put("pom.xml", "<project></project>");
    put("mvnw", "#!/bin/sh\n");
    put(".mvn/wrapper/maven-wrapper.properties", "distributionUrl=x\n");
  });
  assert.deepEqual(detectCommands(root), { build: "./mvnw -q verify", test: "./mvnw test", lint: null });
  rmSync(root, { recursive: true, force: true });
});

test("a pom.xml with no wrapper falls back to mvn", () => {
  const root = repo(({ put }) => put("pom.xml", "<project></project>"));
  assert.deepEqual(detectCommands(root), { build: "mvn -q verify", test: "mvn test", lint: null });
  rmSync(root, { recursive: true, force: true });
});

test("a wrapper with no pom.xml declares nothing", () => {
  // A stray mvnw with nothing to build is not a Maven project; `./mvnw test` would fail at once.
  const root = repo(({ put }) => put("mvnw", "#!/bin/sh\n"));
  assert.deepEqual(detectCommands(root), { build: null, test: null, lint: null });
  rmSync(root, { recursive: true, force: true });
});

test("the Gradle wrapper beside a build file becomes the command", () => {
  const root = repo(({ put }) => {
    put("build.gradle.kts", "plugins { java }\n");
    put("gradlew", "#!/bin/sh\n");
  });
  assert.deepEqual(detectCommands(root), { build: "./gradlew build", test: "./gradlew test", lint: null });
  rmSync(root, { recursive: true, force: true });
});

test("a Gradle build with no wrapper falls back to gradle", () => {
  const root = repo(({ put }) => put("settings.gradle", "rootProject.name = 'x'\n"));
  assert.equal(detectCommands(root).test, "gradle test");
  rmSync(root, { recursive: true, force: true });
});

test("the root JVM build wins over a package.json it carries, and make still wins over both", () => {
  const jvm = repo(({ put }) => {
    put("pom.xml", "<project></project>");
    put("mvnw", "#!/bin/sh\n");
    put("package.json", JSON.stringify({ scripts: { test: "jest", lint: "eslint ." } }));
  });
  const cmds = detectCommands(jvm);
  assert.equal(cmds.test, "./mvnw test");
  assert.equal(cmds.lint, "npm run lint"); // nothing the pom declares, so the script stands
  rmSync(jvm, { recursive: true, force: true });

  const make = repo(({ put }) => {
    put("pom.xml", "<project></project>");
    put("Makefile", "test:\n\t./mvnw test\n");
  });
  assert.equal(detectCommands(make).test, "make test");
  rmSync(make, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// detectFormatters — what format-changed.sh may run, declared or nothing
// ---------------------------------------------------------------------------

test("a repo with no formatter config gets no formatter, so the hook stamps empty", () => {
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { format: "prettier --write ." } }));
    put("pyproject.toml", "[project]\nname = 'x'\n");
  });
  // A `format` script names no config: which formatter, on which files, is still a guess.
  assert.deepEqual(detectFormatters(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("each formatter is read from the config the formatter itself reads", () => {
  const prettier = "npx --no-install prettier --write --ignore-unknown";
  const cases = [
    [{ "go.mod": "module x\n" }, ["gofmt -w"]],
    [{ "pyproject.toml": "[tool.ruff]\nline-length = 100\n" }, ["ruff format --quiet"]],
    [{ "ruff.toml": "" }, ["ruff format --quiet"]],
    [{ "pyproject.toml": "[tool.black]\nline-length = 100\n" }, ["black --quiet"]],
    [{ ".prettierrc": "{}" }, [prettier]],
    [{ "package.json": JSON.stringify({ prettier: { semi: false } }) }, [prettier]],
  ];
  for (const [files, want] of cases) {
    const root = repo(({ put }) => { for (const [k, v] of Object.entries(files)) put(k, v); });
    assert.deepEqual(detectFormatters(root).map((f) => f.command), want, JSON.stringify(files));
    rmSync(root, { recursive: true, force: true });
  }
});

test("ruff wins over black, and Prettier's catch-all comes last so it shadows nothing", () => {
  const root = repo(({ put }) => {
    put("go.mod", "module x\n");
    put("pyproject.toml", "[tool.black]\n[tool.ruff]\n");
    put(".prettierrc.json", "{}");
  });
  const got = detectFormatters(root);
  assert.deepEqual(got.map((f) => f.glob), ["*.go", "*.py|*.pyi", "*"]);
  assert.match(got[1].command, /^ruff /);
  rmSync(root, { recursive: true, force: true });
});

test("an unparseable package.json says nothing about Prettier", () => {
  const root = repo(({ put }) => put("package.json", "{ not json"));
  assert.deepEqual(detectFormatters(root), []);
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

test("every hook script settings.hooks.json runs has a template, and the skill says where it lands", () => {
  // settings.hooks.json shipped a PostToolUse entry for format-changed.sh with no template behind
  // it, so every repo /cortex stamped ran a hook that did not exist on each edit. The property, not
  // the one file: any .claude/hooks/<script> a command names must be a template /cortex can write.
  const here = new URL("../../templates/loop/", import.meta.url);
  const settings = JSON.parse(fsRead(new URL("settings.hooks.json", here), "utf8"));
  const commands = Object.values(settings.hooks).flat().flatMap((m) => m.hooks.map((h) => h.command));
  const scripts = commands.map((c) => /\.claude\/hooks\/([^\s"']+)/.exec(c)?.[1]).filter(Boolean);
  assert.ok(scripts.length >= 2, `parsed only ${scripts.length} hook scripts from settings.hooks.json`);
  const skill = fsRead(new URL("../../skills/cortex/SKILL.md", import.meta.url), "utf8");
  for (const name of scripts) {
    assert.ok(fsExists(new URL(name, here)), `settings.hooks.json runs .claude/hooks/${name}, but templates/loop/${name} does not exist`);
    assert.ok(skill.includes(`| \`${name}\` |`), `the /cortex skill never says where ${name} lands`);
  }
});

test("every hook command runs its script through bash, quoted — never relying on the executable bit", () => {
  // /cortex writes these scripts with a file-write tool, which sets no mode bits, and a file created
  // on Windows is committed as 100644 — so a teammate cloning on macOS or Linux gets a script the
  // kernel refuses to exec, and the hook fails with "permission denied" on every edit. A chmod at
  // stamp time would not survive that commit. Invoking through `bash` makes the bit irrelevant on
  // every machine, and the quotes keep a project path with a space in it from splitting in two.
  const here = new URL("../../templates/loop/", import.meta.url);
  const settings = JSON.parse(fsRead(new URL("settings.hooks.json", here), "utf8"));
  const commands = Object.values(settings.hooks).flat().flatMap((m) => m.hooks.map((h) => h.command));
  const scriptCommands = commands.filter((c) => /\.sh\b/.test(c));
  assert.ok(scriptCommands.length >= 2, "both hook scripts are found");
  for (const c of scriptCommands) {
    assert.match(c, /^bash "\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/hooks\/[\w.-]+\.sh"$/, `hook command must be bash "<path>", got: ${c}`);
  }
});

test("the verifier template cannot reach the editing tools", () => {
  // It exists to check work it did not write, and its prose says "change nothing". Prose is a
  // request; disallowedTools is the part Claude Code enforces, so a verifier cannot patch what it
  // finds even if a later edit to `tools:` widens what it inherits.
  const src = fsRead(new URL("../../templates/loop/verifier.md", import.meta.url), "utf8");
  const fm = src.slice(0, src.indexOf("\n---", 4));
  const denied = (/^disallowedTools:\s*(.+)$/m.exec(fm)?.[1] ?? "").split(/[,\s]+/).filter(Boolean);
  for (const tool of ["Edit", "Write", "NotebookEdit"]) {
    assert.ok(denied.includes(tool), `verifier.md does not deny ${tool}`);
  }
  assert.match(src, /Change nothing/);
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

// ---------------------------------------------------------------------------
// agent-evals.yml — the stamped workflow must be one GitHub will run
// ---------------------------------------------------------------------------

const EVALS_TEMPLATE = new URL("../../templates/loop/agent-evals.yml", import.meta.url);

// What `/cortex` does to the template: each bare `{{NAME}}` filled, and the setup placeholder's line
// replaced by steps copied from the repo's own CI, at that line's indentation.
function stampEvals(src, { test, setup }) {
  return src
    .replace(/^([ \t]*)\{\{SETUP_STEPS\}\}[ \t]*$/m, (_, pad) => setup.map((l) => pad + l).join("\n"))
    .replaceAll("{{TEST_CMD}}", test);
}

const JAVA_SETUP = ["- uses: actions/setup-java@v4", "  with:", "    distribution: temurin", "    java-version: 21"];

test("agent-evals.yml, stamped, parses as a workflow with every field a job needs", async () => {
  // Found by the Harbor proving ground: on a Spring repo the stamped workflow could not have passed
  // a single run. It is checked as parsed structure, because a regex over the text would pass a step
  // list that GitHub rejects before any job starts.
  const { parseYaml } = await import("./yaml-lite.mjs");
  const src = fsRead(EVALS_TEMPLATE, "utf8");
  const stamped = stampEvals(src, { test: "./mvnw test", setup: JAVA_SETUP });
  assert.doesNotMatch(stamped.replace(/\$\{\{[^}]*\}\}/g, ""), /\{\{/, "a Cortex placeholder is left unfilled");

  const wf = parseYaml(stamped);
  assert.equal(wf.name, "agent-evals");
  assert.ok(wf.on?.pull_request?.paths?.includes("AGENTS.md"), "runs when the agent's config changes");
  assert.deepEqual(wf.permissions, { contents: "read" }, "least privilege: it reads the repo and nothing else");

  const job = wf.jobs?.cases;
  assert.equal(job?.["runs-on"], "ubuntu-latest");
  assert.ok(Number.isInteger(job["timeout-minutes"]), "a run that hangs is cut off, not billed for six hours");
  assert.ok(Array.isArray(job.steps) && job.steps.length >= 4);
  for (const step of job.steps) assert.ok(step.uses || step.run, `a step with neither uses nor run: ${JSON.stringify(step)}`);

  const uses = job.steps.map((s) => s.uses).filter(Boolean);
  assert.ok(uses[0]?.startsWith("actions/checkout@"), "checkout comes first");
  assert.ok(uses.includes("actions/setup-java@v4"), "the repo's own toolchain setup landed as a step");

  const install = job.steps.find((s) => /claude\.ai\/install\.sh/.test(s.run ?? ""));
  assert.ok(install, "Claude Code is installed with the documented native installer");
  assert.match(install.run, /GITHUB_PATH/, "and put on PATH for the steps after it");

  const cases = job.steps.find((s) => /claude -p/.test(s.run ?? ""));
  assert.ok(cases, "a step runs the cases");
  assert.equal(cases.env?.ANTHROPIC_API_KEY, "${{ secrets.ANTHROPIC_API_KEY }}");
  const run = cases.run;
  // The test command as a prefix rule: an exact rule denies `./mvnw test -Dtest=OneTest`.
  assert.match(run, /--allowedTools "Read,Edit,Bash\(\.\/mvnw test \*\)"/);
  assert.match(run, /--permission-mode dontAsk/, "anything not allowed is denied, never left waiting on a prompt");
  // --bare skips CLAUDE.md, skills and hooks — the very configuration these cases regress.
  assert.doesNotMatch(run, /--bare/);
  assert.match(run, /bash "\$dir\/accept\.sh"/, "accept.sh runs through bash, so a missing executable bit cannot fail it");
  assert.match(run, /shopt -s nullglob/, "an empty evals/cases/ is not iterated as a literal glob");
  assert.match(run, /-z "\$\{ANTHROPIC_API_KEY:-\}"/, "a run without the secret (a fork's PR) is skipped, not failed");
  assert.doesNotMatch(run, /set -e/, "one failing case must not abort the cases after it");
  assert.match(run, /reset --hard/, "each case starts from the committed tree, not the last case's edits");
});

test("an unfilled setup placeholder is a parse error, not a workflow that runs without its toolchain", async () => {
  const { parseYaml } = await import("./yaml-lite.mjs");
  const src = fsRead(EVALS_TEMPLATE, "utf8").replaceAll("{{TEST_CMD}}", "./mvnw test");
  assert.throws(() => parseYaml(src), /SETUP_STEPS/);
});

test("agent-evals.yml carries only the placeholders the /cortex skill tells it how to fill", () => {
  const src = fsRead(EVALS_TEMPLATE, "utf8").replace(/\$\{\{[^}]*\}\}/g, "");
  const found = [...new Set([...src.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(found, ["SETUP_STEPS", "TEST_CMD"]);
  // Each appears once, where it is filled. A placeholder quoted in a comment would be "filled" too,
  // and the comment would then say the command is the placeholder.
  for (const name of found) assert.equal(src.split(`{{${name}}}`).length - 1, 1, `{{${name}}} appears more than once`);
  const skill = fsRead(new URL("../../skills/cortex/SKILL.md", import.meta.url), "utf8");
  const row = skill.split("\n").find((l) => l.startsWith("| `agent-evals.yml`"));
  for (const name of found) assert.ok(row?.includes(name), `the skill's agent-evals.yml row does not say how to fill {{${name}}}`);
});

