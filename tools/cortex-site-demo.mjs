#!/usr/bin/env node
// cortex-site-demo.mjs — what a `/cortex` run prints on three small repos, captured for the site.
//
//   node tools/cortex-site-demo.mjs                  # print site-demo.json to stdout
//   node tools/cortex-site-demo.mjs --out <file>     # write it
//   node tools/cortex-site-demo.mjs --check <file>   # exit 1 when <file> is not what a run gives now
//
// The site's home page plays a `/cortex` run step by step. A hand-written copy of that output would
// be wrong the first time a row of the loop is reworded, which is the drift `cortex-site-facts.mjs`
// exists to stop (#415). So this builds three repos in a temp dir, runs the read half of `/cortex`
// on each — the indexer, the findings and the loop — and records what they said:
//
//   new      an empty git repo
//   legacy   a small Express service with tests and CI, and no agent files
//   team     the same service with a team-brain connector, so the shared-plugin row is offered
//
// The apply step is not run: a model does that, following skills/cortex/SKILL.md. Each loop row
// names the paths it would write, and the site shows those.
//
// It spawns the CLIs in index/ and imports nothing from there, because tools/ does not reach into a
// leaf (tools/AGENTS.md). Deterministic: no timestamps, no absolute paths, no commit ids, keys in a
// fixed order, so two runs over the same Cortex are byte-identical. The fixtures are generic on
// purpose — this file's output is published.
//
// Exit codes: 0 written / nothing changed · 1 --check found a difference · 2 a CLI failed or `git`
// is missing. A 2 is never a pass.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = 1;
const CORTEX = resolve(dirname(fileURLToPath(import.meta.url)), "..");

class DemoError extends Error {}

// --- the three repos ------------------------------------------------------------------------------

const SERVICE = {
  "package.json": `${JSON.stringify({
    name: "shop",
    private: true,
    type: "module",
    scripts: { start: "node src/server.js", test: "node --test", lint: "eslint ." },
    dependencies: { express: "^4.19.2" },
    devDependencies: { eslint: "^9.0.0" },
  }, null, 2)}\n`,
  "package-lock.json": `${JSON.stringify({ name: "shop", lockfileVersion: 3, packages: {} }, null, 2)}\n`,
  "README.md": "# shop\n\nA small checkout service.\n",
  "src/server.js": 'import express from "express";\nimport { pay } from "./checkout.js";\n\nconst app = express();\napp.post("/pay", (req, res) => res.json({ total: pay(req.body.cart) }));\napp.listen(3000);\n',
  "src/checkout.js": 'import { total } from "./cart.js";\n\nexport const pay = (cart) => total(cart);\n',
  "src/cart.js": "export const total = (cart) => cart.reduce((sum, item) => sum + item.price, 0);\n",
  "test/cart.test.js": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { total } from "../src/cart.js";\n\ntest("total adds the prices", () => assert.equal(total([{ price: 2 }, { price: 3 }]), 5));\n',
  ".github/workflows/ci.yml": "name: ci\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n",
};

const SCENARIOS = [
  {
    id: "new",
    title: "A new repo",
    blurb: "Nothing is written yet, so the loop grows with the code.",
    name: "new-project",
    files: {},
  },
  {
    id: "legacy",
    title: "A working project",
    blurb: "Code, tests and CI are there. No file tells an agent how the repo works.",
    name: "shop",
    files: SERVICE,
  },
  {
    id: "team",
    title: "A team's repo",
    blurb: "The same project, shared: one committed context layer for every developer's agent.",
    name: "shop",
    files: { ...SERVICE, ".cortex/connector.json": `${JSON.stringify({ teamBrain: "../team-brain" }, null, 2)}\n` },
  },
];

// --- running Cortex on one of them ----------------------------------------------------------------

