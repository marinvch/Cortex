#!/usr/bin/env node
// The multi-repo half of install-on-a-project: the roadmap's acceptance scenarios S1–S4 (spec,
// step 7), run against whatever git repositories sit in one directory — a team's product repos
// plus the team-brain they share.
//
//   CORTEX_E2E_WORKSPACE=<dir> bash tools/test/run.sh install-on-a-project
//
// The fragment calls this; it is not a test on its own and prints nothing the runner does not count.
//
// READ-ONLY against <dir>. Every repo is cloned into --work first and every check runs on the
// clones, so S2 can record memories, push to a team-brain and join a team without touching the
// workspace. The last line asserts that, over the whole workspace, by fingerprint.
//
// Output: one line per scenario, `  PASS`, `  FAIL` or `  XFAIL (<step>)`, each followed by its
// checks. A scenario is XFAIL when the only checks failing are ones a named roadmap step exists to
// close, and FAIL when anything else fails — so a regression inside a scenario that is still
// expected to fail is not hidden behind its marker. Exits 1 only on a FAIL.
//
// Generic by design: it discovers what to check from the repos themselves (workspace manifests,
// Java packages, `.cortex/connector.json`, `team.md`). No repo, package or class name from any
// particular setup appears here, because this file ships and the setup it was proven on does not.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(REPO_ROOT, "index", "cortex-index.mjs");
const IMPACT = join(REPO_ROOT, "index", "cortex-impact.mjs");
const CLI = join(REPO_ROOT, "mcp", "ai-os.js");
const SERVER = join(REPO_ROOT, "mcp", "server.js");

const [wsArg, ...rest] = process.argv.slice(2);
const workFlag = rest.indexOf("--work");
if (!wsArg || workFlag < 0 || !rest[workFlag + 1]) {
  console.error("usage: e2e-workspace.mjs <workspace-dir> --work <scratch-dir>");
  process.exit(2);
}
const WS = resolve(wsArg);
const WORK = resolve(rest[workFlag + 1]);
mkdirSync(WORK, { recursive: true });

// A fixed identity and no developer profile: the clones commit, and neither the machine's git
// config nor a CORTEX_* variable in the caller's shell may decide what these checks see.
const BASE_ENV = (() => {
  const e = {
    ...process.env,
    GIT_AUTHOR_NAME: "cortex-e2e",
    GIT_AUTHOR_EMAIL: "cortex-e2e@example.invalid",
    GIT_COMMITTER_NAME: "cortex-e2e",
    GIT_COMMITTER_EMAIL: "cortex-e2e@example.invalid",
  };
  delete e.CORTEX_PROFILE;
  delete e.CORTEX_AUDIENCE;
  delete e.AI_OS_ROOT;
  return e;
})();

