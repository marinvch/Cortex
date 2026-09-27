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

test("what the repo ignores, a file the skill creates, and the frontmatter are never reported", () => {
  const { root, index } = repo({
    files: { "src/a.ts": "x" },
    skills: {
      s: [
        "---",
        "name: s",
        "description: see `src/old/path.ts`",
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
