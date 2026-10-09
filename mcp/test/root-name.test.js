// The root has two names, and one rule orders them (#552).
//
// `CORTEX_ROOT` is the name. `AI_OS_ROOT` is what every registration made before it carries, so it
// stays read: only the new one set, only the old one set, both equal, both different, neither, and
// an empty string each have one answer, and both adapters give it. `core/test/root-from-env.test.js`
// owns the rule itself. What is tested here is that the server and the CLI obey it — over a spawned
// process, because a unit test of the helper passes just as happily when an adapter never calls it.
//
// Every environment below sets or clears BOTH variables. A developer's shell may carry either one,
// and a test that inherits it is testing that shell.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openBrain, MissingRootError, NoRootError } from "../lib/brain.js";
import { resolveBrain } from "../lib/resolve.js";
import { tempDir } from "./tmp.js";

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(MCP_DIR, "ai-os.js");
const SERVER = join(MCP_DIR, "server.js");

/** The caller's environment with every variable that picks a brain removed, then `extra` on top. */
function cleanEnv(extra = {}) {
  const e = { ...process.env };
  for (const k of ["CORTEX_ROOT", "AI_OS_ROOT", "CORTEX_PROFILE", "CORTEX_AUDIENCE"]) delete e[k];
  return Object.assign(e, extra);
}

const INIT = [
  { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 1, method: "tools/list" },
].map((m) => JSON.stringify(m)).join("\n") + "\n";

/** Start the real server, hand it a short session, and return what it wrote once stdin closes. */
function server(env, { cwd } = {}) {
  const r = spawnSync(process.execPath, [SERVER], { cwd: cwd ?? tempDir("root-cwd-"), env: cleanEnv(env), input: INIT, encoding: "utf8", timeout: 20000 });
  return { status: r.status, stdout: r.stdout, lines: r.stderr.split(/\r?\n/).filter((l) => l.trim()) };
}

function cli(argv, env, { cwd } = {}) {
  return spawnSync(process.execPath, [CLI, ...argv], { cwd: cwd ?? tempDir("root-cwd-"), env: cleanEnv(env), encoding: "utf8", timeout: 20000 });
}

const rootOf = (lines) => lines.map((l) => /\broot=(.*)$/.exec(l)?.[1]).find(Boolean);

// ---------------------------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------------------------

test("CORTEX_ROOT alone opens the brain, and the record says which variable named it", () => {
  const v = tempDir("root-new-");
  const b = openBrain({ cwd: v, env: { CORTEX_ROOT: v } });
  assert.equal(b.root, v);
  assert.equal(b.sources.root, "CORTEX_ROOT");
  assert.deepEqual(b.notices, []);
});

test("AI_OS_ROOT alone still opens the brain, with nothing to say about it", () => {
  const v = tempDir("root-old-");
  const b = openBrain({ cwd: v, env: { AI_OS_ROOT: v } });
  assert.equal(b.root, v);
  assert.equal(b.sources.root, "AI_OS_ROOT");
  assert.deepEqual(b.notices, [], "the old name is supported, not deprecated: no warning");
});

test("both names, same path: one root and nothing to report", () => {
  const v = tempDir("root-same-");
  const b = openBrain({ cwd: v, env: { CORTEX_ROOT: v, AI_OS_ROOT: v } });
  assert.equal(b.root, v);
  assert.equal(b.sources.root, "CORTEX_ROOT");
  assert.deepEqual(b.notices, []);
});

test("both names, different paths: CORTEX_ROOT wins and one notice names both", () => {
  const fresh = tempDir("root-wins-");
  const old = tempDir("root-loses-");
  const b = openBrain({ cwd: fresh, env: { CORTEX_ROOT: fresh, AI_OS_ROOT: old } });
  assert.equal(b.root, fresh);
  assert.equal(b.notices.length, 1);
  assert.match(b.notices[0], /^cortex: /);
  assert.ok(b.notices[0].includes(fresh) && b.notices[0].includes(old), b.notices[0]);
  assert.match(b.notices[0], /CORTEX_ROOT/);
  assert.match(b.notices[0], /AI_OS_ROOT/);
});

