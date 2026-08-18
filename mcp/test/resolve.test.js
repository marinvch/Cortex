// Which brain, and who is it for.
//
// The two things worth watching here: the resolver never invents a root (an unset AI_OS_ROOT is a
// hard failure, not a default, because a guessed root files someone's private note into a work
// repo), and a corrupt connector.json degrades to solo instead of taking the server down.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBrain, NoRootError } from "../lib/resolve.js";

function tree() {
  const base = mkdtempSync(join(tmpdir(), "resolve-"));
  const root = join(base, "vault");
  const repo = join(base, "repo");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(repo, "src", "deep"), { recursive: true });
  return { base, root, repo };
}

function connect(repo, slug = "acme", teamBrainRepo = "ssh://git/acme.git") {
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ slug, teamBrainRepo }));
}

test("solo: a root and no connector", () => {
  const { root, repo } = tree();
  const b = resolveBrain({ cwd: repo, env: { AI_OS_ROOT: root } });
  assert.equal(b.audience, "solo");
  assert.equal(b.root, root);
  assert.equal(b.team, null);
  assert.equal(b.teamClone, null);
  assert.equal(b.source, "default");
});

test("team: a connector in the working directory", () => {
  const { root, repo } = tree();
  connect(repo);
  const b = resolveBrain({ cwd: repo, env: { AI_OS_ROOT: root } });
  assert.equal(b.audience, "team");
  assert.equal(b.team, "acme");
  assert.ok(b.teamClone.includes("acme"), "the clone directory is derived from the slug");
  assert.match(b.source, /^connector:/);
});

test("team: the connector is found by walking up from a nested cwd", () => {
  // An agent runs in a subdirectory far more often than at the repo top. If the walk-up is missing,
  // team mode silently becomes solo mode and notes stop reaching the team brain.
  const { root, repo } = tree();
  connect(repo);
  const b = resolveBrain({ cwd: join(repo, "src", "deep"), env: { AI_OS_ROOT: root } });
  assert.equal(b.audience, "team");
  assert.equal(b.team, "acme");
});

test("server: declared, because it cannot be detected", () => {
  const { root, repo } = tree();
  const b = resolveBrain({ cwd: repo, env: { AI_OS_ROOT: root, CORTEX_AUDIENCE: "server" } });
  assert.equal(b.audience, "server");
  assert.equal(b.source, "declared");
});

test("server outranks a connector — declaring beats detecting", () => {
  // A scheduled run on a host that happens to sit inside a connected repo is still a server run.
  const { root, repo } = tree();
  connect(repo);
  const b = resolveBrain({ cwd: repo, env: { AI_OS_ROOT: root, CORTEX_AUDIENCE: "server" } });
  assert.equal(b.audience, "server");
  assert.equal(b.source, "declared");
  assert.equal(b.team, "acme", "the team is still reported; the audience is what changed");
});

test("an unset AI_OS_ROOT is a hard failure, never a guess", () => {
  const { repo } = tree();
  assert.throws(() => resolveBrain({ cwd: repo, env: {} }), NoRootError);
});

test("an empty AI_OS_ROOT is treated as unset, not as the filesystem root", () => {
  const { repo } = tree();
  assert.throws(() => resolveBrain({ cwd: repo, env: { AI_OS_ROOT: "   " } }), NoRootError);
});

test("a malformed connector.json degrades to solo instead of throwing", () => {
  // A brain that refuses to start because one JSON file is corrupt has turned a papercut into an
  // outage. Report solo and let the startup line say why.
  const { root, repo } = tree();
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), "{ not json");
  const b = resolveBrain({ cwd: repo, env: { AI_OS_ROOT: root } });
  assert.equal(b.audience, "solo");
  assert.match(b.source, /unreadable/);
});

test("a connector without a slug is not a team", () => {
  const { root, repo } = tree();
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ teamBrainRepo: "ssh://x" }));
  const b = resolveBrain({ cwd: repo, env: { AI_OS_ROOT: root } });
  assert.equal(b.audience, "solo");
});

test("source names the connector it actually used", () => {
  const { root, repo } = tree();
  connect(repo);
  const b = resolveBrain({ cwd: join(repo, "src"), env: { AI_OS_ROOT: root } });
  assert.ok(b.source.includes("connector.json"), `source must be explainable, got '${b.source}'`);
});

test("the nearest connector wins when repos are nested", () => {
  const { root, repo } = tree();
  connect(repo, "outer");
  const inner = join(repo, "src", "inner");
  mkdirSync(inner, { recursive: true });
  connect(inner, "inner");
  const b = resolveBrain({ cwd: inner, env: { AI_OS_ROOT: root } });
  assert.equal(b.team, "inner", "walking up must stop at the first hit");
});
