// `cortex digest` goes in 4.0.0. Until then it must warn and still do its job.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), "cortex.js");

test("digest warns on stderr and still writes the digest", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "cortex-digest-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo });
  git("init", "-q");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git("add", ".");
  git("commit", "-q", "-m", "first change");

  const out = join(repo, "digest.md");
  const r = spawnSync(process.execPath, [CLI, "digest", "--repo", repo, "--since", "2000-01-01", "--out", out], { encoding: "utf8" });

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /deprecated and will be removed in 4\.0\.0/);
  assert.doesNotMatch(r.stdout, /deprecated/);
  assert.ok(existsSync(out));
  assert.match(readFileSync(out, "utf8"), /first change/);
});
