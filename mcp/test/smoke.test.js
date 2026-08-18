// mcp/test/smoke.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverPath = join(dirname(fileURLToPath(import.meta.url)), "..", "server.js");

function rpc(child, msg) { child.stdin.write(JSON.stringify(msg) + "\n"); }

test("server answers tools/list over stdio", async () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, AI_OS_ROOT: root } });
  let buf = "";
  // Capture stderr: a server that dies on startup (missing dep, bad import) otherwise surfaces
  // only as a bare 5s "timeout", hiding the actual cause.
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
      if (code !== 0 && code !== null) {
        reject(new Error(`server exited with code ${code}\n${errBuf.trim() || "(no stderr)"}`));
      }
    });
    setTimeout(() => {
      const hint = errBuf.trim() ? `\nserver stderr:\n${errBuf.trim()}` : "\n(server produced no stderr — it started but never answered)";
      reject(new Error(`timed out waiting for tools/list${hint}`));
    }, 5000);
  });
  rpc(child, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  rpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });
  rpc(child, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const res = await got;
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["capture", "catch_me_up", "get_project_context", "list_projects", "recall"]);
  child.kill();
});

test("the startup line reports the audience on stderr, and stdout stays pure protocol", async () => {
  // The audience is load-bearing now: if this says `solo` in a repo you expected to be connected,
  // the connector is missing or unreadable. It must go to stderr — stdout is the MCP protocol
  // channel, and one stray line there corrupts the stream for every client.
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const cwd = mkdtempSync(join(tmpdir(), "cwd-"));
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: { ...process.env, AI_OS_ROOT: root, CORTEX_AUDIENCE: "server" },
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d.toString(); });
  child.stderr.on("data", (d) => { err += d.toString(); });

  const got = new Promise((resolve, reject) => {
    child.stdout.on("data", () => {
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id === 1) resolve(m); } catch {}
      }
    });
    child.on("error", reject);
    setTimeout(() => reject(new Error(`timed out; stderr:\n${err.trim()}`)), 5000);
  });
  rpc(child, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  rpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });
  rpc(child, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  await got;
  child.kill();

  assert.match(err, /audience=server \(declared\)/, "the startup line must name the audience and how it was decided");
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    assert.doesNotThrow(() => JSON.parse(line), `stdout must be protocol only, got: ${line.slice(0, 80)}`);
  }
});
