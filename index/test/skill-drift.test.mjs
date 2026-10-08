import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { skillDrift, listRepoSkills } from "../lib/skill-drift.mjs";
import { tempDir } from "./tmp.mjs";

// A repo on disk plus the index that describes it. The index is written by hand so each test states
// exactly which files exist; `isIgnored` is injected so no test depends on git being present.
function repo({ files = {}, skills = {}, tests = [] } = {}) {
  const root = tempDir("cortex-skill-drift-");
  const put = (rel, body) => {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  };
  for (const [rel, body] of Object.entries(files)) put(rel, body);
  for (const t of tests) put(t, "test('x', () => {});\n");
  for (const [name, body] of Object.entries(skills)) put(`.claude/skills/${name}/SKILL.md`, body);
  const paths = [...Object.keys(files), ...tests, ...Object.keys(skills).map((n) => `.claude/skills/${n}/SKILL.md`)];
  const index = {
    version: "1",
    files: paths.map((p) => ({ path: p, isTest: tests.includes(p) })),
    stats: { tests: tests.length },
  };
  return { root, index };
}

const none = () => new Set();
const skill = (body) => `---\nname: s\ndescription: a skill. The repo has no tests at all, per the old install.\n---\n\n${body}\n`;
const PKG = JSON.stringify({ name: "app", scripts: { build: "vite build", lint: "eslint .", test: "vitest" } });

test("a skill that matches the repo reports nothing", () => {
  const { root, index } = repo({
    files: { "package.json": PKG, "src/app.ts": "x", "src/lib/util.ts": "x" },
    tests: ["src/app.test.ts"],
    skills: {
      clean: skill([
        "Start at `src/app.ts` and `src/lib/util.ts`, beside the code in `src/lib/`.",
        "",
        "```bash",
        "npm run build && npm test",
        "pnpm install",
        "```",
        "Then run `npm run lint`.",
      ].join("\n")),
    },
  });
  const r = skillDrift(root, index, { isIgnored: none });
  assert.deepEqual(r.checked, ["clean"]);
  assert.deepEqual(r.drifted, [], JSON.stringify(r.drifted, null, 2));
});

