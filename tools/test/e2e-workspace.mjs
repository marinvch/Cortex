#!/usr/bin/env node
// The multi-repo half of install-on-a-project: the roadmap's acceptance scenarios S1–S4 (spec,
// step 7) and S5, the agent team (plan step 15), run against whatever git repositories sit in one directory — a team's product repos
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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(REPO_ROOT, "index", "cortex-index.mjs");
const FINDINGS = join(REPO_ROOT, "index", "cortex-findings.mjs");
const IMPACT = join(REPO_ROOT, "index", "cortex-impact.mjs");
const LOOP = join(REPO_ROOT, "index", "cortex-loop.mjs");
const ROUTES = join(REPO_ROOT, "index", "cortex-routes.mjs");
const STAMPS = join(REPO_ROOT, "index", "cortex-stamps.mjs");
const SECTION = join(REPO_ROOT, "index", "cortex-section.mjs");
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
const REPOS = join(WORK, "repos");
mkdirSync(REPOS, { recursive: true });

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
  delete e.CORTEX_ROOT;
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

// --- S4 helpers: two people on one repo ---------------------------------------------------------

/**
 * Two identities edit one clone and `cortex-impact --against` must warn them (#408, step 8.4).
 *
 * Built from the repo's own graph so it stays generic: the first import edge `from → to` (sorted,
 * so the choice is stable) gives the one-hop collision, and one more indexed file both sides touch
 * gives the direct overlap. "Theirs" is committed on a branch by a second identity; "mine" is
 * staged, uncommitted, by the first. Both forms the command takes are checked — the branch
 * (`--against-ref`) and a change list with CRLF endings (`--against`), which is how a session's
 * uncommitted work arrives. The clone is reset afterwards; the workspace itself is never touched.
 */
