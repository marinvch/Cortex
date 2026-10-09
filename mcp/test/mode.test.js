import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, writeFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { detectMode, isRepoMode, REPO, VAULT } from "../lib/mode.js";
import { TOOL_TABLE, PUBLISHED, REPO as REPO_TOOL } from "../lib/tools.js";
import { tempDir } from "./tmp.js";
import { bothLayouts, ENTRIES, ENTRIES_OF_THE_15TH } from "../../core/test/memory-fixture.js";

const serverPath = join(dirname(fileURLToPath(import.meta.url)), "..", "server.js");

test("mode is decided by the root it is pointed at", () => {
  assert.equal(detectMode("/home/me/vault"), VAULT);
  assert.equal(detectMode("/repo/.cortex"), REPO);
  assert.equal(detectMode("C:\\work\\api\\.cortex"), REPO);
  assert.equal(detectMode("/repo/.cortex/"), REPO, "a trailing separator must not change the mode");
  assert.equal(isRepoMode("/repo/.cortex"), true);
  assert.equal(isRepoMode("/repo"), false);
});

test("mode detection does not depend on the platform it runs on", () => {
  // The Windows assertion above can only fail on POSIX — `path.win32.basename` understands both
  // separators, so a `node:path` implementation looks correct on Windows and misdetects every
  // Windows root on Linux. That is exactly what happened: `mcp test` was red on ubuntu for five
  // commits while passing locally. Reading the source is the only check that fires on both.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "mode.js"), "utf8");
  assert.doesNotMatch(
    src,
    /from\s+["']node:path["']/,
    "which mode a root names is a fact about the string, not the host — split separators explicitly",
  );
});

test("an empty or missing root is treated as a vault, not a repo", () => {
  assert.equal(detectMode(""), VAULT);
  assert.equal(detectMode(undefined), VAULT);
});

/** Start the server against `root` and return the tool names it advertises. */
function toolsFor(root) {
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, AI_OS_ROOT: "", CORTEX_ROOT: root } });
  let buf = "";
  let errBuf = "";
  child.stderr.on("data", (d) => { errBuf += d.toString(); });
  const got = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id === 1) resolve(m); } catch {}
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
  send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  return got.then((res) => {
    child.kill();
    return res.result.tools.map((t) => t.name).sort();
  });
}

test("repo mode advertises the memory tools and hides the vault ones", async () => {
  const repo = tempDir("cortex-repo-");
  const cortex = join(repo, ".cortex");
  mkdirSync(cortex, { recursive: true });

  const names = await toolsFor(cortex);
  assert.deepEqual(names, ["recall", "recall_memory", "remember"]);
  // The vault tools assume a personal folder layout that a code repo does not have; offering them
  // here would invite an agent to write inbox/ and daily/ into someone's product repository.
  for (const vaultOnly of ["capture", "catch_me_up", "list_projects", "get_project_context"]) {
    assert.ok(!names.includes(vaultOnly), `${vaultOnly} must not be offered in repo mode`);
  }
});

test("vault mode is unchanged", async () => {
  const vault = tempDir("vault-");
  const names = await toolsFor(vault);
  assert.deepEqual(names, ["capture", "catch_me_up", "get_project_context", "list_projects", "recall"]);
  assert.ok(!names.includes("remember"), "repo memory tools must not leak into a vault");
});

/**
 * The environment a spawned server gets. Both names of the root are set or cleared, and so is the
 * author: `remember` writes one file per author, and a server that inherited no CORTEX_AUTHOR would
 * ask git who owns the machine the test runs on. `dev-a` unless a test says otherwise.
 */
function serverEnv(root, extra = {}) {
  return { ...process.env, AI_OS_ROOT: "", CORTEX_ROOT: root, CORTEX_AUTHOR: "dev-a", ...extra };
}

/**
 * An environment in which git finds no identity at all, and no CORTEX_AUTHOR. `dir` is a temp dir
 * the config file may sit in. Nothing is read from the machine.
 */
function noIdentity(dir) {
  const empty = join(dir, "empty.gitconfig");
  writeFileSync(empty, "");
  const cleared = {};
  for (const k of Object.keys(process.env)) if (/^GIT_/i.test(k)) cleared[k] = undefined;
  return {
    ...cleared,
    CORTEX_AUTHOR: undefined,
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_SYSTEM: empty,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: dir, // a temp dir that sits inside some repo is not that repo
  };
}

