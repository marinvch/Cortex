// mcp/test/version.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readVersion, VERSION } from "../lib/version.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("reads the repo-root VERSION file", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  writeFileSync(join(root, "VERSION"), "9.9.9\n");
  assert.equal(readVersion(root), "9.9.9");
});

test("falls back to mcp/package.json when VERSION is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "mcp"));
  writeFileSync(join(root, "mcp", "package.json"), JSON.stringify({ version: "7.7.7" }));
  assert.equal(readVersion(root), "7.7.7");
});

test("never throws on a vault with neither file", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  assert.equal(readVersion(root), "0.0.0");
});

// Drift guard: VERSION, mcp/package.json and the docs must agree. They did not between
// 1.0.0 and 1.1.0 — the README shipped a stale version for a whole release.
test("VERSION, package.json and README agree on the release", () => {
  const version = readFileSync(join(REPO_ROOT, "VERSION"), "utf8").trim();
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "mcp", "package.json"), "utf8"));
  assert.equal(pkg.version, version, "mcp/package.json version must match the VERSION file");
  assert.equal(VERSION, version, "the served MCP version must match the VERSION file");

  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  assert.ok(
    readme.includes(`**v${version}**`),
    `README.md must advertise v${version} — update its header line when bumping VERSION`,
  );

  const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
  assert.ok(
    changelog.includes(`## [${version}]`),
    `CHANGELOG.md needs a "## [${version}]" section`,
  );
  assert.ok(
    changelog.includes(`[${version}]: https://`),
    `CHANGELOG.md needs a "[${version}]: <url>" link reference at the bottom`,
  );
});
