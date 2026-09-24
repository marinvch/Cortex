// Every adapter opens the brain at entry, and both open the same one.
//
// The bug this pins was live: `mcp/server.js` resolved the brain and `mcp/ai-os.js` did not. The
// CLI read `process.env.AI_OS_ROOT` raw and passed `args.team` straight to `catchMeUp`, so
// `ai-os catch-up --project x --since y` run inside a repo with a `.cortex/connector.json` never
// consulted the connector, never found the team clone, and printed `commits: []` — a wrong answer
// reported as a success, which is the failure mode this whole area exists to avoid.
//
// So the tests below assert the PROPERTY, not the symptom: given the same cwd and env, the two
// adapters resolve the same brain and return the same answer. "ai-os works now" would pass again
// the next time a third caller re-derives the seam by hand.
//
// `lib/resolve.js`'s own 15 cases still own audience detection; nothing here duplicates them. What
// is tested here is what COMPOSITION adds — three axes that stay three, and two errors that fire at
// entry rather than at whichever branch happens to look first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openBrain, NoRootError, UnknownProfileError } from "../lib/brain.js";
import { tempDir } from "./tmp.js";

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(MCP_DIR, "ai-os.js");
const SERVER = join(MCP_DIR, "server.js");

/**
 * A vault, a connected repo with a nested working directory, and a team clone holding one real
 * commit. A bare git repo on disk is a complete remote, and a local clone needs no remote at all —
 * nothing here touches the network.
 */
function fixture({ slug = "acme", subject = "capture: unis session cookies" } = {}) {
  const base = tempDir("brain-");
  // Every test that touches $HOME overrides it: git must not read this machine's global config,
  // and a test that writes into a developer's home directory is a test that fails on the next one.
  const home = join(base, "home");
  const vault = join(base, "vault");
  const repo = join(base, "repo");
  const cwd = join(repo, "src", "deep");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(
    join(repo, ".cortex", "connector.json"),
    JSON.stringify({ slug, teamBrainRepo: "ssh://git/acme.git" }),
  );

  mkdirSync(join(vault, "projects", "unis"), { recursive: true });
  writeFileSync(join(vault, "projects", "unis", "n1.md"), "PingID change landed for unis");

  const clone = join(vault, "team", slug);
  mkdirSync(clone, { recursive: true });
  const git = (...a) =>
    execFileSync("git", a, { cwd: clone, env: gitEnv(home), stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(clone, "note.md"), "x");
  git("add", ".");
  git("commit", "-qm", subject);

  return { base, home, vault, repo, cwd, clone, slug, subject };
}

function gitEnv(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: join(home, "gitconfig-absent"),
    GIT_CONFIG_SYSTEM: join(home, "gitsystem-absent"),
  };
}

/** The environment both adapters get. Built explicitly so the developer's own CORTEX_* cannot leak in. */
function envFor({ vault, home }, extra = {}) {
  const e = { ...process.env, AI_OS_ROOT: vault, HOME: home, USERPROFILE: home };
  delete e.CORTEX_AUDIENCE;
  delete e.CORTEX_PROFILE;
  return Object.assign(e, extra);
}

/** Run the CLI the way a person would, from inside the connected repo. */
function cli(f, argv, extra = {}) {
  return spawnSync(process.execPath, [CLI, ...argv], {
    cwd: f.cwd,
    env: envFor(f, extra),
    encoding: "utf8",
  });
}

/**
 * Spawn the real server in the same cwd with the same env, call one tool, and return
 * `{ result, stderr }`. Over the wire, because a unit test of `openBrain` passes just as happily
 * when `server.js` never calls it.
 */
function server(f, tool, args, extra = {}) {
  const child = spawn(process.execPath, [SERVER], { cwd: f.cwd, env: envFor(f, extra) });
  let buf = "";
  let errBuf = "";
  child.stderr.on("data", (d) => { errBuf += d.toString(); });
  const got = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id === 2) resolve(m); } catch {}
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`server exited ${code}\n${errBuf.trim()}`));
    });
    setTimeout(() => reject(new Error(`timed out\n${errBuf.trim()}`)), 5000);
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
  return got.then((res) => {
    child.kill();
    return { result: res.result, stderr: errBuf };
  });
}