test("neither name, or an empty one, is NoRootError — the root is never guessed", () => {
  const cwd = tempDir("root-none-");
  for (const env of [{}, { CORTEX_ROOT: "" }, { AI_OS_ROOT: "" }, { CORTEX_ROOT: "", AI_OS_ROOT: "" }, { CORTEX_ROOT: "  ", AI_OS_ROOT: "\t" }]) {
    assert.throws(() => openBrain({ cwd, env }), NoRootError, JSON.stringify(env));
    assert.throws(() => resolveBrain({ cwd, env }), NoRootError, JSON.stringify(env));
  }
  assert.throws(() => openBrain({ cwd, env: {} }), /CORTEX_ROOT is not set/, "the error names the variable to set");
});

test("an empty CORTEX_ROOT does not shadow a set AI_OS_ROOT", () => {
  const v = tempDir("root-fallback-");
  const b = openBrain({ cwd: v, env: { CORTEX_ROOT: "", AI_OS_ROOT: v } });
  assert.equal(b.root, v);
  assert.equal(b.sources.root, "AI_OS_ROOT");
});

test("the mode is read from the root that won, not from the one that lost", () => {
  const base = tempDir("root-mode-");
  mkdirSync(join(base, "repo"));
  const vault = join(base, "vault");
  mkdirSync(vault);
  const repoRoot = join(base, "repo", ".cortex");
  assert.equal(openBrain({ cwd: base, env: { CORTEX_ROOT: repoRoot, AI_OS_ROOT: vault } }).mode, "repo");
  assert.equal(openBrain({ cwd: base, env: { CORTEX_ROOT: vault, AI_OS_ROOT: repoRoot } }).mode, "vault");
});

test("a declared server and a connected repo keep the same record of the name as a solo install", () => {
  // `resolveBrain` returns from three places, one per audience, and each has to pass on which
  // variable named the root and which one lost. Every case above is a solo install, so a return
  // that dropped the two fields went unseen: the server audience and a team repo printed no notice
  // for two different roots and blamed CORTEX_ROOT for a missing AI_OS_ROOT.
  const fresh = tempDir("root-aud-new-");
  const old = tempDir("root-aud-old-");
  const repo = tempDir("root-aud-repo-");
  mkdirSync(join(repo, ".cortex"));
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ slug: "acme", teamBrainRepo: "ssh://git/acme.git" }));
  const audiences = {
    server: { cwd: fresh, env: { CORTEX_AUDIENCE: "server" } },
    team: { cwd: repo, env: {} },
  };
  for (const [audience, { cwd, env }] of Object.entries(audiences)) {
    const both = openBrain({ cwd, env: { ...env, CORTEX_ROOT: fresh, AI_OS_ROOT: old } });
    assert.equal(both.audience, audience);
    assert.equal(both.root, fresh);
    assert.equal(both.sources.root, "CORTEX_ROOT", audience);
    assert.equal(both.notices.length, 1, `${audience}: two different roots are still reported`);
    assert.ok(both.notices[0].includes(old), both.notices[0]);

    const legacy = openBrain({ cwd, env: { ...env, AI_OS_ROOT: old } });
    assert.equal(legacy.audience, audience);
    assert.equal(legacy.root, old);
    assert.equal(legacy.sources.root, "AI_OS_ROOT", audience);
    assert.deepEqual(legacy.notices, []);

    assert.throws(
      () => openBrain({ cwd, env: { ...env, AI_OS_ROOT: join(old, "gone") } }),
      (e) => e instanceof MissingRootError && e.message.includes("AI_OS_ROOT") && !e.message.includes("CORTEX_ROOT"),
      `${audience}: a missing root is blamed on the variable that was set`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// A root that is set and not there refuses to start (#550, 2.41.28) — under both names
// ---------------------------------------------------------------------------------------------

for (const name of ["CORTEX_ROOT", "AI_OS_ROOT"]) {
  test(`a ${name} that does not exist is refused at entry, and the message names ${name}`, () => {
    const base = tempDir("root-missing-");
    const vault = join(base, "no-such-vault");
    assert.throws(
      () => openBrain({ cwd: base, env: { [name]: vault } }),
      (e) => e instanceof MissingRootError && e.path === vault && e.message.includes(name),
    );
    const repoRoot = join(base, "gone-repo", ".cortex");
    assert.throws(
      () => openBrain({ cwd: base, env: { [name]: repoRoot } }),
      (e) => e instanceof MissingRootError && e.path === join(base, "gone-repo") && e.message.includes(name),
    );
  });

  test(`the server will not start on a ${name} that does not exist`, () => {
    const base = tempDir("root-missing-srv-");
    const r = server({ [name]: join(base, "gone-repo", ".cortex") });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "", "nothing on the protocol channel");
    assert.equal(r.lines.length, 1, r.lines.join("\n"));
    assert.match(r.lines[0], /^cortex: .*does not exist/);
    assert.ok(r.lines[0].includes(name), r.lines[0]);
  });

  test(`the CLI refuses a ${name} that does not exist, even for catch-up`, () => {
    const base = tempDir("root-missing-cli-");
    const r = cli(["catch-up", "--project", "x", "--since", "2026-01-01"], { [name]: join(base, "nope") });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /does not exist/);
    assert.ok(r.stderr.includes(name), r.stderr);
  });
}

