import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync as fsExists, readFileSync as fsRead } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectCommands, detectFormatters, readLoopState, loopPlan, LOOP_ARTIFACTS, STAGES } from "../lib/loop.mjs";
import { mergeSharedPlugin, teamServed } from "../lib/shared-plugin.mjs";

// The loop reads this machine's CORTEX_PROFILE for its team-plugin row. These tests describe a repo,
// not a machine, so a developer on a work profile must get the same answers as CI. A test that is
// about the profile states it through `teamServed(root, env)`.
delete process.env.CORTEX_PROFILE;

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

// Lint is found by the NAME families a repo actually uses, not one exact word. pmndrs/zustand and
// pmndrs/jotai both run `eslint .` as `test:lint` — one leg of `test: pnpm run "/^test:.*/"` — and
// both got `lint: null`, so the verification block had no lint row and the user had to supply it.

const lintOf = (scripts) => {
  const root = repo(({ put }) => put("package.json", JSON.stringify({ scripts })));
  const lint = detectCommands(root).lint;
  rmSync(root, { recursive: true, force: true });
  return lint;
};

test("a `test:lint` script is the lint command when no plain `lint` exists", () => {
  assert.equal(
    lintOf({ test: 'pnpm run "/^test:.*/"', "test:lint": "eslint .", "test:spec": "vitest run", "fix:lint": "eslint . --fix" }),
    "npm run test:lint",
  );
});

test("the aggregate `lint` wins over its own parts and over `test:lint`", () => {
  assert.equal(lintOf({ lint: "run-p lint:*", "lint:js": "eslint .", "lint:css": "stylelint ." }), "npm run lint");
  assert.equal(lintOf({ lint: "eslint .", "test:lint": "eslint ." }), "npm run lint");
});

test("a single `lint:*` script stands in for the aggregate; several with no aggregate are not guessed", () => {
  assert.equal(lintOf({ "lint:ts": "eslint ." }), "npm run lint:ts");
  // Picking one of two would print a lint command that checks half the repo and exits 0.
  assert.equal(lintOf({ "lint:js": "eslint .", "lint:css": "stylelint ." }), null);
});

test("a fixer is never the lint command — it rewrites files instead of failing on them", () => {
  assert.equal(lintOf({ "fix:lint": "eslint . --fix", "lint:fix": "eslint . --fix" }), null);
  assert.equal(lintOf({ "lint:ts": "eslint .", "lint:fix": "eslint . --fix" }), "npm run lint:ts");
});

test("a lint-named script still outranks the older `check` fallback", () => {
  assert.equal(lintOf({ check: "tsc --noEmit", "test:lint": "eslint ." }), "npm run test:lint");
  assert.equal(lintOf({ check: "tsc --noEmit" }), "npm run check");
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

// ---------------------------------------------------------------------------
// a test command must exit — a watcher is never named as one
// ---------------------------------------------------------------------------

// Found on a Vite app with `"test": "vitest"` and `"test:run": "vitest run"`: `npm test` starts
// watch mode in a terminal and never exits, so the verification block, the verifier and the evals
// workflow all named a command that hangs. The shapes below are the ones real repos use:
// bulletproof-react's apps (`vitest`, no one-shot), vitest's own examples (`vitest` + `test:run`),
// a CRA app (`cross-env … react-scripts test`), zustand (`pnpm run "/^test:.*/"`).

const withScripts = (scripts, extra = () => {}) => {
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts }));
    extra(put);
  });
  const s = readLoopState(root, null);
  rmSync(root, { recursive: true, force: true });
  return { test: s.commands.test, note: s.commandNotes.test ?? null, s };
};

test("a watching test script gives way to the one-shot script beside it, and says why", () => {
  const got = withScripts({ test: "vitest", "test:run": "vitest run" });
  assert.equal(got.test, "npm run test:run");
  assert.match(got.note, /`test` script \(`vitest`\) starts a watcher/);
  assert.match(got.note, /`test:run` — which runs once/);
  for (const [scripts, want] of [
    [{ test: "jest --watch", "test:ci": "jest --ci" }, "npm run test:ci"],
    [{ test: "jest --watchAll", "test:once": "jest" }, "npm run test:once"],
    [{ test: "ng test", "test:ci": "ng test --watch=false" }, "npm run test:ci"],
  ]) {
    assert.equal(withScripts(scripts).test, want, JSON.stringify(scripts));
  }
});

test("a watching test script with no one-shot beside it is not a test command", () => {
  // Emitting `vitest run` here would be a command nobody declared — the config it would need, the
  // workspace it would run in, are exactly what cannot be proved. The ritual asks instead.
  const got = withScripts({ test: "vitest", build: "tsc" });
  assert.equal(got.test, null);
  assert.match(got.note, /no script that runs once is declared.*ask for a test command that exits/);
  const why = LOOP_ARTIFACTS.find((r) => r.id === "verification").why(got.s);
  assert.doesNotMatch(why, /npm test/, why);
  assert.match(why, /starts a watcher/, "and the row that writes the command down says why it has none");
  assert.equal(withScripts({ test: "cross-env PORT=4100 react-scripts test --env=jsdom" }).test, null, "CRA's runner watches");
  assert.equal(withScripts({ test: "nodemon --exec mocha" }).test, null);
});

test("a one-shot candidate that itself watches is not chosen", () => {
  assert.equal(withScripts({ test: "vitest", "test:run": "vitest --ui" }).test, null);
  assert.equal(withScripts({ test: "vitest", "test:run": "vitest --ui", "test:ci": "vitest run" }).test, "npm run test:ci");
});