const git = (cwd, args) =>
  execFileSync("git", ["-C", cwd, ...args], { env: BASE_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// --- the workspace ------------------------------------------------------------------------------

function discover() {
  const repos = [];
  for (const name of readdirSync(WS).sort()) {
    const dir = join(WS, name);
    if (!statSync(dir).isDirectory() || !existsSync(join(dir, ".git"))) continue;
    const teamBrain = existsSync(join(dir, "team.md")) && existsSync(join(dir, "projects"));
    repos.push({ name, src: dir, teamBrain });
  }
  return repos;
}

/** HEAD, every ref and the working-tree status of each repo — what "untouched" has to preserve. */
function fingerprint(repos) {
  return repos
    .map((r) => [r.name, git(r.src, ["for-each-ref", "--format=%(refname) %(objectname)"]), git(r.src, ["status", "--porcelain", "--untracked-files=all"])].join("\n"))
    .join("\n--\n");
}

// --- result bookkeeping -------------------------------------------------------------------------

/** @typedef {{ ok: boolean, label: string, xfail?: string, detail?: string }} Check */

function scenario(id, title, checks) {
  const unexpected = checks.filter((c) => !c.ok && !c.xfail);
  const expected = checks.filter((c) => !c.ok && c.xfail);
  let status;
  if (unexpected.length) status = "FAIL";
  else if (expected.length) status = `XFAIL (${[...new Set(expected.map((c) => c.xfail))].join(", ")})`;
  else status = "PASS";
  console.log(`  ${status}  ${id} ${title}`);
  for (const c of checks) {
    const mark = c.ok ? "ok   " : c.xfail ? "xfail" : "FAIL ";
    console.log(`          ${mark} ${c.label}${c.xfail && !c.ok ? `  [${c.xfail}]` : ""}`);
    if (c.detail && !c.ok) console.log(`                ${c.detail}`);
  }
  return status === "FAIL" ? 1 : 0;
}

// --- S1 helpers: what the index should contain --------------------------------------------------

const JS_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

/** Workspace package name → directory, from pnpm-workspace.yaml and package.json `workspaces`. */
function workspacePackages(dir) {
  const patterns = [];
  const pnpm = join(dir, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) {
    let inPackages = false;
    for (const line of readFileSync(pnpm, "utf8").split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
      if (inPackages && /^\S/.test(line)) inPackages = false;
      const m = inPackages && line.match(/^\s*-\s*["']?([^"'#\s]+)["']?/);
      if (m) patterns.push(m[1]);
    }
  }
  const rootPkg = join(dir, "package.json");
  if (existsSync(rootPkg)) {
    try {
      const ws = JSON.parse(readFileSync(rootPkg, "utf8")).workspaces;
      patterns.push(...(Array.isArray(ws) ? ws : ws?.packages ?? []));
    } catch { /* an unparseable manifest declares nothing */ }
  }
  const dirs = [];
  for (const p of patterns) {
    if (p.startsWith("!")) continue;
    const clean = p.replace(/\/+$/, "");
    if (clean.endsWith("/*")) {
      const parent = join(dir, clean.slice(0, -2));
      if (existsSync(parent)) for (const d of readdirSync(parent)) dirs.push(posix.join(clean.slice(0, -2), d));
    } else if (!clean.includes("*")) dirs.push(clean);
  }
  const byName = new Map();
  for (const d of dirs) {
    const manifest = join(dir, d, "package.json");
    if (!existsSync(manifest)) continue;
    try {
      const name = JSON.parse(readFileSync(manifest, "utf8")).name;
      if (name) byName.set(name, d);
    } catch { /* skip */ }
  }
  return byName;
}

/** Every file → workspace-package import in a repo: the edges S1 says must resolve. */
function expectedWorkspaceEdges(dir, files) {
  const packages = workspacePackages(dir);
  const expected = [];
  if (!packages.size) return expected;
  for (const file of files.filter((f) => JS_EXT.test(f))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(SPECIFIER)) {
      const spec = m[1];
      for (const [name, pkgDir] of packages) {
        if ((spec === name || spec.startsWith(`${name}/`)) && !file.startsWith(`${pkgDir}/`)) {
          expected.push({ from: file, toDir: `${pkgDir}/`, via: spec });
        }
      }
    }
  }
  return expected;
}

/** Every bare use of a class declared beside a .java file, with no import: same-package references. */
function expectedJavaEdges(dir, files) {
  const expected = [];
  const byDir = new Map();
  for (const f of files.filter((f) => f.endsWith(".java"))) {
    const d = posix.dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }
  for (const [d, group] of byDir) {
    for (const file of group) {
      const code = readFileSync(join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/.*$/gm, " ")
        .replace(/"(?:\\.|[^"\\])*"/g, '""');
      const imported = new Set([...code.matchAll(/^\s*import\s+(?:static\s+)?[\w.]+\.(\w+)\s*;/gm)].map((m) => m[1]));
      for (const sibling of group) {
        if (sibling === file) continue;
        const cls = basename(sibling, ".java");
        if (!imported.has(cls) && new RegExp(`\\b${cls}\\b`).test(code)) {
          expected.push({ from: file, to: posix.join(d, `${cls}.java`) });
        }
      }
    }
  }
  return expected;
}

function sample(missing, fmt) {
  return missing.length ? `e.g. ${missing.slice(0, 2).map(fmt).join("; ")}` : undefined;
}

// --- S2 helpers: a team, simulated on clones ----------------------------------------------------