test("a CORTEX_ROOT that does not exist is not rescued by an AI_OS_ROOT that does", () => {
  // The fallback is for an UNSET new name. A set one that is wrong is a mistake to report, and
  // quietly opening the other brain instead is the guessed root ADR 0008 rules out.
  const base = tempDir("root-no-rescue-");
  const good = join(base, "vault");
  mkdirSync(good);
  assert.throws(() => openBrain({ cwd: base, env: { CORTEX_ROOT: join(base, "typo"), AI_OS_ROOT: good } }), MissingRootError);
  const r = server({ CORTEX_ROOT: join(base, "typo"), AI_OS_ROOT: good });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
});

// ---------------------------------------------------------------------------------------------
// The server, over the wire
// ---------------------------------------------------------------------------------------------

test("the server starts on CORTEX_ROOT alone", () => {
  const v = tempDir("root-srv-new-");
  const r = server({ CORTEX_ROOT: v });
  assert.equal(r.status, 0, r.lines.join("\n"));
  assert.equal(rootOf(r.lines), v);
  assert.match(r.stdout, /"tools"/, "it answered tools/list");
});

test("the server starts on AI_OS_ROOT alone, and says nothing about the name", () => {
  const v = tempDir("root-srv-old-");
  const r = server({ AI_OS_ROOT: v });
  assert.equal(r.status, 0, r.lines.join("\n"));
  assert.equal(rootOf(r.lines), v);
  assert.equal(r.lines.length, 1, `only the startup line:\n${r.lines.join("\n")}`);
});

test("both set and equal: the server prints the startup line and nothing else", () => {
  const v = tempDir("root-srv-same-");
  const r = server({ CORTEX_ROOT: v, AI_OS_ROOT: v });
  assert.equal(r.status, 0);
  assert.equal(r.lines.length, 1, r.lines.join("\n"));
});

test("both set and different: the server uses CORTEX_ROOT and says so once", () => {
  const fresh = tempDir("root-srv-wins-");
  const old = tempDir("root-srv-loses-");
  const r = server({ CORTEX_ROOT: fresh, AI_OS_ROOT: old });
  assert.equal(r.status, 0, r.lines.join("\n"));
  assert.equal(rootOf(r.lines), fresh);
  const said = r.lines.filter((l) => l.includes(old));
  assert.equal(said.length, 1, `exactly one line names the ignored root:\n${r.lines.join("\n")}`);
  assert.match(said[0], /AI_OS_ROOT/);
  assert.equal(r.lines.length, 2, `the notice and the startup line:\n${r.lines.join("\n")}`);
});

test("neither set: the server exits 1 with one line naming CORTEX_ROOT, and says the old name is read", () => {
  for (const env of [{}, { CORTEX_ROOT: "", AI_OS_ROOT: "" }, { CORTEX_ROOT: "   " }]) {
    const r = server(env);
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.equal(r.stdout, "");
    assert.equal(r.lines.length, 1, r.lines.join("\n"));
    assert.match(r.lines[0], /^cortex: CORTEX_ROOT is not set/);
    assert.match(r.lines[0], /AI_OS_ROOT/);
  }
});

