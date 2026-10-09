// claude.mjs is the one place that starts the `claude` CLI: the skill runner and the outcome harness
// both go through it, each with its own arguments. Nothing here starts the real binary. A small
// script stands in for it and reports what it was given, which is what a caller cannot see when an
// argument is lost on the way through a Windows `.cmd` shim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeBin, parseResult, spawnClaude } from "../claude.mjs";

const dir = mkdtempSync(join(tmpdir(), "cortex-claude-test-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

// Echoes its arguments, working directory, one environment variable and stdin as JSON. With
// `--hang` it never exits; with `--garbage` it prints something that is not JSON and exits 3.
writeFileSync(join(dir, "fake.mjs"), [
  "const args = process.argv.slice(2);",
  "if (args.includes('--hang')) setInterval(() => {}, 1000);",
  "else if (args.includes('--garbage')) { console.error('login required'); console.log('not json'); process.exit(3); }",
  "else {",
  "  let input = '';",
  "  process.stdin.on('data', (d) => { input += d; });",
  "  process.stdin.on('end', () => console.log(JSON.stringify({ args, cwd: process.cwd(), flag: process.env.HARNESS_FLAG ?? null, input })));",
  "}",
  "",
].join("\n"));
const node = process.execPath;
let bin;
if (process.platform === "win32") {
  bin = join(dir, "fake.cmd");
  writeFileSync(bin, `@echo off\r\n"${node}" "%~dp0fake.mjs" %*\r\n`);
} else {
  bin = join(dir, "fake");
  writeFileSync(bin, `#!/bin/sh\nexec "${node}" "$(dirname "$0")/fake.mjs" "$@"\n`);
  chmodSync(bin, 0o755);
}

test("the default binary is claude, a .cmd on Windows, unless CLAUDE_CLI_BIN names another", () => {
  const before = process.env.CLAUDE_CLI_BIN;
  delete process.env.CLAUDE_CLI_BIN;
  assert.equal(claudeBin(), process.platform === "win32" ? "claude.cmd" : "claude");
  process.env.CLAUDE_CLI_BIN = "/somewhere/claude";
  assert.equal(claudeBin(), "/somewhere/claude");
  if (before === undefined) delete process.env.CLAUDE_CLI_BIN; else process.env.CLAUDE_CLI_BIN = before;
});

test("every argument arrives as given: spaces, brackets, a star, a comma and an empty one", async () => {
  const args = ["-p", "--allowedTools", "Bash(node *)", "Bash(npm test)", "Bash(git diff *)", "--setting-sources", "project,local", "--tools", "", "--max-turns", "40"];
  const run = await spawnClaude({ bin, args, cwd: dir, input: "the prompt\nsecond line\n" });
  assert.equal(run.code, 0, run.stderr);
  const seen = JSON.parse(run.stdout);
  assert.deepEqual(seen.args, args);
  assert.equal(seen.input, "the prompt\nsecond line\n");
});

test("the working directory and the extra environment reach the process", async () => {
  const cwd = mkdtempSync(join(dir, "cwd-"));
  const run = await spawnClaude({ bin, args: ["-p"], cwd, env: { ...process.env, HARNESS_FLAG: "1" }, input: "" });
  const seen = JSON.parse(run.stdout);
  assert.equal(realpathSync(seen.cwd), realpathSync(cwd));
  assert.equal(seen.flag, "1");
  const plain = JSON.parse((await spawnClaude({ bin, args: ["-p"], cwd, env: { ...process.env, HARNESS_FLAG: undefined }, input: "" })).stdout);
  assert.equal(plain.flag, null);
});

test("an aborted call is killed, and the promise settles", async () => {
  const ac = new AbortController();
  const started = Date.now();
  const pending = spawnClaude({ bin, args: ["--hang"], cwd: dir, input: "", signal: ac.signal });
  setTimeout(() => ac.abort(), 300);
  const run = await pending;
  assert.notEqual(run.code, 0);
  assert.ok(Date.now() - started < 20_000, "the hung process was not left to run");
});

test("a binary that does not exist rejects; it does not resolve with an empty answer", async () => {
  const missing = join(dir, process.platform === "win32" ? "nothing.exe" : "nothing");
  await assert.rejects(spawnClaude({ bin: missing, args: ["-p"], cwd: dir, input: "" }));
});

test("parseResult answers the JSON object, and names the exit code and the tail of the output otherwise", async () => {
  assert.deepEqual(parseResult({ code: 0, stdout: "{\"subtype\":\"success\",\"result\":\"ok\"}\n", stderr: "" }), { subtype: "success", result: "ok" });
  const run = await spawnClaude({ bin, args: ["--garbage"], cwd: dir, input: "" });
  assert.equal(run.code, 3);
  assert.throws(() => parseResult(run), /claude exited 3: login required/);
  assert.throws(() => parseResult({ code: 1, stdout: "", stderr: "" }), /claude exited 1/);
  assert.throws(() => parseResult({ code: 0, stdout: "[1,2]", stderr: "" }), /not a result object/);
});
