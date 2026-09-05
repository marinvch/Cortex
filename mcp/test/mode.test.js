import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectMode, isRepoMode, REPO, VAULT } from "../lib/mode.js";

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
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, AI_OS_ROOT: root } });
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
  const repo = mkdtempSync(join(tmpdir(), "cortex-repo-"));
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
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const names = await toolsFor(vault);
  assert.deepEqual(names, ["capture", "catch_me_up", "get_project_context", "list_projects", "recall"]);
  assert.ok(!names.includes("remember"), "repo memory tools must not leak into a vault");
});

/** Start the server against `root` and invoke one tool, returning the tools/call result. */
function callOn(root, tool, args) {
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, AI_OS_ROOT: root } });
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
  const repo = mkdtempSync(join(tmpdir(), "cortex-repo-"));
  const cortex = join(repo, ".cortex");
  mkdirSync(cortex, { recursive: true });

  const res = await callOn(cortex, "capture", { content: "a note that must not land here" });
  assert.equal(res.isError, true, "capture must refuse in repo mode");
  assert.match(res.content[0].text, /only available when Cortex is pointed at a vault/);
  // Assert the property, not the message: nothing was written either way.
  assert.equal(existsSync(join(cortex, "inbox")), false, "a refused capture must not create inbox/");
});

test("a repo tool invoked in vault mode is refused the same way", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const res = await callOn(vault, "remember", { content: "x" });
  assert.equal(res.isError, true, "remember must refuse in vault mode");
  assert.match(res.content[0].text, /only available when Cortex is pointed at a repo's \.cortex\//);
  assert.equal(existsSync(join(vault, "memory")), false, "a refused remember must not create memory/");
});
