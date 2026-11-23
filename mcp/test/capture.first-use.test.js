// `capture` as the first thing a new team member does. It used to write the note into a folder that
// was not a clone yet, and every team tool after it failed, because git will not clone into a
// folder that has something in it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./tmp.js";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server.js");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).toString();

function teamRemote() {
  const remote = tempDir("first-remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  const seed = tempDir("first-seed-");
  git(seed, "clone", "-q", remote, ".");
  git(seed, "checkout", "-q", "-B", "master");
  mkdirSync(join(seed, "projects"));
  writeFileSync(join(seed, "projects", ".gitkeep"), "");
  writeFileSync(join(seed, "team.json"), `${JSON.stringify({ members: [{ handle: "dev-a", roles: ["backend"], projects: ["shop"] }] })}\n`);
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "seed");
  git(seed, "push", "-q", "origin", "HEAD:master");
  return remote;
}

/** One server, the calls in order, their results. Each waits for the one before it. */
function session(vault, remote, calls) {
  const e = { ...process.env, ...IDENTITY, AI_OS_ROOT: "", CORTEX_ROOT: vault, CORTEX_TEAM: "acme", CORTEX_TEAM_REPO: remote, CORTEX_AUTHOR: "dev-a" };
  delete e.CORTEX_PROFILE;
  delete e.CORTEX_AUDIENCE;
  const child = spawn(process.execPath, [SERVER], { cwd: vault, env: e });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const got = [];
  let buf = "";
  let errBuf = "";
  child.stderr.on("data", (d) => { errBuf += d.toString(); });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timed out\n${errBuf}`)); }, 30000);
    const next = () => {
      const i = got.length;
      if (i === calls.length) {
        clearTimeout(timer);
        child.kill();
        resolve(got);
        return;
      }
      send({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name: calls[i][0], arguments: calls[i][1] } });
    };
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.id === 0) next();
        else { got.push(m.result); next(); }
      }
    });
    child.on("error", reject);
    send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
  });
}

test("capture as the first action clones the team-brain, and the next team tool works", async () => {
  const remote = teamRemote();
  const vault = tempDir("first-vault-");
  const [note, inbox] = await session(vault, remote, [
    ["capture", { content: "the first note", project: "shop" }],
    ["inbox", {}],
  ]);
  assert.notEqual(note.isError, true, note.content[0].text);
  assert.ok(existsSync(join(vault, "team", "acme", ".git")), "the folder is a clone");
  assert.equal(JSON.parse(note.content[0].text).pushed, true);
  assert.notEqual(inbox.isError, true, inbox.content[0].text);
  assert.match(git(remote, "log", "-1", "--format=%s", "master"), /capture: shop/);
});

test("a folder left by the old capture is reported with what to do, and is not touched", async () => {
  const remote = teamRemote();
  const vault = tempDir("first-vault-");
  const stray = join(vault, "team", "acme", "projects", "shop");
  mkdirSync(stray, { recursive: true });
  writeFileSync(join(stray, "2026-01-01-old.md"), "an older note\n");
  const [res] = await session(vault, remote, [["capture", { content: "another", project: "shop" }]]);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not a git clone/);
  assert.ok(existsSync(join(stray, "2026-01-01-old.md")), "the older note is still there");
  assert.ok(!existsSync(join(vault, "team", "acme", ".git")));
});