/** Spawn the real MCP server in `cwd`, call one tool, return its parsed text payload. */
function callTool(cwd, env, tool, args) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(process.execPath, [SERVER], { cwd, env });
    let buf = "";
    let err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${tool} timed out: ${err.trim()}`)); }, 30000);
    child.stderr.on("data", (d) => { err += d; });
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== 2) continue;
        clearTimeout(timer);
        child.kill();
        if (msg.error || msg.result?.isError) {
          reject(new Error(JSON.stringify(msg.error ?? msg.result).slice(0, 300)));
          return;
        }
        const text = msg.result?.content?.[0]?.text ?? "";
        try { resolveCall(JSON.parse(text)); } catch { resolveCall(text); }
        return;
      }
    });
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
  });
}

function day(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- main ---------------------------------------------------------------------------------------

const repos = discover();
const code = repos.filter((r) => !r.teamBrain);
const brains = repos.filter((r) => r.teamBrain);
const before = fingerprint(repos);
let failures = 0;

for (const r of repos) {
  r.clone = join(WORK, r.name);
  execFileSync("git", ["clone", "-q", "--no-hardlinks", r.src, r.clone], { env: BASE_ENV, stdio: "pipe" });
  r.files = r.teamBrain ? [] : git(r.clone, ["ls-files"]).split("\n").filter(Boolean);
}
console.log(`  workspace: ${code.length} code repo(s) [${code.map((r) => r.name).join(", ")}], ${brains.length} team-brain(s)`);

// S1 — install + correct map ---------------------------------------------------------------------
{
  const checks = [];
  let indexed = 0;
  for (const r of code) {
    r.indexPath = join(WORK, `${r.name}.index.json`);
    const run = spawnSync(process.execPath, [INDEX, r.clone, "--out", r.indexPath], { env: BASE_ENV, encoding: "utf8" });
    if (run.status === 0 && existsSync(r.indexPath)) {
      r.index = JSON.parse(readFileSync(r.indexPath, "utf8"));
      r.edges = new Set(r.index.edges.map((e) => `${e.from}\u0000${e.to}`));
      indexed += 1;
    }
  }
  checks.push({ ok: code.length > 0 && indexed === code.length, label: `index: ${indexed}/${code.length} code repos indexed` });

  const ws = [];
  const java = [];
  for (const r of code.filter((c) => c.index)) {
    for (const e of expectedWorkspaceEdges(r.clone, r.files)) {
      ws.push({ ...e, repo: r.name, ok: r.index.edges.some((x) => x.from === e.from && x.to.startsWith(e.toDir)) });
    }
    for (const e of expectedJavaEdges(r.clone, r.files)) {
      java.push({ ...e, repo: r.name, ok: r.edges.has(`${e.from}\u0000${e.to}`) });
    }
  }
  const wsMissing = ws.filter((e) => !e.ok);
  checks.push({
    ok: wsMissing.length === 0,
    label: `workspace-package imports resolve: ${ws.length - wsMissing.length}/${ws.length}`,
    xfail: "step 8.1",
    detail: sample(wsMissing, (e) => `${e.repo}: ${e.from} → ${e.toDir} (via ${e.via})`),
  });
  const javaMissing = java.filter((e) => !e.ok);
  checks.push({
    ok: javaMissing.length === 0,
    label: `Java same-package references resolve: ${java.length - javaMissing.length}/${java.length}`,
    xfail: "step 8.2",
    detail: sample(javaMissing, (e) => `${e.repo}: ${e.from} → ${e.to}`),
  });

  // The claude-setup checker is roadmap step 3. It does not exist yet, so this can only say so; the
  // step that builds it replaces this branch with a real run over everything /cortex wrote.
  const checkerBuilt = readdirSync(join(REPO_ROOT, "index", "lib")).some((f) =>
    /claudeSetupFindings/.test(readFileSync(join(REPO_ROOT, "index", "lib", f), "utf8")),
  );
  checks.push(
    checkerBuilt
      ? { ok: false, label: "claude-setup checker: it exists now — replace this placeholder with a real run of it" }
      : { ok: false, label: "claude-setup checker reports zero findings on what /cortex wrote (not built yet)", xfail: "step 3" },
  );
  failures += scenario("S1", "install + correct map", checks);
}

// S2 — team memory across repos ------------------------------------------------------------------
{
  const checks = [];
  const brain = brains[0];
  const connected = code.filter((r) => existsSync(join(r.clone, ".cortex", "connector.json")));
  checks.push({ ok: Boolean(brain), label: `a team-brain is in the workspace${brain ? ` (${brain.name})` : ""}` });
  checks.push({ ok: connected.length >= 2, label: `at least two code repos carry .cortex/connector.json: ${connected.length}` });

  if (brain && connected.length >= 2) {
    const team = (readFileSync(join(brain.clone, "team.md"), "utf8").match(/^# Team:\s*(.+)$/m) ?? [])[1]?.trim();
    const remote = join(WORK, `${brain.name}.git`);
    execFileSync("git", ["clone", "-q", "--bare", brain.src, remote], { env: BASE_ENV, stdio: "pipe" });

    // Everyone joins first, exactly as documented (/team-add), each with a vault of their own —
    // then the writes happen. Joining after the write would clone a fresh copy that already holds
    // the note, and pass a check the daily case fails.
    let joined = 0;
    for (const r of connected) {
      const connector = JSON.parse(readFileSync(join(r.clone, ".cortex", "connector.json"), "utf8"));
      r.vault = join(WORK, `vault-${r.name}`);
      mkdirSync(r.vault, { recursive: true });
      r.env = { ...BASE_ENV, AI_OS_ROOT: r.vault };
      const add = spawnSync(process.execPath, [CLI, "team", "add", "--name", team ?? "", "--repo", remote, "--slug", String(connector.slug ?? "")], {
        cwd: r.clone, env: r.env, encoding: "utf8",
      });
      if (add.status === 0) joined += 1;
      else r.joinError = (add.stderr || add.stdout).trim().split("\n")[0];
    }
    checks.push({
      ok: Boolean(team) && joined === connected.length,
      label: `every connected repo joins team "${team ?? "?"}" via team add: ${joined}/${connected.length}`,
      detail: connected.find((r) => r.joinError)?.joinError,
    });

    const tokenOf = (r) => `e2e-${r.name}-${process.pid}`;
    let reached = 0;
    const captureErrors = [];
    for (const r of connected) {
      try {
        const res = await callTool(r.clone, r.env, "capture", { content: `S2 memory ${tokenOf(r)}`, project: r.name });
        const onRemote = spawnSync("git", ["--git-dir", remote, "grep", "-q", tokenOf(r), "HEAD"], { env: BASE_ENV }).status === 0;
        if (onRemote) reached += 1;
        else captureErrors.push(`${r.name}: pushed=${res?.pushed} ${res?.error ?? ""} → ${res?.path ?? res}`.slice(0, 240));
      } catch (e) {
        captureErrors.push(`${r.name}: ${e.message}`.slice(0, 240));
      }
    }
    checks.push({
      ok: reached === connected.length,
      label: `a memory captured in each repo reaches the team-brain remote: ${reached}/${connected.length}`,
      detail: captureErrors[0],
    });

    let seen = 0;
    let pairs = 0;
    const misses = [];
    for (const reader of connected) {
      const run = spawnSync(process.execPath, [CLI, "catch-up", "--since", day(-1)], { cwd: reader.clone, env: reader.env, encoding: "utf8" });
      for (const writer of connected) {
        if (writer === reader) continue;
        pairs += 1;
        if (run.status === 0 && run.stdout.includes(tokenOf(writer))) seen += 1;
        else misses.push(`${reader.name} does not see ${writer.name}'s memory${run.status ? ` (exit ${run.status}: ${run.stderr.trim().split("\n")[0]})` : ""}`);
      }
    }
    checks.push({
      ok: pairs > 0 && seen === pairs,
      label: `catch-up in each repo returns every other repo's memory: ${seen}/${pairs}`,
      detail: misses[0],
    });
  }
  failures += scenario("S2", "team memory across repos", checks);
}