test("a runner told to run once is taken at its word", () => {
  for (const scripts of [
    { test: "vitest run" },
    { test: "vitest --run" },
    { test: "vitest --no-watch --config=vitest.config.unit.mts" },
    { test: "npx vitest --config vitest.config.ts run" },
    { test: "CI=true vitest" },
    { test: "CI=true react-scripts test" },
    { test: "react-scripts test --watchAll=false" },
    { test: "jest --watchAll=false" },
    { test: "jest --watchman" },
    { test: "jest" },
    { test: "node --test" },
  ]) {
    const got = withScripts(scripts);
    assert.equal(got.test, "npm test", JSON.stringify(scripts));
    assert.equal(got.note, null, `a script that exits needs no explanation: ${JSON.stringify(scripts)}`);
  }
});

test("a test script is followed through the scripts it runs in the same manifest", () => {
  assert.equal(withScripts({ test: "npm run test:unit", "test:unit": "vitest" }).test, null);
  assert.equal(withScripts({ test: "pnpm test:unit", "test:unit": "vitest --project a" }).test, null);
  assert.equal(withScripts({ test: "yarn vitest" }).test, null, "a runner in front of a binary is the binary");
  assert.equal(withScripts({ test: "npm run test:unit -- --watch", "test:unit": "jest" }).test, null);
  assert.equal(withScripts({ test: "run-s test:*", "test:a": "mocha", "test:b": "mocha --watch" }).test, null);
  assert.equal(withScripts({ test: "run-s test:*", "test:a": "mocha", "test:a:b": "mocha --watch" }).test, "npm test", "run-s `*` stops at a colon");
  // zustand's shape: every leg of the regex runs once, so the aggregate does.
  const zustand = {
    test: 'pnpm run "/^test:.*/"', "test:format": "prettier . --list-different", "test:types": "tsc --noEmit",
    "test:lint": "eslint .", "test:spec": "vitest run",
  };
  assert.equal(withScripts(zustand, (put) => put("pnpm-lock.yaml", "")).test, "pnpm test");
  assert.equal(withScripts({ ...zustand, "test:spec": "vitest" }).test, null, "and one watching leg makes it a watcher");
  // Another package's script is a workspace question: taken at its word, the documented limit.
  // vitest's own root runs `pnpm --filter test-unit test:threads`; `-r` runs every package's copy
  // of a script, not this manifest's.
  assert.equal(withScripts({ test: "pnpm --filter test-unit test:threads" }).test, "npm test");
  assert.equal(withScripts({ test: "pnpm -r test:unit", "test:unit": "vitest" }).test, "npm test");
  // A script that names itself does not loop.
  assert.equal(withScripts({ test: "npm test" }).test, "npm test");
});

test("the package manager still owns the runner when a one-shot script is chosen", () => {
  const scripts = { test: "vitest", "test:run": "vitest run" };
  assert.equal(withScripts(scripts, (put) => put("pnpm-lock.yaml", "")).test, "pnpm run test:run");
  assert.equal(withScripts(scripts, (put) => put("yarn.lock", "")).test, "yarn run test:run");
  assert.equal(withScripts(scripts, (put) => put("bun.lock", "")).test, "bun run test:run");
});

