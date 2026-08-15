import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = (name) => join(INDEX_DIR, name);

// The four CLIs were the one true positive Cortex reported about itself: lib/ was well covered,
// the top-level argument parsing and file writing were not. These are smoke tests — they run each
// command for real against a fixture repo and check the artifact it promised to write.

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-cli-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.js"), 'import { a } from "./a.js";\na();\n');
  writeFileSync(join(root, "src", "a.js"), "export function a() { return 1; }\n");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  return root;
}

function run(script, args, cwd) {
  return execFileSync(process.execPath, [cli(script), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("cortex-index writes the index and reports what it found", () => {
  const root = fixture();
  const out = run("cortex-index.mjs", ["."], root);
  assert.match(out, /Indexed \d+ files/);
  const p = join(root, ".cortex", "index", "index.json");
  assert.ok(existsSync(p), "the index must land at .cortex/index/index.json");
  const idx = JSON.parse(readFileSync(p, "utf8"));
  assert.ok(idx.files.some((f) => f.path === "src/a.js"));
  assert.equal(idx.version, "1");
});

test("cortex-index honours --out", () => {
  const root = fixture();
  run("cortex-index.mjs", [".", "--out", "custom.json"], root);
  assert.ok(existsSync(join(root, "custom.json")));
});

test("cortex-findings writes exactly one dated report", () => {
  const root = fixture();
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-findings.mjs", ["."], root);
  assert.match(out, /\d+ findings/);
  const dir = join(root, ".cortex", "findings");
  assert.ok(existsSync(dir));
  const written = readdirSync(dir);
  assert.equal(written.length, 1, "exactly one report per run");
  assert.match(written[0], /^\d{4}-\d{2}-\d{2}\.md$/);
  const report = readFileSync(join(dir, written[0]), "utf8");
  assert.match(report, /Nothing in this repository has been changed/);
});

test("cortex-findings --stdout writes no file", () => {
  const root = fixture();
  const out = run("cortex-findings.mjs", [".", "--stdout"], root);
  assert.match(out, /# Cortex findings/);
  assert.ok(!existsSync(join(root, ".cortex", "findings")), "--stdout must not write a report");
});

test("cortex-enrich plans, reports status, and merges", () => {
  const root = fixture();
  run("cortex-index.mjs", ["."], root);

  const planned = run("cortex-enrich.mjs", ["plan", "."], root);
  assert.match(planned, /Planned \d+ batches/);

  const status = run("cortex-enrich.mjs", ["status", "."], root);
  assert.match(status, /0\/\d+ batches complete/);

  const merged = run("cortex-enrich.mjs", ["merge", "."], root);
  assert.match(merged, /Enriched 0\/\d+ indexed files/, "merging with no results is honest, not a crash");
  assert.ok(existsSync(join(root, ".cortex", "index", "enriched.json")));
});

test("cortex-memory appends, reads back, and REFUSES a secret with exit 2", () => {
  const root = fixture();
  mkdirSync(join(root, ".cortex"), { recursive: true });

  const wrote = run("cortex-memory.mjs", ["append", "Split a.js out of index.js.", "--kind", "decision"], root);
  assert.match(wrote, /^wrote /);

  const back = run("cortex-memory.mjs", ["recent", "--days", "1"], root);
  assert.match(back, /Split a\.js out of index\.js\./);

  const secret = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
  let code = 0;
  let stderr = "";
  try {
    run("cortex-memory.mjs", ["append", `key ${secret} rotated`], root);
  } catch (e) {
    code = e.status;
    stderr = String(e.stderr);
  }
  assert.equal(code, 2, "a refused write must exit 2 so a caller can branch on it");
  assert.match(stderr, /REFUSED/);
  assert.ok(!stderr.includes(secret), "the refusal must not echo the secret");
});

test("an unknown subcommand fails loudly", () => {
  const root = fixture();
  let code = 0;
  try {
    run("cortex-enrich.mjs", ["frobnicate", "."], root);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 1);
});