test("a path that moved is reported with its line, and a same-named file as a hint", () => {
  const { root, index } = repo({
    files: { "src/features/card/WeatherCard.tsx": "x" },
    skills: { stale: skill("Read `src/components/WeatherCard/WeatherCard.tsx:10-11` first.\nThe layout is in `src/components/`.") },
  });
  const r = skillDrift(root, index, { isIgnored: none });
  const f = r.drifted[0].findings;
  assert.equal(r.drifted[0].skill, "stale");
  assert.equal(r.drifted[0].path, ".claude/skills/stale/SKILL.md");
  assert.deepEqual(f.map((x) => [x.line, x.kind]), [[6, "path"], [7, "path"]]);
  assert.match(f[0].why, /src\/components\/WeatherCard\/WeatherCard\.tsx, which is not in the repo/);
  assert.equal(f[0].hint, "src/features/card/WeatherCard.tsx");
  assert.match(f[1].why, /directory src\/components\//);
  assert.equal(f[1].hint, undefined);
});

test("a false 'no tests' claim is reported; a scoped, conditional or historical one is not", () => {
  const { root, index } = repo({
    files: { "src/a.ts": "x" },
    tests: ["src/a.test.ts", "src/b.test.ts"],
    skills: {
      claims: skill([
        "This repo has **zero test files** and no runner.",
        "There are no tests for the parser yet.",
        "If a module has no tests, write one first.",
        "The repo had no tests until the harness landed.",
      ].join("\n")),
    },
  });
  const f = skillDrift(root, index, { isIgnored: none }).drifted[0].findings;
  assert.equal(f.length, 1, JSON.stringify(f, null, 2));
  assert.equal(f[0].line, 6);
  assert.equal(f[0].kind, "tests");
  assert.match(f[0].why, /index counts 2 test files \(first: src\/a\.test\.ts\)/);
});

test("a 'no tests' claim in a repo that really has none is true, and stays quiet", () => {
  const { root, index } = repo({ files: { "src/a.ts": "x" }, skills: { t: skill("There is no test suite here.") } });
  assert.deepEqual(skillDrift(root, index, { isIgnored: none }).drifted, []);
});

test("a script no package.json declares is reported; declared ones and builtins are not", () => {
  const { root, index } = repo({
    files: { "package.json": PKG, "web/package.json": JSON.stringify({ scripts: { dev: "vite" } }) },
    skills: {
      cmds: skill([
        "```bash",
        "npm run typecheck",
        "pnpm format:check",
        "yarn run dev",
        "pnpm add -D vitest",
        "npm ci",
        "```",
      ].join("\n")),
    },
  });
  const f = skillDrift(root, index, { isIgnored: none }).drifted[0].findings;
  assert.deepEqual(f.map((x) => [x.line, x.cited]), [[7, "npm run typecheck"], [8, "pnpm format:check"]]);
  assert.match(f[0].why, /"typecheck" script \(read: package\.json, web\/package\.json\)/);
});

test("a line ABOUT a missing script is not an instruction to run it", () => {
  const { root, index } = repo({
    files: { "package.json": JSON.stringify({ scripts: {} }) },
    skills: { setup: skill("`npm test` does not exist yet.\nOnce `npm run test:run` passes, update AGENTS.md.") },
  });
  assert.deepEqual(skillDrift(root, index, { isIgnored: none }).drifted, []);
});

test("a wrapper the repo does not carry is reported", () => {
  const { root, index } = repo({ files: { "pom.xml": "<project/>" }, skills: { mvn: skill("Run `./mvnw -q verify`.") } });
  const f = skillDrift(root, index, { isIgnored: none }).drifted[0].findings;
  assert.equal(f.length, 1);
  assert.match(f[0].why, /mvnw wrapper, and the repo has none/);
});

test("CRLF line endings give the same lines and the same findings", () => {
  const body = skill("Read `src/gone.ts`.\n\nThere are no tests.").replace(/\n/g, "\r\n");
  const { root, index } = repo({ files: { "src/a.ts": "x" }, tests: ["src/a.test.ts"], skills: { crlf: body } });
  const f = skillDrift(root, index, { isIgnored: none }).drifted[0].findings;
  assert.deepEqual(f.map((x) => [x.line, x.kind]), [[6, "path"], [8, "tests"]]);
  assert.ok(!f.some((x) => /\r/.test(x.text) || /\r/.test(x.cited)));
});

test("a repo with no .claude/skills checks nothing and does not throw", () => {
  const { root, index } = repo({ files: { "src/a.ts": "x" } });
  assert.deepEqual(listRepoSkills(root), []);
  assert.deepEqual(skillDrift(root, index, { isIgnored: none }), { checked: [], drifted: [] });
});

test("without an index nothing is proven, and that is null rather than a clean bill", () => {
  const { root } = repo({ skills: { s: skill("Read `src/gone.ts`.") } });
  assert.equal(skillDrift(root, null), null);
});

test("what the repo ignores, a file the skill creates, and frontmatter outside the description are never reported", () => {
  const { root, index } = repo({
    files: { "src/a.ts": "x" },
    skills: {
      s: [
        "---",
        "name: s",
        "description: a skill",
        "paths: src/old/**/*.ts",
        "argument-hint: src/old/path.ts",
        "---",
        "Incremental state lives in `node_modules/.vite/deps/react.js`.",
        "Output goes to `dist/assets/app.js`.",
        "Create `src/test/setup.ts` with the matchers.",
        "The old `src/legacy/x.ts` was deleted.",
      ].join("\n"),
    },
  });
  const r = skillDrift(root, index, { isIgnored: (ps) => new Set(ps.filter((p) => p.startsWith("dist/"))) });
  assert.deepEqual(r.drifted, [], JSON.stringify(r.drifted, null, 2));
});

test("an abbreviated path that some file ends with is not a lie", () => {
  const { root, index } = repo({
    files: { "src/components/ui/badge.tsx": "x" },
    skills: { s: skill("The baseline error is in `ui/badge.tsx`.") },
  });
  assert.deepEqual(skillDrift(root, index, { isIgnored: none }).drifted, []);
});

test("an unreadable package.json proves nothing about which scripts exist", () => {
  const { root, index } = repo({ files: { "package.json": "{ not json" }, skills: { s: skill("Run `npm run typecheck`.") } });
  assert.deepEqual(skillDrift(root, index, { isIgnored: none }).drifted, []);
});

test("a fenced example is illustration, not a citation", () => {
  const { root, index } = repo({
    files: { "src/a.ts": "x" },
    tests: ["src/a.test.ts"],
    skills: {
      s: skill(["A body looks like:", "", "```markdown", "Start at `src/example/thing.ts`.", "There are no tests.", "```"].join("\n")),
    },
  });
  assert.deepEqual(skillDrift(root, index, { isIgnored: none }).drifted, []);
});

// --- edited since it was written (#548, item 4) ------------------------------------------------------

const STALE = { files: { "src/a.ts": "x" }, skills: { stale: skill("Read `src/gone.ts` first.") } };

test("a drifted skill says whether a person edited it since it was written, with the sentence a playback row shows", () => {
  const { root, index } = repo(STALE);
  const at = (h) => skillDrift(root, index, { isIgnored: none, history: () => h }).drifted[0];

  const once = at({ commits: 1, uncommitted: false });
  assert.equal(once.edited, false);
  assert.equal(once.editedNote, null);

  const twice = at({ commits: 2, uncommitted: false });
  assert.equal(twice.edited, true);
  assert.equal(twice.editedNote, "edited since it was written, 2 commits");

  assert.equal(at({ commits: 3, uncommitted: true }).editedNote, "edited since it was written, 3 commits and uncommitted changes");
  assert.equal(at({ commits: 1, uncommitted: true }).editedNote, "edited since it was written, uncommitted changes");
  // Never committed: nothing says who wrote it, so it is a person's until git says otherwise.
  assert.equal(at({ commits: 0, uncommitted: true }).edited, true);
});

test("when git cannot say, `edited` is null — unanswered, never 'not edited'", () => {
  const { root, index } = repo(STALE);
  const d = skillDrift(root, index, { isIgnored: none, history: () => null }).drifted[0];
  assert.equal(d.edited, null);
  assert.equal(d.editedNote, null);
  // The default asks git, and a directory that is no checkout has no answer.
  assert.equal(skillDrift(root, index, { isIgnored: none }).drifted[0].edited, null);
});

test("history is asked only about skills that drifted", () => {
  const { root, index } = repo({ files: { "src/a.ts": "x" }, skills: { clean: skill("Read `src/a.ts`."), stale: skill("Read `src/gone.ts`.") } });
  const asked = [];
  skillDrift(root, index, { isIgnored: none, history: (rel) => (asked.push(rel), null) });
  assert.deepEqual(asked, [".claude/skills/stale/SKILL.md"]);
});

// --- claims the manifest refutes, a stale description, a premise that is gone (#548, items 5 and 6) ---

const kinds = (r) => r.drifted.flatMap((d) => d.findings.map((f) => `${f.kind}@${f.line}`));

test("a claim that a script does not exist is refuted by the manifest that declares it", () => {
  const pkg = JSON.stringify({ scripts: { typecheck: "tsc --noEmit", lint: "eslint ." } });
  const { root, index } = repo({
    files: { "package.json": pkg, "src/a.ts": "x" },
    skills: {
      "type-check": skill([
        "The checker is not wired into a standalone npm script.",   // names nothing: the skill's own name is the script
        "There is no `lint` script here.",
        "`npm run typecheck` does not exist yet, so call tsc directly.",
        "There is no `deploy` script.",                              // true: nothing declares it
        "If there is no `lint` script, add one.",                    // conditional
        "There was no `lint` script before the migration.",          // historical
      ].join("\n")),
    },
  });
  const r = skillDrift(root, index, { isIgnored: none });
  assert.deepEqual(kinds(r), ["no-script@6", "no-script@7", "no-script@8"], JSON.stringify(r.drifted, null, 2));
  const [a, b] = r.drifted[0].findings;
  assert.match(a.why, /package\.json declares a "typecheck" script/);
  assert.match(b.why, /package\.json declares a "lint" script/);
});

test("a no-script claim proves nothing when a manifest cannot be read, or the skill's name is no script", () => {
  const { root, index } = repo({
    files: { "package.json": "{ not json", "pkg/package.json": JSON.stringify({ scripts: { lint: "x" } }), "src/a.ts": "x" },
    // The second line names nothing and is not about scripts, so the skill's name proves nothing.
    skills: { lint: skill(["There is no `lint` script here.", "The config does not exist."].join("\n")) },
  });
  assert.deepEqual(skillDrift(root, index, { isIgnored: none }).drifted, []);
  const readable = repo({ files: { "package.json": JSON.stringify({ scripts: { lint: "x" } }), "src/a.ts": "x" }, skills: { lint: skill("The config does not exist.") } });
  assert.deepEqual(skillDrift(readable.root, readable.index, { isIgnored: none }).drifted, []);
  const other = repo({
    files: { "package.json": JSON.stringify({ scripts: { build: "x" } }), "src/a.ts": "x" },
    skills: { "type-check": skill("The checker is not wired into a standalone npm script.") },
  });
  assert.deepEqual(skillDrift(other.root, other.index, { isIgnored: none }).drifted, []);
});

test("a stale path in the description is reported, and marked as frontmatter a refresh does not touch", () => {
  const body = "---\nname: s\ndescription: Use when editing src/components/Nav.tsx or `src/old/` code,\n  or docs at https://example.com/a/b.html and src/app/page.tsx. CI/CD and and/or are words, like canvas/WebGL/Three.js. Not `example.com/docs/a.md`, not `src/old/*.ts`.\nallowed-tools: Read\n---\n\nRead `src/app/page.tsx`.\n";
  const { root, index } = repo({ files: { "src/app/page.tsx": "x", "src/features/Nav.tsx": "x" }, skills: { s: body } });
  const f = skillDrift(root, index, { isIgnored: none }).drifted[0].findings;
  assert.deepEqual(f.map((x) => [x.line, x.kind, x.cited, x.frontmatter]), [
    [3, "path", "src/components/Nav.tsx", true],
    [3, "path", "src/old/", true],
  ]);
  assert.equal(f[0].hint, "src/features/Nav.tsx");
  assert.match(f[0].why, /description names src\/components\/Nav\.tsx/);
});

test("a description path that ends its sentence is still read", () => {
  const body = "---\nname: s\ndescription: Use when touching src/gone/Card.tsx.\n---\n\nBody.\n";
  const { root, index } = repo({ files: { "src/a.ts": "x" }, skills: { s: body } });
  assert.deepEqual(skillDrift(root, index, { isIgnored: none }).drifted[0].findings.map((f) => f.cited), ["src/gone/Card.tsx"]);
});

test("a body finding carries no frontmatter mark, and a path under another frontmatter key is not read", () => {
  const body = "---\nname: s\ndescription: A skill.\npaths: src/gone/**/*.ts\n---\n\nRead `src/gone/a.ts`.\n";
  const { root, index } = repo({ files: { "src/a.ts": "x" }, skills: { s: body } });
  const f = skillDrift(root, index, { isIgnored: none }).drifted[0].findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 7);
  assert.equal("frontmatter" in f[0], false);
});