test("every line the server writes to stderr starts with `cortex:`", () => {
  // One process used to print two prefixes: `ai-os-mcp:` for an unset root, `cortex:` for
  // everything else. Each way of starting, and each way of refusing to, is run here.
  const base = tempDir("root-prefix-");
  const vault = join(base, "vault");
  const other = join(base, "other");
  mkdirSync(vault);
  mkdirSync(other);
  mkdirSync(join(base, "repo"));
  const runs = {
    "no root": {},
    "a vault, by the new name": { CORTEX_ROOT: vault },
    "a vault, by the old name": { AI_OS_ROOT: vault },
    "a repo": { CORTEX_ROOT: join(base, "repo", ".cortex") },
    "two roots that differ": { CORTEX_ROOT: vault, AI_OS_ROOT: other },
    "a missing root, new name": { CORTEX_ROOT: join(base, "gone") },
    "a missing root, old name": { AI_OS_ROOT: join(base, "gone") },
    "a missing repo": { CORTEX_ROOT: join(base, "gone-repo", ".cortex") },
    "an unknown profile": { CORTEX_ROOT: vault, CORTEX_PROFILE: "works" },
    "a declared server": { CORTEX_ROOT: vault, CORTEX_AUDIENCE: "server" },
  };
  let seen = 0;
  for (const [what, env] of Object.entries(runs)) {
    const r = server(env);
    assert.ok(r.lines.length > 0, `${what}: the server said nothing on stderr`);
    for (const l of r.lines) {
      seen++;
      assert.match(l, /^cortex: /, `${what}: ${l}`);
    }
  }
  assert.ok(seen >= Object.keys(runs).length, "the loop examined lines rather than none");
});

test("no diagnostic in the server's own code carries the old prefix", () => {
  // The spawned runs above cover the paths they reach. This covers the ones they cannot, such as
  // a stdin error: a diagnostic string in server.js or lib/ may not start with the old name.
  const files = ["server.js", ...readdirSync(join(MCP_DIR, "lib")).filter((f) => f.endsWith(".js")).map((f) => join("lib", f))];
  const offenders = [];
  for (const f of files) {
    for (const [i, line] of readFileSync(join(MCP_DIR, f), "utf8").split(/\r?\n/).entries()) {
      if (/["'`]ai-os(-mcp)?: /.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------------------------

test("the CLI reads the vault from CORTEX_ROOT", () => {
  const v = tempDir("root-cli-new-");
  mkdirSync(join(v, "projects", "x"), { recursive: true });
  const r = cli(["catch-up", "--project", "x", "--since", "2000-01-01"], { CORTEX_ROOT: v });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).notes, []);
  assert.equal(JSON.parse(r.stdout).skipped, undefined, "a vault was named, so nothing was skipped");
});

test("the CLI still reads the vault from AI_OS_ROOT", () => {
  const v = tempDir("root-cli-old-");
  mkdirSync(join(v, "projects", "x"), { recursive: true });
  const r = cli(["catch-up", "--project", "x", "--since", "2000-01-01"], { AI_OS_ROOT: v });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).skipped, undefined);
  assert.equal(r.stderr.trim(), "", "no warning for the old name");
});

test("the CLI uses CORTEX_ROOT when the two differ, says so on stderr, and keeps stdout parseable", () => {
  const fresh = tempDir("root-cli-wins-");
  const old = tempDir("root-cli-loses-");
  mkdirSync(join(fresh, "projects", "x"), { recursive: true });
  const r = cli(["catch-up", "--project", "x", "--since", "2000-01-01"], { CORTEX_ROOT: fresh, AI_OS_ROOT: old });
  assert.equal(r.status, 0, r.stderr);
  JSON.parse(r.stdout);
  const lines = r.stderr.split(/\r?\n/).filter((l) => l.trim());
  assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], /^cortex: /);
  assert.ok(lines[0].includes(old), lines[0]);
});

test("the CLI names CORTEX_ROOT when a command needs a root and has none", () => {
  const r = cli(["team", "add", "--name", "acme", "--repo", "ssh://x/y.git", "--project", "p"], {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CORTEX_ROOT is not set \(required for team operations\)/);
});

// ---------------------------------------------------------------------------------------------
// One reader
// ---------------------------------------------------------------------------------------------

test("in mcp/, only lib/resolve.js asks the environment for the root — through core/paths.js", () => {
  // The order of the two names is written once, in core/paths.js. A second reader in this package
  // is a second copy of the rule, and the next change to it reaches one of them.
  const code = (file) =>
    readFileSync(join(MCP_DIR, file), "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
  const files = ["server.js", "ai-os.js", ...readdirSync(join(MCP_DIR, "lib")).filter((f) => f.endsWith(".js")).map((f) => join("lib", f))];
  const readers = files.filter((f) => /env\??\.\s*(CORTEX_ROOT|AI_OS_ROOT)|env\[/.test(code(f)));
  assert.deepEqual(readers, []);
  assert.match(code(join("lib", "resolve.js")), /rootFromEnv\(env\)/);
});
