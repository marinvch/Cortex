// mcp/test/slug-parity.test.js
//
// One slug rule, four encodings. `mcp/lib/slug.js` is the canonical one; the bash tools and the
// browser-side viewer each re-encode it because they cannot import JS. That duplication is
// deliberate — `cortex-init.sh` is a standalone installer with zero runtime deps, and the viewer's
// copy runs in the browser. Silent drift between them is not deliberate, and it has already caused
// two live defects: `cortex-scan-projects.sh` slugified `my.app` to `myapp` while every other
// encoding produced `my-app`, so the employer-firewall purge deleted a filename nothing wrote.
//
// This test is the seam that keeps the four honest. Same shape as manifest-parity.test.js.
//
// Fixtures stay ASCII on purpose: `tr 'A-Z' 'a-z'` is byte-wise and would diverge from
// String.toLowerCase() on non-ASCII input. That divergence is real but out of this test's scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "../lib/slug.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB = join(REPO_ROOT, "tools", "_cortex-lib.sh");
const INIT = join(REPO_ROOT, "tools", "cortex-init.sh");
const VIEWER = join(REPO_ROOT, "tools", "cortex.sh");

// Names that actually reach these functions: repo directory names, note filenames, wikilink
// targets. Each fixture below is a case where a naive encoding diverges.
const FIXTURES = [
  "my.app",       // the live defect: `.` must collapse to `-`, not vanish
  "AI OS",
  "a  b",         // runs collapse to a single `-`
  "foo_bar",
  "--Edge--",     // leading/trailing separators are trimmed
  "Note.MD",      // uppercase extension
  "note.md",
  "client/alpha",
  "123",
  "x---y",
];

function bashAvailable() {
  return spawnSync("bash", ["-c", "exit 0"], { stdio: "ignore" }).status === 0;
}

/**
 * Run one shell snippet per fixture; returns the outputs in fixture order.
 * The snippet must not emit its own newline — these helpers use printf, so the harness adds one.
 */
function runBash(snippet) {
  const script = FIXTURES.map((f) => `IN=${shq(f)}; ${snippet}; echo`).join("\n");
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(r.status, 0, `bash failed: ${r.stderr}`);
  // Every fixture prints exactly one line, so a trailing newline split is safe.
  return r.stdout.split("\n").slice(0, FIXTURES.length);
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

test("tools/_cortex-lib.sh slugify() matches mcp/lib/slug.js", (t) => {
  if (!bashAvailable()) return t.skip("bash not available");
  const got = runBash(`. ${shq(LIB)}; slugify "$IN"`);
  assert.deepEqual(got, FIXTURES.map(slugify));
});

test("tools/_cortex-lib.sh note_id() is slugify() with a .md extension dropped first", (t) => {
  if (!bashAvailable()) return t.skip("bash not available");
  const got = runBash(`. ${shq(LIB)}; note_id "$IN"`);
  assert.deepEqual(got, FIXTURES.map((f) => slugify(f.replace(/\.md$/i, ""))));
});

test("the viewer's browser-side slug() matches note_id()", (t) => {
  if (!bashAvailable()) return t.skip("bash not available");
  // cortex.sh emits a self-contained HTML app; its inline slug() builds the same node ids the
  // bash side wrote into the graph, so a divergence here is a dead [[wikilink]] in the viewer.
  const src = readFileSync(VIEWER, "utf8");
  const m = src.match(/function slug\(s\)\{(return [^}]+?;)\}/);
  assert.ok(m, "tools/cortex.sh must emit a `function slug(s){return …;}` for the viewer");
  const browserSlug = new Function("s", m[1]);

  const fromBash = runBash(`. ${shq(LIB)}; note_id "$IN"`);
  assert.deepEqual(FIXTURES.map(browserSlug), fromBash);
});

test("cortex-init.sh's inline slug expression matches the canonical rule", (t) => {
  if (!bashAvailable()) return t.skip("bash not available");
  // cortex-init.sh is a standalone installer (zero runtime deps, copied into any repo), so it
  // cannot source _cortex-lib.sh. It keeps its own copy; this pins the two together.
  const src = readFileSync(INIT, "utf8");
  const m = src.match(/SLUG="\$\(printf '%s' "\$NAME" \| (.+?)\)"/);
  assert.ok(m, "tools/cortex-init.sh must build SLUG from a `printf '%s' \"$NAME\" | …` pipeline");

  const got = runBash(`printf '%s' "$IN" | ${m[1]}`);
  assert.deepEqual(got, FIXTURES.map(slugify));
});