// ---------------------------------------------------------------------------------------------
// The bug
// ---------------------------------------------------------------------------------------------

test("catch-up through the CLI reaches the team clone without being told the team", () => {
  const f = fixture();
  const r = cli(f, ["catch-up", "--project", "unis", "--since", "2000-01-01"]);
  assert.equal(r.status, 0, `ai-os catch-up failed:\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  // The whole defect: this came back `[]` and exit 0. An empty list that looks like a success is
  // worse than an error, because nothing anywhere says the connector was never read.
  assert.ok(
    out.commits.some((c) => c.includes("session cookies")),
    `the CLI must reach the team clone from the connector, got ${JSON.stringify(out.commits)}`,
  );
});

test("--team stays an override, not the switch that turns team mode on", () => {
  // Passing it explicitly must still work — it is how you read a team you are not standing in.
  const f = fixture();
  const r = cli(f, ["catch-up", "--project", "unis", "--since", "2000-01-01", "--team", "acme"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).commits.some((c) => c.includes("session cookies")));
});

// ---------------------------------------------------------------------------------------------
// The property: two adapters, one brain
// ---------------------------------------------------------------------------------------------

test("both adapters answer the same question identically from the same cwd and env", async () => {
  const f = fixture();
  const viaCli = JSON.parse(cli(f, ["catch-up", "--project", "unis", "--since", "2000-01-01"]).stdout);
  const { result } = await server(f, "catch_me_up", { project: "unis", since: "2000-01-01" });
  const viaServer = JSON.parse(result.content[0].text);

  assert.deepEqual(viaCli, viaServer, "the same inputs must produce the same answer in both adapters");
  // Both non-empty, so equality cannot be satisfied by both being wrong in the same way.
  assert.ok(viaCli.commits.length > 0, "both adapters returned nothing — equality proves nothing here");
  assert.ok(viaCli.notes.length > 0);
});

test("the server's startup line is the record's own description", async () => {
  const f = fixture();
  const expected = openBrain({ cwd: f.cwd, env: envFor(f) }).describe();
  const { stderr } = await server(f, "catch_me_up", { project: "unis", since: "2000-01-01" });
  assert.ok(
    stderr.split("\n").some((l) => l.trim() === expected),
    `the server must describe the brain the module resolved.\nexpected: ${expected}\ngot:\n${stderr}`,
  );
  assert.match(expected, /profile=\S+ .*audience=\S+ .*mode=\S+ root=/, "all three axes, named");
});

test("every adapter opens the brain at entry — neither re-derives the seam", () => {
  // Structural, because the behavioural tests above can only catch the paths they exercise, and
  // this rule exists precisely because a second adapter grew its own copy of the answer. Comment
  // lines are prose, not calls: without stripping them this flags the comments explaining the rule.
  const code = (file) =>
    readFileSync(join(MCP_DIR, file), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");

  for (const adapter of ["server.js", "ai-os.js"]) {
    const src = code(adapter);
    assert.match(src, /from\s+["']\.\/lib\/brain\.js["']/, `${adapter} must open the brain`);
    assert.doesNotMatch(src, /env\.AI_OS_ROOT/, `${adapter} must take the root from the brain, not the environment`);
    assert.doesNotMatch(src, /lib\/resolve\.js/, `${adapter} must not resolve the audience itself`);
    assert.doesNotMatch(src, /core\/profile\.js/, `${adapter} must not resolve the profile itself`);
    assert.doesNotMatch(src, /lib\/mode\.js/, `${adapter} must not detect the mode itself`);
  }
});

// ---------------------------------------------------------------------------------------------
// What composition adds: three answers, never three merged questions
// ---------------------------------------------------------------------------------------------

test("mode, audience and profile stay three independent fields", () => {
  // The combination nothing would produce if the axes were welded: a repo-mode root, on a team,
  // in a lab world. All three are real and all three are reachable together.
  const f = fixture();
  const repoRoot = join(f.repo, ".cortex");
  const b = openBrain({ cwd: f.cwd, env: { AI_OS_ROOT: repoRoot, CORTEX_PROFILE: "lab" } });
  assert.equal(b.mode, "repo", "mode comes from the root string");
  assert.equal(b.isRepo, true);
  assert.equal(b.audience, "team", "audience comes from the connector");
  assert.equal(b.team, "acme");
  assert.equal(b.profile, "lab", "profile comes from CORTEX_PROFILE and nothing else");
  assert.equal(b.policy.outwardSync, false, "the policy object travels with the profile, not a copy of one field");
});

test("nothing about the root, the connector or the cwd moves the profile", () => {
  // core/test/profile.test.js owns this rule; composing three resolvers is the obvious place to
  // break it, so it is asserted on the composed record too.
  const f = fixture();
  const b = openBrain({ cwd: f.cwd, env: { AI_OS_ROOT: join(f.repo, ".cortex") } });
  assert.equal(b.profile, "home");
  assert.equal(b.sources.profile, "default");
  assert.equal(b.audience, "team", "the connector still moved the audience — only the profile is immovable");
});

test("a declared server audience does not change the mode or the profile", () => {
  const f = fixture();
  const b = openBrain({ cwd: f.cwd, env: { AI_OS_ROOT: f.vault, CORTEX_AUDIENCE: "server", CORTEX_PROFILE: "work" } });
  assert.equal(b.audience, "server");
  assert.equal(b.mode, "vault");
  assert.equal(b.profile, "work");
  assert.equal(b.team, "acme", "the team is still located; only the audience is declared");
});

test("both failures are thrown at entry, not at whichever branch looks first", () => {
  const f = fixture();
  // A missing root, with a perfectly good profile.
  assert.throws(() => openBrain({ cwd: f.cwd, env: { CORTEX_PROFILE: "home" } }), NoRootError);
  // A misspelt profile, with a perfectly good root.
  assert.throws(
    () => openBrain({ cwd: f.cwd, env: { AI_OS_ROOT: f.vault, CORTEX_PROFILE: "works" } }),
    UnknownProfileError,
  );
});

test("the CLI fails on a misspelt CORTEX_PROFILE before it validates its own arguments", () => {
  // `ai-os.js` resolved the profile inside `team init` only, so `team add` took a typo as `home`
  // while the server treated it as a hard exit. Reaching the usage error first would mean the
  // profile is still being checked by a branch rather than at entry.
  const f = fixture();
  const r = cli(f, ["team", "add"], { CORTEX_PROFILE: "works" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown CORTEX_PROFILE/);
  assert.doesNotMatch(r.stderr, /usage: ai-os team add/, "the profile must be settled before the arguments are");
});

test("a command that does not talk to the brain still runs without AI_OS_ROOT", () => {
  // Opening at entry must not turn `digest` and `setup-plugins` into commands that demand a vault;
  // that would be a new requirement wearing a fix's clothes. `digest` with no arguments reaches its
  // own usage error — if the brain were opened for every command, it would fail on the root first.
  const f = fixture();
  const e = envFor(f);
  delete e.AI_OS_ROOT;
  const r = spawnSync(process.execPath, [CLI, "digest"], { cwd: f.cwd, env: e, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: ai-os digest/);
  assert.doesNotMatch(r.stderr, /AI_OS_ROOT/, "digest reads no brain, so it must not demand a root");
});

test("an unset AI_OS_ROOT names the command that needed it", () => {
  // `team` writes a clone under the vault, so it genuinely needs one. `catch-up` used to be the
  // example here and no longer is: it reads the repo it stands in when no vault is named
  // (test/rituals-on-a-plugin-install.test.js).
  const f = fixture();
  const e = envFor(f);
  delete e.AI_OS_ROOT;
  const r = spawnSync(process.execPath, [CLI, "team", "add"], {
    cwd: f.cwd, env: e, encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AI_OS_ROOT is not set \(required for team operations\)/);
});