/** Every file and directory under `dir`, as sorted relative paths with `/`. */
function tree(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${e.name}`;
    if (e.isDirectory()) out.push(`${rel}/`, ...tree(join(dir, e.name), `${rel}/`));
    else out.push(rel);
  }
  return out.sort();
}

/** Start the server against `root` and invoke one tool, returning the tools/call result. */
function callOn(root, tool, args, env = {}) {
  const child = spawn(process.execPath, [serverPath], { env: serverEnv(root, env) });
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
    return res.result;
  });
}

// The half the list assertions above cannot make. tools/list is advertising: a client that already
// knows a name can call it without ever reading the list, and `capture` in repo mode used to run —
// writing inbox/ into someone's product repository — because nothing but the list stood in the way.
test("a vault tool INVOKED in repo mode is refused, not merely absent from the list", async () => {
  const repo = tempDir("cortex-repo-");
  const cortex = join(repo, ".cortex");
  mkdirSync(cortex, { recursive: true });

  const res = await callOn(cortex, "capture", { content: "a note that must not land here" });
  assert.equal(res.isError, true, "capture must refuse in repo mode");
  assert.match(res.content[0].text, /only available when Cortex is pointed at a vault/);
  // Assert the property, not the message: nothing was written either way.
  assert.equal(existsSync(join(cortex, "inbox")), false, "a refused capture must not create inbox/");
});

// The other guard derived from the same table, proven the same way: over the wire, against the real
// server, because a unit test of `assertPublishable` passes just as happily when `server.js` never
// calls it. That is the whole defect this closes — `core/scrub.js` was the declared "single point
// at which anything entering memory is checked" and had one caller, so `capture` committed and
// PUSHED notes to a shared team remote unscanned.
//
// Driven off the table: the property is "every tool that publishes is gated", not "capture is".
//
// Assembled at runtime so no realistic key literal sits in the file — see tools.test.js.
const FAKE_AWS_KEY = ["AKIA", "Q7X2M4N8P1R5T9V3"].join("");

for (const tool of TOOL_TABLE.filter((t) => t.writes === PUBLISHED)) {
  test(`${tool.name} publishes, so an invoked credential is refused and nothing is written`, async () => {
    // Each tool gets the root its declared mode requires; otherwise assertAvailable refuses first
    // and the test would pass for the wrong reason.
    const base = tempDir("cortex-gate-");
    let root = base;
    if (tool.mode === REPO_TOOL) {
      root = join(base, ".cortex");
      mkdirSync(root, { recursive: true });
    }

    const res = await callOn(root, tool.name, { content: `deploy key ${FAKE_AWS_KEY} for staging` });
    assert.equal(res.isError, true, `${tool.name} must refuse content carrying a credential`);
    const text = res.content[0].text;
    assert.match(text, /refused_write/, "the refusal must arrive as the scrub gate's own code");
    assert.match(text, /AWS access key id/, "the refusal must name the kind of secret");
    // Refusing and then echoing the credential back is the same leak by another route.
    assert.ok(!text.includes(FAKE_AWS_KEY), "the refusal echoed the credential");
    // Assert the property, not the message: a refused write leaves nothing behind, whichever
    // directory this tool would have created.
    assert.deepEqual(readdirSync(root), [], `${tool.name} wrote something despite refusing`);
  });
}

// --- remember writes one file per author per day (plan step 4.2) ----------------------------------
//
// The author is the writer's to find (core/memory.js, core/author.js); the server passes none. These
// run over a spawned server because that is the only place the server's own environment is the one
// read. docs/specs/2026-10-09-team-memory-design.md.

function repoRoot() {
  const repo = tempDir("cortex-repo-");
  const cortex = join(repo, ".cortex");
  mkdirSync(cortex, { recursive: true });
  return { repo, cortex };
}

test("remember writes <day>/<author>.md, says so, and recall_memory reads it back with the author", async () => {
  const { cortex } = repoRoot();

  const res = await callOn(cortex, "remember", { content: "authoralpha: chose the queue.", kind: "decision" });
  assert.notEqual(res.isError, true, res.content[0].text);
  const wrote = JSON.parse(res.content[0].text);
  assert.equal(wrote.author, "dev-a");
  assert.equal(wrote.layout, "author");
  assert.match(wrote.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(wrote.path, join(realpathSync(cortex), "memory", wrote.day, "dev-a.md"));
  assert.equal("notice" in wrote, false, "nothing to warn about when the author is named");
  assert.deepEqual(tree(cortex), ["memory/", `memory/${wrote.day}/`, `memory/${wrote.day}/dev-a.md`]);
  assert.match(
    readFileSync(wrote.path, "utf8"),
    new RegExp(`^# ${wrote.day} · dev-a\\n\\n## \\d{2}:\\d{2} · decision\\n\\nauthoralpha: chose the queue\\.\\n\\n$`),
  );

  // A second author on the same day, from a second server: a second file, and the first untouched.
  const first = readFileSync(wrote.path, "utf8");
  const other = await callOn(cortex, "remember", { content: "authorbravo: the parser." }, { CORTEX_AUTHOR: "Dev B" });
  assert.equal(JSON.parse(other.content[0].text).author, "dev-b");
  assert.equal(readFileSync(wrote.path, "utf8"), first);

  // The 4.1 reader, reading what the real writer wrote.
  const back = await callOn(cortex, "recall_memory", { days: 1 });
  const rows = JSON.parse(back.content[0].text);
  assert.deepEqual(rows.map((r) => [r.day, r.author]), [[wrote.day, "dev-a"], [wrote.day, "dev-b"]]);
  assert.ok(rows[0].content.includes("authoralpha: chose the queue."));
  assert.ok(rows[1].content.includes("authorbravo: the parser."));
});