function overlapCheck() {
  const label = "two identities editing overlapping files get a warning (cortex-impact --against)";
  const pick = (r) => {
    const edge = [...r.index.edges]
      .filter((e) => e.from !== e.to)
      .sort((a, b) => (a.from + "\u0000" + a.to < b.from + "\u0000" + b.to ? -1 : 1))[0];
    if (!edge) return null;
    const shared = r.index.files.map((f) => f.path).sort().find((p) => p !== edge.from && p !== edge.to);
    return shared ? { edge, shared } : null;
  };
  const r = code.find((c) => c.index && pick(c));
  if (!r) return { ok: false, label, detail: "no indexed code repo has an import edge to build two colliding change sets from" };
  const { edge, shared } = pick(r);

  const touch = (rel) => writeFileSync(join(r.clone, rel), `${readFileSync(join(r.clone, rel), "utf8")}\n`);
  const as = (who) => ({ ...BASE_ENV, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: `${who}@example.invalid`, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: `${who}@example.invalid` });
  const g = (env, args) => execFileSync("git", ["-C", r.clone, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const branch = "e2e-overlap-theirs";
  const home = g(BASE_ENV, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  try {
    g(BASE_ENV, ["checkout", "-q", "-b", branch]);
    touch(edge.to);
    touch(shared);
    g(as("e2e-theirs"), ["commit", "-q", "-am", "theirs: overlapping change"]);
    g(BASE_ENV, ["checkout", "-q", home]);
    touch(edge.from);
    touch(shared);
    g(as("e2e-mine"), ["add", "--", edge.from, shared]);

    const listPath = join(WORK, `${r.name}.theirs.txt`);
    writeFileSync(listPath, `${edge.to}\r\n${shared}\r\n`);
    const forms = [["--against-ref", branch], ["--against", listPath]];
    const misses = [];
    for (const form of forms) {
      const run = spawnSync(process.execPath, [IMPACT, "--root", r.clone, "--index", r.indexPath, "--staged", ...form, "--json"], { env: BASE_ENV, encoding: "utf8" });
      let o = null;
      try { o = JSON.parse(run.stdout); } catch { /* reported below */ }
      const overlapOk = o?.overlap?.includes(shared);
      const collisionOk = o?.collisions?.some((c) => c.mine === edge.from && c.theirs === edge.to && c.edge === "mine-imports-theirs");
      if (run.status !== 0 || !overlapOk || !collisionOk) {
        misses.push(`${form[0]}: exit ${run.status}, overlap ${overlapOk ? "ok" : "missing"} (${shared}), collision ${collisionOk ? "ok" : "missing"} (${edge.from} → ${edge.to})${run.stderr ? ` — ${run.stderr.trim().split("\n")[0]}` : ""}`);
      }
    }
    return {
      ok: misses.length === 0,
      label: `${label}: ${r.name}, ${forms.length - misses.length}/${forms.length} forms warn`,
      detail: misses[0],
    };
  } catch (e) {
    return { ok: false, label, detail: `${r.name}: ${String(e.message).split("\n")[0]}` };
  } finally {
    try {
      g(BASE_ENV, ["reset", "-q", "--hard"]);
      g(BASE_ENV, ["checkout", "-q", home]);
    } catch { /* the clone is scratch; the workspace fingerprint is what matters */ }
  }
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
  // Clones sit together in their own directory, so that directory is itself a workspace — the one
  // S3 hands to cortex-routes — with none of the scratch files, vaults or bare remotes beside it.
  r.clone = join(REPOS, r.name);
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

  // What /cortex wrote under .claude/ actually landed. The workspace repos are installed by a
  // headless `claude -p "/cortex"`, and Claude Code never auto-approves a write under .claude/:
  // allow rules do not change that, and -p has nobody to ask, so the verifier and the hooks are
  // refused while AGENTS.md, CLAUDE.md and REVIEW.md land — an install that reads as done. Only
  // repos where /cortex evidently ran (the root brief is present) are judged; the rest are not
  // installed, which is a different failure with its own row above.
  const refused = [];
  const served = [];
  let installed = 0;
  for (const r of code) {
    const run = spawnSync(process.execPath, [LOOP, r.clone, "--json"], { env: BASE_ENV, encoding: "utf8" });
    if (run.status !== 0) continue;
    const plan = JSON.parse(run.stdout);
    if (!plan.present.some((e) => e.id === "brief")) continue;
    installed += 1;
    served.push(r);
    const paths = plan.missing.flatMap((e) => e.protectedWrites ?? []);
    if (paths.length) refused.push({ repo: r.name, paths });
  }
  if (installed) {
    checks.push({
      ok: refused.length === 0,
      label: `/cortex's .claude/ artifacts are on disk: ${installed - refused.length}/${installed} installed repos`,
      detail: refused.length
        ? `${sample(refused, (e) => `${e.repo} lacks ${e.paths.join(", ")}`)} — Claude Code refuses .claude/ writes under claude -p; ` +
          "rerun /cortex with --permission-mode auto (skills/cortex/RUNS.md, Running unattended)"
        : undefined,
    });
  }

  // And what /cortex wrote passes Cortex's own claude-setup checker (spec S1, roadmap step 3) — the
  // same repos as the line above, so the two counts share one denominator. Run through
  // cortex-findings --json, the CLI a user has, rather than by importing index/lib: tools/ does not
  // reach into a leaf. A repo /cortex never served is not judged here, for the reason given above.
  if (installed) {
    const flagged = [];
    for (const r of served) {
      const args = [FINDINGS, r.clone, "--json", ...(r.index ? ["--index", r.indexPath] : [])];
      const run = spawnSync(process.execPath, args, { env: BASE_ENV, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      let all = null;
      try { all = JSON.parse(run.stdout); } catch { /* reported below */ }
      if (run.status !== 0 || !Array.isArray(all)) {
        flagged.push({ repo: r.name, first: `cortex-findings --json failed (exit ${run.status}): ${(run.stderr || run.stdout).trim().split("\n")[0]}` });
        continue;
      }
      const found = all.filter((f) => String(f.kind).startsWith("claude-setup/"));
      if (found.length) {
        const f = found[0];
        flagged.push({ repo: r.name, count: found.length, first: `${f.kind} — ${f.title}${f.evidence?.[0] ? ` (${f.evidence[0]})` : ""}` });
      }
    }
    checks.push({
      ok: flagged.length === 0,
      label: `claude-setup checker finds nothing in what /cortex wrote: ${installed - flagged.length}/${installed} installed repos`,
      detail: flagged.length
        ? `${flagged[0].repo}: ${flagged[0].first}${flagged[0].count > 1 ? ` (+${flagged[0].count - 1} more)` : ""}` +
          (flagged.length > 1 ? `; also ${flagged.slice(1).map((e) => e.repo).join(", ")}` : "")
        : undefined,
    });
  } else {
    // Nothing was served, so nothing /cortex wrote can be checked — a zero here would pass by
    // checking nothing. Said, not skipped.
    checks.push({
      ok: false,
      label: `claude-setup checker: no code repo has been served by /cortex (root AGENTS.md + CLAUDE.md): 0/${code.length}`,
      detail: "run /cortex in each code repo first (skills/cortex/RUNS.md, Running unattended)",
    });
  }
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
      r.env = { ...BASE_ENV, CORTEX_ROOT: r.vault };
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
  // The route map is joined across every code repo by cortex-routes, run on the clones exactly as a
  // user runs it on a checkout directory. Generic: whatever gateway routes and calls the workspace
  // declares are what must resolve.
  const checks = [];
  const indexed = code.filter((r) => r.index);
  const withRoutes = indexed.filter((r) => "routes" in r.index);
  checks.push({ ok: indexed.length > 0 && withRoutes.length === indexed.length, label: `every index carries a route map: ${withRoutes.length}/${indexed.length}` });

  const run = spawnSync(process.execPath, [ROUTES, REPOS, "--workspace", "--json"], { env: BASE_ENV, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let map = null;
  try { map = JSON.parse(run.stdout); } catch { /* reported below */ }
  checks.push({
    ok: run.status === 0 && Boolean(map),
    label: "cortex-routes --workspace runs over the clones",
    detail: map ? undefined : (run.stderr || run.stdout).trim().split("\n")[0],
  });

  if (map) {
    // Each gateway route must reach a handler, and in ONE repo — two services with one API shape
    // are told apart by the route's target, or the map cannot say who serves the call.
    const gw = map.gatewayRoutes;
    const good = gw.filter((g) => new Set(g.handlers.map((h) => h.repo)).size === 1);
    checks.push({
      ok: gw.length > 0 && good.length === gw.length,
      label: `gateway routes resolve to the controller serving them, in one repo each: ${good.length}/${gw.length}`,
      detail: gw.length
        ? sample(gw.filter((g) => !good.includes(g)), (g) => `${g.gateway.prefix} (${g.gateway.repo}/${g.gateway.file}:${g.gateway.line}) → ${[...new Set(g.handlers.map((h) => h.repo))].join(", ") || "nothing"}`)
        : "no gateway route in any repo",
    });
    const ours = map.links.filter((l) => !l.call.host || ["localhost", "127.0.0.1"].includes(l.call.host));
    const served = ours.filter((l) => l.targets.length);
    checks.push({
      ok: ours.length > 0 && served.length === ours.length,
      label: `front-end calls reach a Spring handler: ${served.length}/${ours.length}`,
      detail: ours.length
        ? sample(ours.filter((l) => !l.targets.length), (l) => `${l.call.method} ${l.call.path} (${l.call.repo}/${l.call.file}:${l.call.line})`)
        : "no front-end call in any repo",
    });
  }
  failures += scenario("S3", "FE ↔ BE: a gateway route resolves to the controller serving it", checks);
}

// S4 — daily team rituals ------------------------------------------------------------------------
{
  const checks = [];
  checks.push(overlapCheck());
  // /cortex-review in CI, run the way a PR runs it. Each clone gets the workflow /cortex stamps
  // (unless it already carries one that runs cortex-review), committed as the base; then a PR-shaped
  // branch changes one indexed file, and the workflow's own review step runs on base...head with
  // $CORTEX pointed at this checkout — the release the workflow would have cloned.
  const { parseYaml } = await import(pathToFileURL(join(REPO_ROOT, "index", "test", "yaml-lite.mjs")).href);
  const version = readFileSync(join(REPO_ROOT, "VERSION"), "utf8").trim();
  const reviewWorkflow = (dir) => {
    const wf = join(dir, ".github", "workflows");
    if (!existsSync(wf)) return null;
    const f = readdirSync(wf).sort().find((n) => /\.ya?ml$/.test(n) && /cortex-review/.test(readFileSync(join(wf, n), "utf8")));
    return f ? join(wf, f) : null;
  };
  let stamped = 0;
  let ran = 0;
  let againstDocs = 0;
  const reviewErrors = [];
  const candidates = code.filter((r) => r.index);
  for (const r of candidates) {
    try {
      let wfPath = reviewWorkflow(r.clone);
      if (!wfPath) {
        wfPath = join(r.clone, ".github", "workflows", "cortex-review.yml");
        mkdirSync(dirname(wfPath), { recursive: true });
        const body = readFileSync(join(REPO_ROOT, "templates", "loop", "cortex-review.yml"), "utf8").replaceAll("{{CORTEX_REF}}", `v${version}`);
        writeFileSync(wfPath, body);
        git(r.clone, ["add", "--", ".github/workflows/cortex-review.yml"]);
        git(r.clone, ["commit", "-q", "-m", "Stamp cortex-review.yml", "--", ".github/workflows/cortex-review.yml"]);
        stamped += 1;
      }
      const steps = Object.values(parseYaml(readFileSync(wfPath, "utf8")).jobs ?? {}).flatMap((j) => j.steps ?? []);
      const step = steps.find((s) => /cortex-review\.mjs/.test(s.run ?? ""));
      if (!step) throw new Error(`${basename(wfPath)} names cortex-review but no step runs cortex-review.mjs`);

      const base = git(r.clone, ["rev-parse", "HEAD"]).trim();
      const target = r.index.files.map((f) => f.path ?? f).find((p) => !/\.md$/i.test(p) && existsSync(join(r.clone, p))) ?? null;
      if (!target) throw new Error("the index lists no file to change");
      git(r.clone, ["checkout", "-q", "-b", "e2e-review-pr"]);
      appendFileSync(join(r.clone, target), "\n");
      git(r.clone, ["commit", "-q", "-m", "A PR-shaped change", "--", target]);

      const temp = join(WORK, `review-${r.name}`);
      mkdirSync(temp, { recursive: true });
      const run = spawnSync("bash", ["-c", step.run], {
        cwd: r.clone,
        env: { ...BASE_ENV, CORTEX: REPO_ROOT, BASE: base, BLOCKING: "", RUNNER_TEMP: temp, GITHUB_STEP_SUMMARY: join(temp, "summary.md") },
        encoding: "utf8",
      });
      const out = `${run.stdout}${run.stderr}`;
      // The step is advisory, so it exits 0 even when a command inside it failed — it says so in a
      // `::warning::` instead. Exit 0 alone would pass a review that never ran.
      const broken = out.match(/^::warning::(?:Cortex could not|cortex-review).*$/m);
      if (run.status === 0 && !broken && /Changed \(\d+\)|no context layer/.test(out)) ran += 1;
      else reviewErrors.push(`${r.name}: exit ${run.status} — ${broken?.[0] ?? out.trim().split("\n").slice(-2).join(" / ")}`.slice(0, 300));
      if (!broken && /Documents governing this change/.test(out)) againstDocs += 1;
    } catch (e) {
      reviewErrors.push(`${r.name}: ${String(e.message ?? e).split("\n")[0]}`.slice(0, 300));
    }
  }
  checks.push({
    ok: candidates.length > 0 && ran === candidates.length,
    label: `/cortex-review runs in CI on a PR: the review step ran on ${ran}/${candidates.length} code repos (${stamped} stamped from templates/loop/cortex-review.yml)`,
    detail: reviewErrors[0],
  });
  checks.push({
    ok: againstDocs > 0,
    label: `and read the PR against the repo's own documents in ${againstDocs}/${candidates.length}`,
    detail: againstDocs || ran < candidates.length
      ? undefined
      : "no code repo has a context layer (AGENTS.md, CONTEXT.md or ADRs) for the review to read back — run /cortex on one",
  });
  failures += scenario("S4", "daily team rituals", checks);
}

// S5 — the agent team ------------------------------------------------------------------------------
{
  // The deterministic half of plan step 15: what /cortex stamps of the agent team is sound on disk.
  // Whether a model then follows the playbook is the live half, which is not a test that belongs in
  // a suite. Everything here goes through the CLIs a user has; tools/ does not reach into a leaf.
  const checks = [];
  const indexed = code.filter((r) => r.index);
  const json = (script, args) => {
    const run = spawnSync(process.execPath, [script, ...args], { env: BASE_ENV, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    try { return { ok: run.status === 0, out: JSON.parse(run.stdout) }; } catch { return { ok: false, err: (run.stderr || run.stdout).trim().split("\n")[0] }; }
  };

  // Which repos carry the team: the playbook section in CLAUDE.md is how a repo is known to have one
  // (the loop's `team` row reads the same), and a repo the row offers but that never took it is
  // named, not failed — every role is the developer's pick, and so is the team itself.
  const teams = [];
  const offeredOnly = [];
  const loopErrors = [];
  for (const r of indexed) {
    const plan = json(LOOP, [r.clone, "--index", r.indexPath, "--json"]);
    if (!plan.ok) { loopErrors.push(`${r.name}: ${plan.err}`); continue; }
    const row = ["present", "missing", "blocked"].find((b) => plan.out[b].some((e) => e.id === "team"));
    if (row === "present") teams.push({ ...r, agentTeam: plan.out.state.agentTeam });
    else if (row === "missing") offeredOnly.push(r.name);
  }
  checks.push({
    ok: teams.length > 0 && loopErrors.length === 0,
    label: `the team is stamped in ${teams.length}/${indexed.length} code repos${offeredOnly.length ? ` (offered, not taken: ${offeredOnly.join(", ")})` : ""}`,
    detail: loopErrors[0] ?? (teams.length ? undefined : "no code repo carries the playbook in CLAUDE.md — run /cortex and pick the team"),
  });

  if (teams.length) {
    // The team's files are the ones the record says came from a team/ template.
    const flagged = [];
    const stale = [];
    let files = 0;
    for (const r of teams) {
      const status = json(STAMPS, [r.clone, "--json"]);
      if (!status.ok) { stale.push(`${r.name}: cortex-stamps --json failed: ${status.err}`); continue; }
      r.teamFiles = status.out.files.filter((f) => String(f.template).startsWith("team/"));
      files += r.teamFiles.length;
      for (const f of r.teamFiles) if (f.state !== "current") stale.push(`${r.name}: ${f.path} is ${f.state}`);
      const found = json(FINDINGS, [r.clone, "--json", "--index", r.indexPath]);
      if (!found.ok) { flagged.push(`${r.name}: cortex-findings --json failed: ${found.err}`); continue; }
      for (const f of found.out.filter((x) => String(x.kind).startsWith("claude-setup/"))) {
        const where = [f.file, ...(f.evidence ?? [])].join(" ");
        if (r.teamFiles.some((t) => where.includes(t.path))) flagged.push(`${r.name}: ${f.kind} — ${f.evidence?.[0] ?? f.title}`);
      }
    }
    checks.push({
      ok: files > 0 && flagged.length === 0,
      label: `every stamped team file passes the claude-setup checker: ${files} files in ${teams.length} repos, ${flagged.length} flagged`,
      detail: flagged[0] ?? (files ? undefined : "the record holds no file from a team/ template"),
    });
    checks.push({
      ok: files > 0 && stale.length === 0,
      label: `the stamp record reads every team file as current: ${files - stale.length}/${files}`,
      detail: stale.length ? `${stale[0]} — node index/cortex-stamps.mjs <repo> says what to do` : undefined,
    });

    // The playbook is a section of CLAUDE.md, outside the record, so its currency is its own check
    // (#505): a workspace stamped by an earlier release reads `outdated` here until /cortex replaces it.
    // A section the team edited is theirs — named, never a failure.
    const behind = [];
    const edited = [];
    for (const r of teams) {
      const s = json(SECTION, [r.clone, "--json"]);
      if (!s.ok) { behind.push(`${r.name}: cortex-section --json failed: ${s.err}`); continue; }
      const team = s.out.sections.find((x) => x.id === "team");
      if (team?.state === "edited") edited.push(r.name);
      else if (team?.state !== "current") behind.push(`${r.name}: ${team?.why ?? "no team section reported"}`);
    }
    checks.push({
      ok: behind.length === 0,
      label: `the team section in CLAUDE.md is this release's text or the team's own: ${teams.length - behind.length}/${teams.length} repos` +
        (edited.length ? ` (edited by the team: ${edited.join(", ")})` : ""),
      detail: behind.length ? `${behind[0]} — node index/cortex-section.mjs <repo> shows the diff` : undefined,
    });

    // The roster line names exactly the agents that play a role: each stamped role, and each agent
    // already here that covers one. A name there with no agent behind it sends the session to an
    // agent that does not exist; an agent missing from it is never called.
    const rosterMisses = [];
    for (const r of teams) {
      const md = readFileSync(join(r.clone, "CLAUDE.md"), "utf8");
      const section = md.split(/^##+\s+Working as a team\s*$/m)[1]?.split(/^##\s/m)[0] ?? "";
      const line = section.split("\n").find((l) => /single-job agents/.test(l)) ?? "";
      const named = [...line.slice(line.indexOf(":") + 1).matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((n) => !n.includes("/")).sort();
      const playing = [...new Set(Object.values(r.agentTeam?.covered ?? {}).flat().map((a) => a.name))].sort();
      if (!named.length || named.join() !== playing.join()) rosterMisses.push(`${r.name}: CLAUDE.md names [${named.join(", ")}], the agents playing a role are [${playing.join(", ")}]`);
    }
    checks.push({
      ok: rosterMisses.length === 0,
      label: `the roster in CLAUDE.md names exactly the agents that play a role: ${teams.length - rosterMisses.length}/${teams.length} repos`,
      detail: rosterMisses[0],
    });

    // The Tester's fence, run the way the hook runs it: a PreToolUse payload on stdin, the project
    // directory in the environment, exit 2 to refuse. A source file of the repo's own and one of its
    // tests, both from the index.
    const fenceMisses = [];
    let fenced = 0;
    for (const r of teams) {
      const hook = join(r.clone, ".claude", "hooks", "test-paths.sh");
      if (!existsSync(hook)) continue;
      fenced += 1;
      const files = r.index.files.filter((f) => f.category === "code").map((f) => f.path).sort();
      const src = files.find((p) => !r.index.files.find((f) => f.path === p).isTest);
      // Not from .claude/: the fence refuses every path there, and is itself named like a test.
      const test = r.index.files.filter((f) => f.isTest && !f.path.startsWith(".claude/")).map((f) => f.path).sort()[0];
      if (!src || !test) { fenceMisses.push(`${r.name}: the index has no ${src ? "test" : "source"} file to try the fence on`); continue; }
      const edit = (rel) => spawnSync("bash", [hook], {
        input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: join(r.clone, ...rel.split("/")) } }),
        env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: r.clone },
        encoding: "utf8",
      }).status;
      const [s, t] = [edit(src), edit(test)];
      if (s !== 2 || t !== 0) fenceMisses.push(`${r.name}: ${src} exit ${s} (want 2), ${test} exit ${t} (want 0)`);
    }
    checks.push({
      ok: fenced > 0 && fenceMisses.length === 0,
      label: `test-paths.sh refuses a source edit and allows a test edit: ${fenced - fenceMisses.length}/${fenced} repos with a Tester`,
      detail: fenceMisses[0] ?? (fenced ? undefined : "no team repo has the Tester's fence"),
    });
  }

  // Sizing: a one-file fix is single, a change set across the team line's worth of areas is team.
  // Both built from a repo's own index — the fix is its first source file nothing imports, the
  // cross-area set one source file from each area until the line is reached — so the file stays
  // generic. `areas.names` of a one-file --size run is how an area is read without reaching into
  // index/lib.
  const size = (r, paths) => json(IMPACT, [...paths, "--root", r.clone, "--index", r.indexPath, "--size", "--json"]).out;
  const sizing = [];
  const repoForSize = indexed.find((r) => r.index.files.some((f) => f.category === "code" && !f.isTest));
  if (repoForSize) {
    const r = repoForSize;
    const imported = new Set(r.index.edges.map((e) => e.to));
    const source = r.index.files.filter((f) => f.category === "code" && !f.isTest).map((f) => f.path).sort();
    const fix = source.find((p) => !imported.has(p));
    const one = fix ? size(r, [fix]) : null;
    sizing.push({
      ok: one?.recommendation === "single",
      label: `cortex-impact --size recommends single for a one-file fix: ${r.name} ${fix ?? "(no unimported source file)"} → ${one?.recommendation ?? "no answer"}`,
      detail: one?.recommendation === "single" ? undefined : one?.reasons?.find((x) => /at or over/.test(x)),
    });
    let cross = null;
    let picked = [];
    for (const c of indexed) {
      const byArea = new Map();
      let line = 3;
      for (const p of c.index.files.filter((f) => f.category === "code" && !f.isTest).map((f) => f.path).sort()) {
        const s = size(c, [p]);
        const area = s?.signals?.areas?.names?.[0];
        line = s?.signals?.areas?.threshold ?? line;
        if (area && !byArea.has(area)) byArea.set(area, p);
        if (byArea.size >= line) break;
      }
      if (byArea.size >= line) { cross = c; picked = [...byArea.values()]; break; }
    }
    const many = cross ? size(cross, picked) : null;
    sizing.push({
      ok: many?.recommendation === "team",
      label: cross
        ? `and team for a change set across ${picked.length} areas: ${cross.name} [${picked.join(", ")}] → ${many?.recommendation ?? "no answer"}`
        : "and team for a cross-area change set: no code repo has enough areas of source to build one",
      detail: many?.recommendation === "team" ? undefined : many?.reasons?.[0],
    });
  } else {
    sizing.push({ ok: false, label: "cortex-impact --size: no indexed code repo has a source file to size" });
  }
  checks.push(...sizing);
  failures += scenario("S5", "the agent team: stamped, checked, sized and fenced", checks);
}

// The promise this mode makes: the workspace is exactly as it was.
const untouched = fingerprint(repos) === before;
console.log(untouched ? "  PASS  the workspace is left untouched (refs and working trees)" : "  FAIL  the workspace was modified by the run");
if (!untouched) failures += 1;

process.exit(failures ? 1 : 0);