test("a Makefile test target wins over a watching script, and the script's note goes with it", () => {
  const got = withScripts({ test: "vitest" }, (put) => put("Makefile", "test:\n\tnpx vitest run\n"));
  assert.equal(got.test, "make test");
  assert.equal(got.note, null, "a note about a command nobody is told to run is noise");
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
    [{ "vendor.mod": "module x\n" }, ["gofmt -w"]],
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
// protected paths — a hook that blocks edits must block only what is really generated
// ---------------------------------------------------------------------------

// A directory NAME is a hint; the files in it are the evidence. pmndrs/zustand keeps two
// hand-written upgrade guides in `docs/reference/migrations/`, and the bare `migrations?/` pattern
// reported that as a generated path — so /cortex proposed a hook refusing edits to the repo's own
// documentation and listed it in REVIEW.md's do-not-report section.

const protectedOf = (paths) => {
  const root = repo(() => {});
  const got = readLoopState(root, indexOf(paths)).protectedPaths;
  rmSync(root, { recursive: true, force: true });
  return got;
};

test("a migrations directory holding only prose is not protected", () => {
  assert.deepEqual(
    protectedOf(["docs/reference/migrations/migrating-to-v4.md", "docs/reference/migrations/migrating-to-v5.md", "src/a.ts"]),
    [],
  );
  assert.deepEqual(protectedOf(["migrations/README.md"]), [], "a README alone is not a migration");
});

test("a migrations directory under docs/ is never protected, even with SQL in it", () => {
  // Sample SQL in a guide is an example a writer edits, not a migration a tool generated.
  assert.deepEqual(protectedOf(["docs/guides/migrations/001-example.sql"]), []);
  assert.deepEqual(protectedOf(["website/docs/migrations/upgrade.mdx", "doc/migrations/x.sql"]), []);
});

test("real migrations are still protected — SQL, ORM code, Rails and Prisma layouts", () => {
  assert.deepEqual(protectedOf(["prisma/migrations/20221021182747_init/migration.sql"]), ["prisma/migrations/"]);
  assert.deepEqual(protectedOf(["db/migrate/20240101_create_users.rb"]), ["db/migrate/"]);
  assert.deepEqual(protectedOf(["app/migrations/0001_initial.py", "app/migrations/README.md"]), ["app/migrations/"]);
  assert.deepEqual(protectedOf(["src/main/resources/db/migration/V1__init.sql"]), ["src/main/resources/db/migration/"]);
});

test("the other generated hints are unchanged by the migrations evidence rule", () => {
  assert.deepEqual(protectedOf(["dist/index.js", "src/__generated__/schema.ts"]), ["dist/", "src/__generated__/"]);
});

// Lockfiles are generated by definition, and no install protected one. The half a literal index
// cannot show: walk.mjs drops `*.lock`, `*-lock.json` and anything over its size cap, so on a real
// repo `yarn.lock`, `Cargo.lock` and a big `pnpm-lock.yaml` never reach index.files. These fixtures
// therefore put the lockfile on DISK and leave it out of the index, the way the walker does.

const protectedOnDisk = (onDisk, indexed) => {
  const root = repo(({ put }) => onDisk.forEach((p) => put(p)));
  const got = readLoopState(root, indexOf(indexed)).protectedPaths;
  rmSync(root, { recursive: true, force: true });
  return got;
};

test("a lockfile the walker dropped from the index is still protected", () => {
  for (const name of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb", "Cargo.lock",
    "poetry.lock", "composer.lock", "Gemfile.lock", "go.sum", "uv.lock", "npm-shrinkwrap.json"]) {
    assert.deepEqual(protectedOnDisk([name], ["src/a.js"]), [name], name);
  }
});

test("a lockfile is matched by its exact name, never a suffix", () => {
  const decoys = ["yarn.lock.md", "my-package-lock.json", "docs/Cargo.lock.txt", "go.sum.bak", "notpnpm-lock.yaml"];
  assert.deepEqual(protectedOnDisk(decoys, ["src/a.js", ...decoys]), []);
});

test("a nested lockfile is found beside the manifest the index saw", () => {
  // bulletproof-react keeps a yarn.lock per app; ripgrep has fuzz/Cargo.lock beside fuzz/Cargo.toml.
  assert.deepEqual(
    protectedOnDisk(["apps/web/yarn.lock", "fuzz/Cargo.lock"], ["apps/web/package.json", "fuzz/Cargo.toml", "src/a.rs"]),
    ["fuzz/Cargo.lock", "apps/web/yarn.lock"],
    "nearest first",
  );
  // One the index lists itself (go.sum is small and not a *.lock) needs no manifest beside it.
  assert.deepEqual(protectedOnDisk([], ["tools/go.sum"]), ["tools/go.sum"]);
});

test("lockfiles and generated trees are capped apart, so neither pushes the other off the list", () => {
  const trees = Array.from({ length: 9 }, (_, i) => `p${i}/dist/x.js`);
  const got = protectedOnDisk(["pnpm-lock.yaml"], trees);
  assert.ok(got.includes("pnpm-lock.yaml"), got.join(", "));
  assert.equal(got.filter((p) => p.endsWith("/")).length, 8, "the tree cap is unchanged");
});

test("a detected lockfile reaches REVIEW.md's do-not-report list and the hooks row", () => {
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    put("pnpm-lock.yaml");
  });
  const plan = loopPlan(root, indexOf(["package.json", "src/a.js"]));
  const all = [...plan.present, ...plan.missing, ...plan.blocked];
  assert.match(all.find((e) => e.id === "review").why, /pnpm-lock\.yaml/);
  const hooks = plan.missing.find((e) => e.id === "hooks");
  assert.ok(hooks, "a lockfile is hook work");
  assert.match(hooks.why, /protected paths to block: pnpm-lock\.yaml/);
  rmSync(root, { recursive: true, force: true });
});

// The Maven and Gradle wrappers are generated too: `mvn wrapper:wrapper` and `gradle wrapper` write
// them, and the next wrapper upgrade overwrites a hand edit. On spring-petclinic and every Maven repo
// of a Spring workspace the hooks row read "blocked — no generated paths" beside a committed `mvnw`
// (#482). Like a lockfile, a wrapper is found on DISK beside a build file, by its exact name: a
// dot-directory and a jar are what a walker drops, and there is often no index at all.

const MAVEN = ["pom.xml", "mvnw", "mvnw.cmd", ".mvn/wrapper/maven-wrapper.properties"];
const GRADLE = ["build.gradle.kts", "gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.properties"];

test("a committed Maven or Gradle wrapper is protected, with no index at all", () => {
  assert.deepEqual(protectedOnDisk(MAVEN, []), ["mvnw", "mvnw.cmd", ".mvn/wrapper/"]);
  assert.deepEqual(protectedOnDisk(GRADLE, []), ["gradlew", "gradlew.bat", "gradle/wrapper/"]);
  // spring-petclinic commits both.
  assert.deepEqual(
    protectedOnDisk([...MAVEN, ...GRADLE], ["pom.xml", "src/Main.java"]),
    ["gradlew", "gradlew.bat", "mvnw", "mvnw.cmd", ".mvn/wrapper/", "gradle/wrapper/"],
  );
});

test("a wrapper is protected only when it is there, and only the half that is", () => {
  assert.deepEqual(protectedOnDisk(["pom.xml", "build.gradle", "src/Main.java"], ["pom.xml"]), [], "a build file alone is not a wrapper");
  assert.deepEqual(protectedOnDisk(["pom.xml", "mvnw"], ["pom.xml"]), ["mvnw"], "no mvnw.cmd, no .mvn/wrapper/");
});

test("a wrapper is matched by its exact name and kind, never a suffix", () => {
  const decoys = ["mvnw.sh", "my-gradlew", "gradlew.old", "mvnw.cmd.bak", ".mvn/wrappers/x", ".mvn/wrapper.txt",
    "gradle/wrapper-docs/x", "docs/gradle/wrapper/x.properties", "src/mvnw"];
  assert.deepEqual(protectedOnDisk(["pom.xml", "build.gradle", ...decoys], ["pom.xml", "build.gradle", ...decoys]), []);
  // A directory called mvnw is not the script; a FILE called .mvn/wrapper is not the directory.
  assert.deepEqual(protectedOnDisk(["pom.xml", "mvnw/readme.txt", ".mvn/wrapper"], ["pom.xml"]), []);
});

