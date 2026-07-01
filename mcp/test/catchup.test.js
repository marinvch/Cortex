import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catchMeUp } from "../lib/catchup.js";

test("returns notes for the project (no team)", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "projects", "shop"), { recursive: true });
  writeFileSync(join(root, "projects", "shop", "n1.md"), "SSO change landed for shop");
  const res = catchMeUp(root, { project: "shop", since: "2026-06-01" });
  assert.ok(res.notes.some((n) => /SSO change/.test(n.snippet)));
  assert.ok(Array.isArray(res.commits));
  assert.equal(res.commits.length, 0);
});

test("includes team-brain git commits since <since>", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const clone = join(root, "team", "acme");
  mkdirSync(clone, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: clone, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(clone, "note.md"), "x");
  git("add", ".");
  git("commit", "-qm", "capture: shop session cookies");
  const res = catchMeUp(root, { project: "shop", since: "2000-01-01", team: "acme" });
  assert.ok(res.commits.some((c) => /session cookies/.test(c)));
});