// S3 — FE ↔ BE: who serves this call -------------------------------------------------------------
{
  // Step 8.3 puts a route map in the index. Until an index carries one there is nothing to resolve;
  // once one does, this must become the real check, so it stops being an expected failure.
  const withRoutes = code.filter((r) => r.index && "routes" in r.index);
  failures += scenario("S3", "FE ↔ BE: a gateway route resolves to the controller serving it", [
    withRoutes.length
      ? { ok: false, label: `the index carries routes now (${withRoutes.map((r) => r.name).join(", ")}) — write the real cross-repo check` }
      : { ok: false, label: "no index carries a route map yet", xfail: "step 8.3" },
  ]);
}

// S4 — daily team rituals ------------------------------------------------------------------------
{
  const checks = [];
  const overlapBuilt = /--against\b/.test(readFileSync(IMPACT, "utf8"));
  checks.push(
    overlapBuilt
      ? { ok: false, label: "cortex-impact takes --against now — write the real overlap check" }
      : { ok: false, label: "two changed-file sets that overlap get a warning (cortex-impact --against)", xfail: "step 8.4" },
  );
  const reviewing = code.filter((r) => {
    const wf = join(r.clone, ".github", "workflows");
    return existsSync(wf) && readdirSync(wf).some((f) => /\.ya?ml$/.test(f) && /cortex-review/.test(readFileSync(join(wf, f), "utf8")));
  });
  checks.push({
    ok: reviewing.length > 0,
    label: `/cortex-review runs in CI on a PR: ${reviewing.length}/${code.length} code repos have a workflow that runs it`,
    detail: reviewing.length ? undefined : "no workflow in any code repo invokes cortex-review, and no roadmap step stamps one",
  });
  failures += scenario("S4", "daily team rituals", checks);
}

// The promise this mode makes: the workspace is exactly as it was.
const untouched = fingerprint(repos) === before;
console.log(untouched ? "  PASS  the workspace is left untouched (refs and working trees)" : "  FAIL  the workspace was modified by the run");
if (!untouched) failures += 1;

process.exit(failures ? 1 : 0);