test("a nested wrapper is found beside the build file the index saw", () => {
  // spring-guides/gs-rest-service keeps a complete/ and an initial/ project, each with its wrappers.
  const onDisk = ["complete/pom.xml", "complete/mvnw", "complete/.mvn/wrapper/maven-wrapper.properties",
    "initial/settings.gradle", "initial/gradlew"];
  assert.deepEqual(
    protectedOnDisk(onDisk, ["complete/pom.xml", "initial/settings.gradle"]),
    ["complete/mvnw", "complete/.mvn/wrapper/", "initial/gradlew"],
    "one project's wrapper together, nearest project first",
  );
  assert.deepEqual(protectedOnDisk(onDisk, []), [], "with no index only the root is asked");
});

test("the wrapper cap drops whole far projects, never the root's wrapper directory", () => {
  // Sorted flat by depth, `.mvn/wrapper/` (three segments) came after every nested gradlew (two),
  // and on gs-rest-service's four sample projects the cap cut every wrapper directory.
  const nested = ["a", "b", "c"].flatMap((d) => [`${d}/build.gradle`, `${d}/gradlew`, `${d}/gradlew.bat`, `${d}/gradle/wrapper/x`]);
  const got = protectedOnDisk([...MAVEN, ...nested], ["pom.xml", "a/build.gradle", "b/build.gradle", "c/build.gradle"]);
  assert.deepEqual(got.slice(0, 6), ["mvnw", "mvnw.cmd", ".mvn/wrapper/", "a/gradlew", "a/gradlew.bat", "a/gradle/wrapper/"]);
  assert.equal(got.length, 8, "the cap is unchanged");
});

test("wrappers are capped apart from lockfiles and trees, so a monorepo cannot push them off", () => {
  const locks = Array.from({ length: 9 }, (_, i) => `p${i}/yarn.lock`);
  const got = protectedOnDisk([...MAVEN, ...locks], [...locks.map((l) => l.replace("yarn.lock", "package.json")),
    ...Array.from({ length: 9 }, (_, i) => `q${i}/dist/x.js`)]);
  assert.ok(got.includes("mvnw") && got.includes(".mvn/wrapper/"), got.join(", "));
  assert.equal(got.filter((p) => p.endsWith("yarn.lock")).length, 8, "the lockfile cap is unchanged");
});

test("a committed Maven wrapper reaches REVIEW.md's do-not-report list and the hooks row", () => {
  const root = repo(({ put }) => MAVEN.forEach((p) => put(p)));
  const plan = loopPlan(root, null);
  const all = [...plan.present, ...plan.missing, ...plan.blocked];
  assert.match(all.find((e) => e.id === "review").why, /generated path\(s\) detected \(mvnw, mvnw\.cmd\)/);
  const hooks = plan.missing.find((e) => e.id === "hooks");
  assert.ok(hooks, "the wrapper is hook work, so the row is no longer blocked");
  assert.match(hooks.why, /protected paths to block: mvnw, mvnw\.cmd, \.mvn\/wrapper\//);
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
    put("CLAUDE.md", "# P\n\n## Working as a team\n\nThis repo has single-job agents.\n");
    put("REVIEW.md");
    put("intent/README.md");
  });
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  assert.equal(plan.complete, true, `still missing: ${plan.missing.map((e) => e.id).join(", ")}`);
  assert.ok(plan.blocked.length > 0, "and some rows really were blocked");
  rmSync(root, { recursive: true, force: true });
});