test("a skill that says no test runner is installed is refuted by the runner the index detected", () => {
  const made = repo({
    files: { "package.json": PKG, "src/a.ts": "x" },
    tests: ["src/a.test.ts"],
    skills: { s: "---\nname: s\ndescription: A skill.\n---\n\nThere is no test runner installed in this project.\nIf no test runner is configured, stop.\n" },
  });
  const index = { ...made.index, stack: { test: ["vitest"] } };
  const f = skillDrift(made.root, index, { isIgnored: none }).drifted[0].findings;
  assert.deepEqual(f.map((x) => `${x.kind}@${x.line}`), ["tests@6"]);
  assert.match(f[0].why, /says no test runner is installed, and the index detected Vitest/);
  // Without a detected runner the claim cannot be refuted.
  assert.deepEqual(skillDrift(made.root, made.index, { isIgnored: none }).drifted, []);
});

test("a setup skill whose premise is gone is proposed for retirement, with its successor", () => {
  const clean = "---\nname: write-first-test\ndescription: Get a real test running for the first time.\n---\n\nPick a runner and write one test.\n";
  const made = repo({ files: { "package.json": PKG, "src/a.ts": "x" }, tests: ["src/a.test.ts", "src/b.test.ts"], skills: { "write-first-test": clean, "add-route": clean } });
  const index = { ...made.index, stack: { test: ["vitest"] } };
  const r = skillDrift(made.root, index, { isIgnored: none });
  assert.deepEqual(r.drifted.map((d) => d.skill), ["write-first-test"], "only the skill whose premise the index refutes");
  const d = r.drifted[0];
  assert.deepEqual(d.retire, { successor: "add-test" });
  assert.equal(d.findings[0].kind, "premise");
  assert.match(d.findings[0].why, /the index counts 2 test files/);
  assert.match(d.findings[0].why, /add-test/);

  // No tests yet: the premise holds, and nothing is said.
  const before = repo({ files: { "package.json": PKG, "src/a.ts": "x" }, skills: { "write-first-test": clean } });
  assert.deepEqual(skillDrift(before.root, before.index, { isIgnored: none }).drifted, []);
  // Tests but no detected runner: retire is still proposed, and no successor is named.
  const bare = skillDrift(made.root, made.index, { isIgnored: none }).drifted[0];
  assert.deepEqual(bare.retire, { successor: null });
  // A skill that only drifted has no retire key to act on.
  const stale = repo({ files: { "src/a.ts": "x" }, skills: { stale: skill("Read `src/gone.ts`.") } });
  assert.equal(skillDrift(stale.root, stale.index, { isIgnored: none }).drifted[0].retire, null);
});