test("remember with no usable author writes the day file and returns layout: day, every time", async () => {
  const { repo, cortex } = repoRoot();
  const env = noIdentity(repo);
  for (const content of ["first", "second"]) {
    const res = await callOn(cortex, "remember", { content }, env);
    assert.notEqual(res.isError, true, res.content[0].text);
    const wrote = JSON.parse(res.content[0].text);
    assert.equal(wrote.layout, "day", `said on the ${content} write`);
    assert.equal(wrote.author, null);
    assert.equal(wrote.path, join(realpathSync(cortex), "memory", `${wrote.day}.md`));
    assert.match(wrote.notice, /Set CORTEX_AUTHOR to /, "the model is told what the person can set");
    assert.deepEqual(tree(cortex), ["memory/", `memory/${wrote.day}.md`], "no day directory");
  }
});

test("remember with a CORTEX_AUTHOR that is set and unusable is refused, and nothing is written", async () => {
  const { cortex } = repoRoot();
  const res = await callOn(cortex, "remember", { content: "a note" }, { CORTEX_AUTHOR: ".." });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /^invalid_author: /);
  assert.match(res.content[0].text, /CORTEX_AUTHOR/);
  assert.deepEqual(readdirSync(cortex), []);
});

test("a refused remember leaves no day directory, with an author set and on a day that has entries", async () => {
  const { cortex } = repoRoot();
  const refused = await callOn(cortex, "remember", { content: `deploy key ${FAKE_AWS_KEY} for staging` });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /refused_write/);
  assert.deepEqual(readdirSync(cortex), [], "no memory/, and no day directory inside it");

  await callOn(cortex, "remember", { content: "a note" });
  const before = tree(cortex);
  const again = await callOn(cortex, "remember", { content: `key ${FAKE_AWS_KEY}` }, { CORTEX_AUTHOR: "dev-b" });
  assert.equal(again.isError, true);
  assert.deepEqual(tree(cortex), before, "no file for the author whose write was refused");
});

// Both memory layouts, over the wire (plan step 4.1). `recall_memory` is `recent()` in core/memory.js
// and nothing else, so this is the proof that the server hands on what core returns: every file of a
// day that has an old day file AND a directory of author files, each row saying whose it is.
test("recall_memory returns every entry of a date that holds both layouts, with its author", async () => {
  const repo = tempDir("cortex-repo-");
  const cortex = bothLayouts(join(repo, ".cortex"));

  const res = await callOn(cortex, "recall_memory", { days: 1 });
  assert.notEqual(res.isError, true);
  const text = res.content[0].text;
  for (const entry of ENTRIES_OF_THE_15TH) assert.ok(text.includes(entry), `missing: ${entry}`);
  assert.ok(!text.includes(ENTRIES.dayBefore), "days: 1 is one day, not one file and not four");
  assert.ok(!text.includes("strayreadme"), "a stray README is not memory");

  const rows = JSON.parse(text);
  assert.deepEqual(rows.map((r) => [r.day, r.author]), [
    ["2026-08-15", null],
    ["2026-08-15", "dev-a"],
    ["2026-08-15", "dev-b"],
  ]);

  const all = await callOn(cortex, "recall_memory", {});
  for (const entry of Object.values(ENTRIES)) assert.ok(all.content[0].text.includes(entry), `missing: ${entry}`);
});

test("a repo tool invoked in vault mode is refused the same way", async () => {
  const vault = tempDir("vault-");
  const res = await callOn(vault, "remember", { content: "x" });
  assert.equal(res.isError, true, "remember must refuse in vault mode");
  assert.match(res.content[0].text, /only available when Cortex is pointed at a repo's \.cortex\//);
  assert.equal(existsSync(join(vault, "memory")), false, "a refused remember must not create memory/");
});
