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