test("rows that write under .claude/ say so, and only those", () => {
  // The shape a headless /cortex leaves behind: everything outside .claude/ stamped, everything
  // inside refused by Claude Code's protected-path check. The ritual reads protectedWrites to tell
  // that apart from a row the user declined, so it must be on exactly the .claude/ rows.
  const root = repo(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    put("package-lock.json", "{}"); // hook work: without a path to protect, the hooks row does not apply
    put("AGENTS.md");
    put("CLAUDE.md", "# P\n\n## Verifying your work\n\n- Test: npm test\n");
    put("REVIEW.md");
    put("intent/README.md");
  });
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  const all = [...plan.present, ...plan.missing, ...plan.blocked];
  for (const e of all) {
    const expected = e.paths.filter((p) => p.startsWith(".claude/"));
    assert.deepEqual(e.protectedWrites, expected, e.id);
  }
  assert.deepEqual(
    plan.missing.filter((e) => e.protectedWrites.length).map((e) => e.id).sort(),
    ["hooks", "team", "verifier"],
    "the three .claude/ rows are what is left",
  );
  assert.ok(plan.missing.every((e) => e.protectedWrites.length), "and nothing else is missing");
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// a row promises only what a template provides
// ---------------------------------------------------------------------------

// The hooks row said "the hook that matters here is the test-file lock during a fix" on every repo
// with a test script and nothing to protect. No template implements a test-file lock, so /cortex
// stamped protected-paths.sh with an empty list and format-changed.sh with no case lines — two hooks
// that do nothing — and reported the row done.

const hooksRow = (build, index = indexOf(["src/a.js"])) => {
  const root = repo(build);
  const plan = loopPlan(root, index);
  rmSync(root, { recursive: true, force: true });
  for (const bucket of ["present", "missing", "blocked"]) {
    const e = plan[bucket].find((x) => x.id === "hooks");
    if (e) return { bucket, ...e, plan };
  }
  throw new Error("no hooks row");
};

test("with nothing to protect and no formatter, the hooks row does not apply — and says so", () => {
  const row = hooksRow(({ put }) => put("package.json", JSON.stringify({ scripts: { test: "node --test" } })));
  assert.equal(row.bucket, "blocked", "a test command is not hook work: no template acts on one");
  assert.match(row.why, /no hook has work to do here/);
  assert.ok(row.needs.some((n) => /formatter/.test(n) && /lockfile/.test(n)), row.needs.join("; "));
  assert.ok(!row.plan.missing.some((e) => e.id === "hooks"), "so the pass does not stamp two no-op hooks");
});

test("a hooks block already on disk does not make a row with no work served", () => {
  const row = hooksRow(({ put }) => {
    put("package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    put(".claude/settings.json", '{ "hooks": {} }');
  });
  assert.equal(row.bucket, "blocked", "the no-op stamp an earlier release wrote is not counted as closing the row");
  assert.match(row.why, /already in \.claude\/settings\.json is left as it is/);
  assert.equal(row.plan.served, row.plan.present.length);
  assert.ok(!row.plan.present.some((e) => e.id === "hooks"));
});

test("a formatter alone is hook work, and the row says the block list starts empty", () => {
  const row = hooksRow(({ put }) => put(".prettierrc", "{}"));
  assert.equal(row.bucket, "missing");
  assert.match(row.why, /no generated paths to block, so protected-paths\.sh starts empty; after-edit formatting with prettier/);
});

test("with work to do and a hooks block on disk, the row is served", () => {
  const row = hooksRow(({ put }) => {
    put("yarn.lock");
    put(".claude/settings.json", '{ "hooks": {} }');
  });
  assert.equal(row.bucket, "present");
});

test("no row names an artifact that no template provides", () => {
  // The property, not the one sentence: every file a row's text names must be a template /cortex
  // stamps, a path the row itself writes, or one of the documents the artifact chain is made of.
  // And no row may promise a "lock" — the word the missing hook was sold under; a lockfile is fine.
  const here = new URL("../../templates/loop/", import.meta.url);
  const chain = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md", "REVIEW.md", "spec.md", "plan.md", "settings.json"]);
  const shapes = [
    () => {},
    ({ put }) => put("package.json", JSON.stringify({ scripts: { test: "vitest", build: "tsc" } })),
    ({ put }) => { put("package.json", JSON.stringify({ scripts: { test: "node --test" } })); put(".claude/settings.json", '{"hooks":{}}'); },
    ({ put }) => { put(".prettierrc"); put(".github/workflows/ci.yml"); put("AGENTS.md"); put("REVIEW.md"); },
  ];
  for (const build of shapes) {
    for (const index of [null, indexOf(["src/a.js"])]) {
      const root = repo(build);
      const plan = loopPlan(root, index);
      for (const e of [...plan.present, ...plan.missing, ...plan.blocked]) {
        const text = [e.title, e.why, e.brief, ...e.needs].join("\n");
        assert.doesNotMatch(text, /\block\b/i, `${e.id} promises a lock no template provides: ${text}`);
        const own = new Set(e.paths.map((p) => p.replace(/#.*$/, "").split("/").filter(Boolean).pop()));
        for (const [name] of text.matchAll(/[\w.-]+\.(?:sh|ya?ml|json|md)\b/g)) {
          const ok = chain.has(name) || own.has(name) || fsExists(new URL(name, here)) ||
            plan.state.protectedPaths.includes(name) || name === plan.state.ci;
          assert.ok(ok, `${e.id} names ${name}, which no template provides`);
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
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
  // Every code span in each row's first cell: one template, two, or the five team roles.
  const named = [...table.matchAll(/^\| (`[^|]+`) \|/gm)].flatMap((m) => [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]));
  assert.ok(named.length >= 8, `parsed only ${named.length} template names from the skill's table`);
  for (const name of named) {
    // A name with its own directory (`team/tester.md`) is under templates/, the rest under loop/.
    const at = name.includes("/") ? new URL(`../${name}`, here) : new URL(name, here);
    assert.ok(fsExists(at), `the /cortex skill names ${name}, which is not a template on disk`);
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
  // A text-only end of turn is a report, so open work is continued — within the documented cap.
  const { limit } = await import("../../core/claude-code.js");
  const cap = Number(run.match(/max_continuations=(\d+)/)?.[1]);
  assert.ok(cap >= 1 && cap <= limit("model.agentic.continuation-cap"), `continuations capped at ${cap}, within the docs' "two or three"`);
  assert.match(run, /claude -p "\$nudge" --continue/, "a continuation resumes the same session");
  assert.match(run, /PARTIAL/, "a case still open after the cap is reported partial");
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

// ---------------------------------------------------------------------------
// cortex-review.yml — /cortex-review on every PR, with no key and nothing installed
// ---------------------------------------------------------------------------

const REVIEW_TEMPLATE = new URL("../../templates/loop/cortex-review.yml", import.meta.url);

test("a workflow that runs cortex-review counts as present, whatever the file is called", () => {
  const root = repo(({ put }) => {
    put("AGENTS.md");
    put(".github/workflows/ci.yml", "jobs:\n  t:\n    steps:\n      - run: node cortex/index/cortex-review.mjs --since x\n");
  });
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  assert.ok(plan.present.some((e) => e.id === "review-ci"), "a team that wired the review into ci.yml is served");
  rmSync(root, { recursive: true, force: true });
});

test("review-ci is offered on GitHub Actions with a brief, and names what it waits on otherwise", () => {
  const offered = repo(({ put }) => { put("AGENTS.md"); put(".github/workflows/ci.yml", "name: ci\n"); });
  assert.ok(loopPlan(offered, indexOf(["src/a.js"])).missing.some((e) => e.id === "review-ci"));
  rmSync(offered, { recursive: true, force: true });

  // GitLab: the template is a GitHub workflow, so it would be a file nothing runs.
  const gitlab = repo(({ put }) => { put("AGENTS.md"); put(".gitlab-ci.yml"); });
  const blocked = loopPlan(gitlab, indexOf(["src/a.js"])).blocked.find((e) => e.id === "review-ci");
  assert.ok(blocked, "blocked on a GitLab repo");
  assert.ok(blocked.needs.some((n) => /GitHub Actions.*\.gitlab-ci\.yml/.test(n)), blocked.needs.join("; "));
  assert.ok(!blocked.needs.some((n) => /AGENTS\.md/.test(n)), "and does not name the brief it already has");
  rmSync(gitlab, { recursive: true, force: true });

  const noBrief = repo(({ put }) => put(".github/workflows/ci.yml", "name: ci\n"));
  const waiting = loopPlan(noBrief, indexOf(["src/a.js"])).blocked.find((e) => e.id === "review-ci");
  assert.deepEqual(waiting?.needs, ["AGENTS.md — the documents a pull request is reviewed against"]);
  rmSync(noBrief, { recursive: true, force: true });
});

test("cortex-review.yml, stamped, is a PR workflow that needs no secret and blocks only on opt-in", async () => {
  const { parseYaml } = await import("./yaml-lite.mjs");
  const stamped = fsRead(REVIEW_TEMPLATE, "utf8").replaceAll("{{CORTEX_REF}}", "v2.38.0");
  assert.doesNotMatch(stamped.replace(/\$\{\{[^}]*\}\}/g, ""), /\{\{/, "a Cortex placeholder is left unfilled");
  // The deterministic half runs on a fork's PR too, where no secret is available.
  assert.doesNotMatch(stamped, /secrets\./, "it asks for no secret");

  const wf = parseYaml(stamped);
  assert.equal(wf.name, "cortex-review");
  assert.ok(wf.on && "pull_request" in wf.on, "runs on pull requests");
  assert.deepEqual(wf.permissions, { contents: "read" }, "least privilege: it reads the repo and nothing else");

  const job = wf.jobs?.review;
  assert.equal(job?.["runs-on"], "ubuntu-latest");
  assert.ok(Number.isInteger(job["timeout-minutes"]));
  assert.equal(job.env?.CORTEX_REF, "v2.38.0", "the Cortex release is pinned, not master");
  for (const step of job.steps) assert.ok(step.uses || step.run, `a step with neither uses nor run: ${JSON.stringify(step)}`);

  const [checkout] = job.steps;
  assert.ok(checkout.uses?.startsWith("actions/checkout@"), "checkout comes first");
  assert.equal(String(checkout.with?.["fetch-depth"]), "0", "full history: the base and git's rename record are needed");

  const fetch = job.steps.find((s) => /git clone/.test(s.run ?? ""));
  assert.match(fetch?.run ?? "", /--branch "\$CORTEX_REF"/, "Cortex is fetched at the pinned ref");
  assert.match(fetch.run, /\$RUNNER_TEMP\/cortex/, "outside the workspace, so the indexer never reads Cortex as this repo");
  assert.doesNotMatch(stamped, /npm (ci|install)|setup-node/, "nothing is installed: index/ has no dependencies");

  const review = job.steps.find((s) => /cortex-review\.mjs/.test(s.run ?? ""));
  assert.equal(review.env?.BASE, "${{ github.event.pull_request.base.sha }}", "the diff is base...head of the PR");
  assert.equal(review.env?.BLOCKING, "${{ vars.CORTEX_REVIEW_BLOCKING }}", "blocking is a repository variable");
  assert.match(review.run, /--since "\$BASE"/);
  assert.match(review.run, /--citations --since "\$BASE"/);
  assert.match(review.run, /GITHUB_STEP_SUMMARY/, "the report lands in the run summary");
  assert.doesNotMatch(review.run, /set -e/, "one failing command must not skip the report");
});

test("cortex-review.yml carries only the placeholder the /cortex skill tells it how to fill", () => {
  const src = fsRead(REVIEW_TEMPLATE, "utf8").replace(/\$\{\{[^}]*\}\}/g, "");
  const found = [...new Set([...src.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))];
  assert.deepEqual(found, ["CORTEX_REF"]);
  assert.equal(src.split("{{CORTEX_REF}}").length - 1, 1, "{{CORTEX_REF}} appears once, where it is filled");
  const skill = fsRead(new URL("../../skills/cortex/SKILL.md", import.meta.url), "utf8");
  const row = skill.split("\n").find((l) => l.startsWith("| `cortex-review.yml`"));
  assert.ok(row?.includes("CORTEX_REF"), "the skill's cortex-review.yml row does not say how to fill {{CORTEX_REF}}");
  assert.ok(row.includes("CORTEX_REVIEW_BLOCKING"), "and it names the switch that makes the check blocking");
});


// ---------------------------------------------------------------------------
// The shared plugin — Cortex in a team repo's committed .claude/settings.json (spec S6)
// ---------------------------------------------------------------------------

const teamRow = (plan) => {
  for (const bucket of ["missing", "present", "blocked"]) {
    const e = plan[bucket].find((x) => x.id === "team-plugin");
    if (e) return { bucket, e };
  }
  return null;
};

test("on the work profile, the shared plugin is offered, naming the profile and the caveat", () => {
  const root = repo(({ put }) => put("package.json", "{}"));
  const plan = loopPlan(root, indexOf(["src/a.js"]), { team: teamServed(root, { CORTEX_PROFILE: "work" }) });
  const row = teamRow(plan);
  assert.equal(row?.bucket, "missing");
  assert.equal(row.e.stage, "maintain");
  assert.deepEqual(row.e.paths, [".claude/settings.json"]);
  assert.deepEqual(row.e.protectedWrites, [".claude/settings.json"], "a headless run cannot write it, and must say so");
  assert.match(row.e.why, /CORTEX_PROFILE=work/);
  assert.match(row.e.brief, /claude plugin install cortex@cortex --scope project/, "the offer says each teammate still installs once");
  assert.match(row.e.brief, /cortex-shared-plugin\.mjs/, "and the merge is the CLI's, never a hand edit");
  assert.match(row.e.brief, /Auto-update is a separate yes\/no, unticked by default: only a yes adds --auto-update/, "auto-update is its own choice, off by default");
  rmSync(root, { recursive: true, force: true });
});

test("a team-brain connector offers it on any profile", () => {
  const root = repo(({ put }) => put(".cortex/connector.json", JSON.stringify({ team: "platform", project: "api", teamBrainRepo: "x" })));
  const plan = loopPlan(root, indexOf(["src/a.js"]), { team: teamServed(root, {}) });
  assert.equal(teamRow(plan)?.bucket, "missing");
  assert.match(teamRow(plan).e.why, /the platform team's brain/);
  rmSync(root, { recursive: true, force: true });
});

test("home or lab with no connector: never offered, never named, never counted", () => {
  const root = repo(({ put }) => put("package.json", "{}"));
  const solo = loopPlan(root, indexOf(["src/a.js"]), { team: { team: false, why: null } });
  const work = loopPlan(root, indexOf(["src/a.js"]), { team: teamServed(root, { CORTEX_PROFILE: "work" }) });
  assert.equal(work.total, solo.total + 1, "the row counts where it applies");
  for (const env of [{}, { CORTEX_PROFILE: "home" }, { CORTEX_PROFILE: "lab" }]) {
    const plan = loopPlan(root, indexOf(["src/a.js"]), { team: teamServed(root, env) });
    assert.equal(teamRow(plan), null, JSON.stringify(env));
    assert.equal(plan.total, solo.total, "a solo repo's loop numbers are what they were");
  }
  rmSync(root, { recursive: true, force: true });
});

test("settings that already carry both entries are served; half of them is still an offer", () => {
  const work = { CORTEX_PROFILE: "work" };
  const served = repo(({ put }) => put(".claude/settings.json", mergeSharedPlugin('{ "model": "sonnet" }').text));
  assert.equal(teamRow(loopPlan(served, null, { team: teamServed(served, work) })).bucket, "present");
  const half = repo(({ put }) => put(".claude/settings.json", '{ "enabledPlugins": { "cortex@cortex": false } }'));
  const row = teamRow(loopPlan(half, null, { team: teamServed(half, work) }));
  assert.equal(row.bucket, "missing");
  assert.match(row.e.why, /extraKnownMarketplaces\.cortex/, "the evidence names what is missing");
  rmSync(served, { recursive: true, force: true });
  rmSync(half, { recursive: true, force: true });
});

test("a settings file that does not parse blocks the row, and says why", () => {
  const root = repo(({ put }) => put(".claude/settings.json", "{ not json"));
  const row = teamRow(loopPlan(root, null, { team: teamServed(root, { CORTEX_PROFILE: "work" }) }));
  assert.equal(row.bucket, "blocked");
  assert.match(row.e.needs.join(" "), /settings\.json that parses/);
  assert.match(row.e.why, /not valid JSON/);
  rmSync(root, { recursive: true, force: true });
});

test("the loop reads the machine's profile itself when no one overrides it", () => {
  // The CLI passes nothing: readLoopState asks teamServed with this process's environment.
  const root = repo(({ put }) => put("package.json", "{}"));
  assert.equal(readLoopState(root).team.team, false, "no profile set in this file");
  process.env.CORTEX_PROFILE = "work";
  try {
    assert.equal(readLoopState(root).team.team, true);
  } finally {
    delete process.env.CORTEX_PROFILE;
  }
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// the agent team (plan step 14, spec T4, T6, T9)
// ---------------------------------------------------------------------------

const agentTeamRow = (plan) => {
  for (const bucket of ["present", "missing", "blocked"]) {
    const e = plan[bucket].find((x) => x.id === "team");
    if (e) return { bucket, ...e };
  }
  return null;
};
const VERIFIER_BODY = fsRead(new URL("../../templates/loop/verifier.md", import.meta.url), "utf8").replace("{{RUN}}", "npm run dev");
const agentMd = (name, description, extra = "") => `---\nname: ${name}\ndescription: ${description}\n${extra}---\nYou help.\n`;

test("the team row waits for an index, and for code — never 'no agents' off an index nobody built", () => {
  const root = repo(({ put }) => put("src/a.js"));
  const none = agentTeamRow(loopPlan(root, null));
  assert.equal(none.bucket, "blocked");
  assert.ok(none.needs.some((n) => /index/.test(n)), none.needs.join("; "));
  assert.equal(loopPlan(root, null).state.agentTeam, null);
  const green = agentTeamRow(loopPlan(root, indexOf([])));
  assert.equal(green.bucket, "blocked");
  assert.ok(green.needs.some((n) => /code in the repo/.test(n)));
  rmSync(root, { recursive: true, force: true });
});

test("a repo with code and no agents is offered the four core roles, each on its own", () => {
  const root = repo(({ put }) => put("src/a.js"));
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  const row = agentTeamRow(plan);
  assert.equal(row.bucket, "missing");
  assert.match(row.why, /offers: architect, implementer, tester, reviewer — each picked on its own/);
  assert.match(row.why, /project-manager waits: nothing to manage yet/, "the withheld role is said, never dropped");
  assert.deepEqual(plan.state.agentTeam.offer.map((o) => o.role), ["architect", "implementer", "tester", "reviewer"]);
  assert.deepEqual(row.protectedWrites, [".claude/agents/", ".claude/hooks/test-paths.sh", ".claude/skills/team/SKILL.md"]);
  rmSync(root, { recursive: true, force: true });
});

test("the Project manager is offered only where a plan folder exists (T4)", () => {
  const root = repo(({ put }) => { put("src/a.js"); put("docs/specs/s.md"); });
  const t = loopPlan(root, indexOf(["src/a.js"])).state.agentTeam;
  assert.ok(t.offer.some((o) => o.role === "project-manager"));
  assert.equal(t.values.PLAN_DIRS, "`docs/specs/`");
  rmSync(root, { recursive: true, force: true });
});

test("a role an existing agent plays is not offered again, and the row says who plays it (T6)", () => {
  const root = repo(({ put }) => {
    put("src/a.js");
    put(".claude/agents/code-reviewer.md", agentMd("code-reviewer", "Reviews the diff. Use once a change is done.", "tools: Read, Grep\n"));
  });
  const plan = loopPlan(root, indexOf(["src/a.js", ".claude/agents/code-reviewer.md"]));
  const row = agentTeamRow(plan);
  assert.doesNotMatch(row.why, /offers:[^;]*reviewer/);
  assert.match(row.why, /already played: reviewer by code-reviewer/);
  assert.ok(!plan.state.agentTeam.offer.some((o) => o.role === "reviewer"));
  rmSync(root, { recursive: true, force: true });
});

test("the verifier is offered the upgrade; declining keeps it, and keeps the Reviewer covered (T9)", () => {
  const root = repo(({ put }) => { put("src/a.js"); put(".claude/agents/verifier.md", VERIFIER_BODY); });
  const plan = loopPlan(root, indexOf(["src/a.js", ".claude/agents/verifier.md"]));
  assert.match(agentTeamRow(plan).why, /verifier is offered the upgrade to the Reviewer/);
  const t = plan.state.agentTeam;
  assert.equal(t.upgrade.path, ".claude/agents/verifier.md");
  assert.ok(!t.offer.some((o) => o.role === "reviewer"), "no second reviewer beside the verifier");
  // The verifier row itself stays served: the upgrade is the team row's question, not a new gap.
  assert.ok(plan.present.some((e) => e.id === "verifier"));
  rmSync(root, { recursive: true, force: true });
});

test("the developer's answer about an agent reaches the offer through the loop state", () => {
  const root = repo(({ put }) => {
    put("src/a.js");
    put(".claude/agents/code-reviewer.md", agentMd("code-reviewer", "Reviews the diff.", "tools: Read, Grep\n"));
  });
  const idx = indexOf(["src/a.js", ".claude/agents/code-reviewer.md"]);
  const t = loopPlan(root, idx, { agentsAs: { ".claude/agents/code-reviewer.md": null } }).state.agentTeam;
  assert.ok(t.offer.some((o) => o.role === "reviewer"), "not the reviewer, so the role is on offer again");
  rmSync(root, { recursive: true, force: true });
});

test("the playbook in CLAUDE.md is what makes the team present, whatever roles were declined", () => {
  const root = repo(({ put }) => {
    put("src/a.js");
    put("CLAUDE.md", "@AGENTS.md\n\n## Working as a team\n\nThis repo has single-job agents in `.claude/agents/`: `tester`.\n");
    put(".claude/agents/tester.md", fsRead(new URL("../../templates/team/tester.md", import.meta.url), "utf8"));
  });
  const row = agentTeamRow(loopPlan(root, indexOf(["src/a.js", ".claude/agents/tester.md"])));
  assert.equal(row.bucket, "present");
  assert.match(row.why, /still on offer: architect, implementer, reviewer/);
  rmSync(root, { recursive: true, force: true });
});

test("LOOP_STAMPS carries every team file, none of them adoptable, beside the loop's own", async () => {
  const { LOOP_STAMPS } = await import("../lib/loop.mjs");
  const team = LOOP_STAMPS.filter((s) => s.row === "team");
  assert.deepEqual(team.map((s) => s.path).sort(), [
    ".claude/agents/architect.md", ".claude/agents/implementer.md", ".claude/agents/project-manager.md",
    ".claude/agents/reviewer.md", ".claude/agents/tester.md", ".claude/hooks/test-paths.sh", ".claude/skills/team/SKILL.md",
  ]);
  assert.ok(team.every((s) => s.adopt === false));
  assert.ok(LOOP_STAMPS.filter((s) => s.row !== "team").every((s) => s.adopt !== false), "the loop's own files are still adopted");
  for (const s of team) assert.ok(fsExists(new URL(`../../templates/${s.template}`, import.meta.url)), s.template);
});

// --- what a row changes beyond its files (#548, item 10) ---------------------------------------------

test("the team row says what it changes for every later session, not only which files it writes", () => {
  const root = repo(({ put }) => put("src/a.js"));
  const plan = loopPlan(root, indexOf(["src/a.js"]));
  rmSync(root, { recursive: true, force: true });
  const team = [...plan.missing, ...plan.present, ...plan.blocked].find((e) => e.id === "team");
  assert.match(team.effect, /every later session/i);
  assert.match(team.effect, /until you answer/);
  // The sentence describes the playbook, so both must name the same question and the same command.
  const playbook = fsRead(new URL("../../templates/team/playbook.md", import.meta.url), "utf8");
  for (const said of ['"Single agent or team?"', "`/cortex-impact --size`"]) {
    assert.ok(team.effect.includes(said), `the row names ${said}`);
    assert.ok(playbook.includes(said), `and the playbook still says ${said}`);
  }
  // Rows that only add files say nothing, so the one that changes behaviour stands out.
  const others = [...plan.missing, ...plan.present, ...plan.blocked].filter((e) => e.id !== "team");
  assert.ok(others.length > 5 && others.every((e) => e.effect === null));
});
