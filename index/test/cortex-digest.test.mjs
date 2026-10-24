// The digest pin (docs/adr/0028): index/lib/cortex-digest.mjs computes it when the workflow is
// stamped, and an inline script in templates/loop/cortex-review.yml recomputes it on the runner.
// They are two copies of one rule — the runner must not run code from the clone it is checking — so
// this test runs the workflow's own script, taken out of the template, against the module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT, cortexDigest, digestFiles } from "../lib/cortex-digest.mjs";
import { parseYaml } from "./yaml-lite.mjs";
import { tempDir } from "./tmp.mjs";

const TEMPLATE = join(PLUGIN_ROOT, "templates", "loop", "cortex-review.yml");

/** The JavaScript the workflow's verify step hands to `node -e`. */
function verifyScript() {
  const stamped = readFileSync(TEMPLATE, "utf8")
    .replaceAll("{{CORTEX_REF}}", "v0.0.0")
    .replaceAll("{{CORTEX_REPO}}", "https://example.invalid/cortex.git")
    .replaceAll("{{CORTEX_SHA256}}", "0".repeat(64));
  const wf = parseYaml(stamped);
  const step = wf.jobs.review.steps.find((s) => /CORTEX_SHA256/.test(s.run ?? ""));
  const m = step.run.match(/node -e '([\s\S]*)' "\$RUNNER_TEMP\/cortex"/);
  assert.ok(m, "the verify step runs one node -e script against the clone");
  return m[1];
}

/** Run the workflow's check against `root`, expecting `digest`. */
function runVerify(root, digest) {
  return spawnSync(process.execPath, ["-e", verifyScript(), root], {
    encoding: "utf8",
    env: { ...process.env, CORTEX_SHA256: digest, CORTEX_REF: "v0.0.0", CORTEX_REPO: "https://example.invalid/cortex.git" },
  });
}

/** A copy of what a clone holds that the digest reads, in a temp dir. */
function copyOfCortex() {
  const root = tempDir("cortex-digest-");
  for (const d of ["core", "index"]) cpSync(join(PLUGIN_ROOT, d), join(root, d), { recursive: true });
  cpSync(join(PLUGIN_ROOT, "VERSION"), join(root, "VERSION"));
  return root;
}

test("the workflow's check and the stamp act agree on this checkout", () => {
  const d = cortexDigest(PLUGIN_ROOT);
  assert.match(d, /^[0-9a-f]{64}$/);
  const r = runVerify(PLUGIN_ROOT, d);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /matches the stamped digest/);
});

test("a changed file fails the check, and names both digests without running anything from the clone", () => {
  const root = copyOfCortex();
  const d = cortexDigest(root);
  writeFileSync(join(root, "index", "cortex-review.mjs"), readFileSync(join(root, "index", "cortex-review.mjs"), "utf8") + "\n// moved tag\n");
  assert.notEqual(cortexDigest(root), d, "the module sees the change");
  const r = runVerify(root, d);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^::error::Cortex v0\.0\.0 .* is not the code this workflow was stamped from/m);
  assert.ok(r.stdout.includes(d) && r.stdout.includes(cortexDigest(root)));
});

test("an added file under core/ or index/ fails it; tests and CRLF endings do not", () => {
  const root = copyOfCortex();
  const d = cortexDigest(root);

  mkdirSync(join(root, "index", "test", "extra"), { recursive: true });
  writeFileSync(join(root, "index", "test", "extra", "x.mjs"), "export {};\n");
  writeFileSync(join(root, "core", "test", "y.js"), "export {};\n");
  assert.equal(cortexDigest(root), d, "a test directory is not code the workflow runs");

  const f = join(root, "core", "date.js");
  writeFileSync(f, readFileSync(f, "utf8").replace(/\r?\n/g, "\r\n"));
  assert.equal(cortexDigest(root), d, "a CRLF checkout hashes like an LF one");
  assert.equal(runVerify(root, d).status, 0, "and the workflow agrees");

  writeFileSync(join(root, "index", "lib", "planted.mjs"), "export {};\n");
  assert.notEqual(cortexDigest(root), d);
  assert.equal(runVerify(root, d).status, 1, "a planted module fails the check");
});

test("an empty or missing CORTEX_SHA256 fails: an unpinned workflow does not run", () => {
  assert.equal(runVerify(PLUGIN_ROOT, "").status, 1);
});

test("it covers core/ and index/ without tests, and VERSION", () => {
  const files = digestFiles(PLUGIN_ROOT);
  assert.ok(files.includes("VERSION"));
  assert.ok(files.includes("index/cortex-review.mjs") && files.includes("core/scrub.js"));
  assert.ok(files.every((p) => /^(core|index)\//.test(p) || p === "VERSION"));
  assert.ok(!files.some((p) => p.split("/").includes("test")));
  assert.deepEqual(files, [...files].sort(), "sorted by path");
});