// The profile and the vault root come from the environment of whoever runs this; neither may move
// what is published, so both are pinned — the root under both of its names.
const ENV = { ...process.env, CORTEX_PROFILE: "home", CORTEX_ROOT: "", AI_OS_ROOT: "", NO_COLOR: "1" };

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env: ENV, encoding: "utf8" });
  if (r.error) throw new DemoError(`${cmd} could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new DemoError(`${cmd} ${args.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

const cli = (name, repo, ...flags) => run(process.execPath, [join(CORTEX, "index", name), ".", ...flags], repo);

function build(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  run("git", ["init", "-q", "."], dir);
  if (!Object.keys(files).length) return;
  // The connector lives under .cortex/, which a real repo ignores in part; here it only has to exist.
  run("git", ["add", "-A", "--", ".", ":!.cortex"], dir);
  run("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "-q", "-m", "A small checkout service"], dir);
}

/** What the indexer printed, minus what differs between two machines or two runs. */
function indexLines(stdout, repo) {
  const roots = [repo, repo.replace(/\\/g, "/")];
  return stdout.replace(/\r/g, "").split("\n")
    .map((line) => roots.reduce((l, r) => l.split(r).join("."), line))
    .map((line) => line.replace(/\\/g, "/").replace(/ in \d+ms$/, "").replace(/^Wrote \.\//, "Wrote "))
    .filter((line) => line.trim() && !line.startsWith("Next →"));
}

const STATUS = ["present", "missing", "blocked"];

function loopRows(loop) {
  const rows = STATUS.flatMap((status) => (loop[status] ?? []).map((row, order) => ({ status, order, row })));
  const stage = (r) => loop.stages.indexOf(r.row.stage);
  rows.sort((a, b) => stage(a) - stage(b) || STATUS.indexOf(a.status) - STATUS.indexOf(b.status) || a.order - b.order);
  return rows.map(({ status, row }) => ({
    id: row.id,
    stage: row.stage,
    status,
    title: row.title,
    why: row.why,
    needs: row.needs ?? [],
    paths: row.paths ?? [],
  }));
}

function capture(scenario, work) {
  const repo = join(work, scenario.id, scenario.name);
  build(repo, scenario.files);

  const index = indexLines(cli("cortex-index.mjs", repo), repo);
  const findings = JSON.parse(cli("cortex-findings.mjs", repo, "--json"));
  const loop = JSON.parse(cli("cortex-loop.mjs", repo, "--json"));

  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  return {
    id: scenario.id,
    title: scenario.title,
    blurb: scenario.blurb,
    repo: { name: scenario.name, files: Object.keys(scenario.files).sort() },
    index,
    findings: { counts, items: findings.map((f) => ({ severity: f.severity, title: f.title })) },
    loop: {
      greenfield: Boolean(loop.greenfield),
      served: loop.served,
      total: loop.total,
      stages: loop.stages,
      rows: loopRows(loop),
    },
  };
}

export function demo() {
  const work = mkdtempSync(join(tmpdir(), "cortex-site-demo-"));
  try {
    return {
      schema: SCHEMA,
      version: readFileSync(join(CORTEX, "VERSION"), "utf8").trim(),
      scenarios: SCENARIOS.map((s) => capture(s, work)),
    };
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// --- the command ----------------------------------------------------------------------------------

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    if (i === -1) return null;
    if (!argv[i + 1]) throw new DemoError(`${name} needs a file`);
    return argv[i + 1];
  };
  const known = new Set(["--out", "--check"]);
  const stray = argv.find((a, i) => a.startsWith("--") ? !known.has(a) : !known.has(argv[i - 1]));
  if (stray) throw new DemoError(`unknown argument: ${stray}`);

  const out = flag("--out");
  const check = flag("--check");
  const text = `${JSON.stringify(demo(), null, 2)}\n`;

  if (check) {
    let was;
    try { was = readFileSync(check, "utf8").replace(/\r/g, ""); } catch { throw new DemoError(`cannot read ${check}`); }
    if (was === text) { console.log(`site demo matches ${check}`); return 0; }
    console.log(`site demo differs from ${check} — re-run with --out`);
    return 1;
  }
  if (out) { writeFileSync(out, text); console.log(`wrote ${out}`); return 0; }
  process.stdout.write(text);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    if (!(e instanceof DemoError)) throw e;
    console.error(`cortex-site-demo: ${e.message}`);
    process.exit(2);
  }
}
