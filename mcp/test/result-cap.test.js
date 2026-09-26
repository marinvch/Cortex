// mcp/test/result-cap.test.js — the cap, end to end, on a tool that used to return whole files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stamp } from "../../core/date.js";
import { MAX_RESULT_CHARS } from "../lib/stdio.js";
import { tempDir } from "./tmp.js";

const serverPath = join(dirname(fileURLToPath(import.meta.url)), "..", "server.js");

test("recall_memory over an oversized memory file comes back capped and marked", async () => {
  // A repo whose memory grew for a year: one day's file alone is several times the cap. Before the
  // cap, recall_memory returned all of it and Claude Code cut it at 25,000 tokens, silently.
  const repo = tempDir("result-cap-");
  const memory = join(repo, ".cortex", "memory");
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(memory, `${stamp()}.md`), `# ${stamp()}\n\n` + "A decision and why it was taken.\n".repeat(8000));

  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, AI_OS_ROOT: join(repo, ".cortex") } });
  let buf = "";
  let err = "";
  child.stderr.on("data", (d) => { err += d.toString(); });
  const got = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id === 1) resolve(m); } catch {}
      }
    });
    child.on("error", reject);
    setTimeout(() => reject(new Error(`timed out; stderr:\n${err.trim()}`)), 5000);
  });
  const rpc = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
  rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "recall_memory", arguments: { days: 7 } } });
  const res = await got;
  // Wait for the exit, not just the signal: on Windows a live process pins files under the temp dir.
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;

  assert.ok(!res.result.isError, res.result.content[0].text.slice(0, 200));
  const text = res.result.content[0].text;
  assert.ok(text.length <= MAX_RESULT_CHARS, `recall_memory returned ${text.length} characters`);
  const doc = JSON.parse(text);
  assert.equal(doc.truncated, true);
  assert.ok(doc.totalChars > MAX_RESULT_CHARS);
  assert.match(doc.partial, /A decision and why it was taken/);
});
