// The outcome harness compares one repo with its context layer against the same repo without it.
// Everything it reports rests on the two builds being the same apart from that layer, on every
// machine. These tests hold the builder to that on whole trees, and need no model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARMS, CODENAME, CONTEXT_LAYER, FIXTURE_VERSION, RULES, buildFixture, fixtureFiles, hashDir, treeHash,
} from "../harness/fixture.mjs";

const temp = () => mkdtempSync(join(tmpdir(), "cortex-harness-test-"));

// Every file under a built tree, as repo-relative paths with forward slashes. `.git` is the one
// directory left out: its objects are compared through the commit id instead.
function walk(dir, rel = "") {
  const out = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    if (rel === "" && name === ".git") continue;
    const next = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, next)).isDirectory()) out.push(...walk(dir, next));
    else out.push(next);
  }
  return out;
}

const head = (dir) => spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();

test("the arms are named once, and the fixture carries a version", () => {
  assert.deepEqual(ARMS, ["with", "without"]);
  assert.ok(Number.isInteger(FIXTURE_VERSION) && FIXTURE_VERSION >= 1);
  assert.throws(() => fixtureFiles("both"), /unknown arm/);
});

test("the build is deterministic: two builds of one arm are byte-identical, commit included", () => {
  for (const arm of ARMS) {
    const a = temp(), b = temp();
    buildFixture(join(a, "shop"), { arm });
    buildFixture(join(b, "shop"), { arm });
    assert.deepEqual(walk(join(a, "shop")), walk(join(b, "shop")), arm);
    assert.equal(hashDir(join(a, "shop")), hashDir(join(b, "shop")), arm);
    assert.equal(hashDir(join(a, "shop")), treeHash(arm), `${arm}: the tree on disk is the tree the record names`);
    assert.match(head(join(a, "shop")), /^[0-9a-f]{40}$/, `${arm}: the working copy is a git repo with a commit`);
    assert.equal(head(join(a, "shop")), head(join(b, "shop")), `${arm}: author, date and message are pinned`);
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: join(a, "shop"), encoding: "utf8" }).stdout;
    assert.equal(status, "", `${arm}: the one commit holds the whole tree`);
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("every file is written with LF endings, whatever the host checked this repo out as", () => {
  for (const arm of ARMS) {
    const dir = temp();
    buildFixture(join(dir, "shop"), { arm, git: false });
    for (const rel of walk(join(dir, "shop"))) {
      const bytes = readFileSync(join(dir, "shop", rel));
      assert.ok(!bytes.includes(13), `${arm}: ${rel} holds a carriage return`);
      assert.equal(bytes.at(-1), 10, `${arm}: ${rel} does not end with a newline`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the arms differ only in the context layer, compared on the built repos", () => {
  const dir = temp();
  const withDir = join(dir, "a", "shop"), withoutDir = join(dir, "b", "shop");
  buildFixture(withDir, { arm: "with" });
  buildFixture(withoutDir, { arm: "without" });
  const withFiles = walk(withDir), withoutFiles = walk(withoutDir);
  const extra = withFiles.filter((f) => !withoutFiles.includes(f));
  assert.deepEqual(extra, [...CONTEXT_LAYER].sort(), "the with-arm holds the layer and nothing else extra");
  assert.deepEqual(withoutFiles.filter((f) => !withFiles.includes(f)), [], "the without-arm holds nothing of its own");
  for (const rel of withoutFiles) {
    assert.ok(readFileSync(join(withDir, rel)).equals(readFileSync(join(withoutDir, rel))), `${rel} differs between the arms`);
  }
  assert.notEqual(treeHash("with"), treeHash("without"));
  assert.notEqual(head(withDir), head(withoutDir));
  rmSync(dir, { recursive: true, force: true });
});

test("the arm's name is in no path, no file and no commit message", () => {
  for (const arm of ARMS) {
    const dir = temp();
    buildFixture(join(dir, "shop"), { arm });
    const log = spawnSync("git", ["log", "--format=%an|%ae|%s|%b"], { cwd: join(dir, "shop"), encoding: "utf8" }).stdout;
    assert.doesNotMatch(log, /with-arm|without-arm|\barm\b|context layer|harness|cortex/i, arm);
    for (const [rel, text] of Object.entries(fixtureFiles(arm))) {
      assert.doesNotMatch(rel, /with-arm|without-arm|harness|cortex/i, rel);
      assert.doesNotMatch(text, /with-arm|without-arm|\bharness\b|\bcortex\b/i, `${arm}: ${rel} names the experiment`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the layer is the documents only, and the shims are the one line /cortex-scaffold writes", () => {
  assert.deepEqual([...CONTEXT_LAYER].sort(), [
    "AGENTS.md", "CLAUDE.md", "CONTEXT.md", "GEMINI.md",
    "docs/adr/0001-money-is-integer-minor-units.md",
    "docs/adr/0002-migrations-are-append-only.md",
    "docs/adr/0003-routes-call-services.md",
    "src/orders/AGENTS.md", "src/store/AGENTS.md",
  ]);
  const files = fixtureFiles("with");
  assert.equal(files["CLAUDE.md"], "@AGENTS.md\n");
  assert.equal(files["GEMINI.md"], "@AGENTS.md\n");
  assert.ok(files["AGENTS.md"].includes(`Project codename: ${CODENAME}`), "the probe's canary is in the root brief");
  for (const leaf of ["src/orders/AGENTS.md", "src/store/AGENTS.md"]) {
    assert.ok(files["AGENTS.md"].includes(`](${leaf})`), `the root's routing table names ${leaf}`);
  }
  for (const rel of Object.keys(files)) assert.doesNotMatch(rel, /^\.claude\/|^\.cortex\/|REVIEW\.md$|hooks/, `${rel} is not a document`);
});

test("nothing leaks: no base file names a layer path or carries a rule's words", () => {
  const base = fixtureFiles("without");
  const names = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONTEXT.md", "docs/adr", "adr/"];
  const phrases = [CODENAME, ...Object.values(RULES).flatMap((r) => r.phrases)];
  assert.ok(phrases.length >= 9, "each rule keeps its phrases beside its sentence");
  for (const [rel, text] of Object.entries(base)) {
    const lower = text.toLowerCase();
    for (const name of names) assert.ok(!lower.includes(name.toLowerCase()), `${rel} names ${name}`);
    for (const phrase of phrases) assert.ok(!lower.includes(phrase.toLowerCase()), `${rel} carries "${phrase}"`);
  }
});

test("each rule is written where the fixture says it is, in the words the leak check looks for", () => {
  const files = fixtureFiles("with");
  assert.deepEqual(Object.keys(RULES), ["R1", "R2", "R3", "R4"]);
  for (const [id, rule] of Object.entries(RULES)) {
    assert.ok(rule.sentence.length > 40, id);
    assert.ok(rule.where.length >= 1 && rule.phrases.length >= 2, id);
    for (const rel of rule.where) {
      assert.ok(CONTEXT_LAYER.includes(rel), `${id}: ${rel} is not a layer file`);
      const lower = files[rel].toLowerCase();
      assert.ok(rule.phrases.some((p) => lower.includes(p.toLowerCase())), `${id}: ${rel} holds none of its phrases`);
    }
    const all = rule.where.map((rel) => files[rel].toLowerCase()).join("\n");
    for (const phrase of rule.phrases) assert.ok(all.includes(phrase.toLowerCase()), `${id}: "${phrase}" is in none of its documents`);
  }
});

test("the base repo is healthy: its own suite passes in both arms, with nothing installed", () => {
  for (const arm of ARMS) {
    const dir = temp();
    buildFixture(join(dir, "shop"), { arm, git: false });
    const pkg = JSON.parse(readFileSync(join(dir, "shop", "package.json"), "utf8"));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
    assert.equal(pkg.scripts.test, "node --test");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ["--test"], { cwd: join(dir, "shop"), encoding: "utf8", env });
    assert.equal(run.status, 0, `${arm}: ${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /pass [1-9]/);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the fixture is the size the spec gave it: small enough for a session, with the evidence spread out", () => {
  const base = fixtureFiles("without");
  const lines = (files) => Object.values(files).reduce((n, text) => n + text.split("\n").length - 1, 0);
  const count = Object.keys(base).length;
  assert.ok(count >= 26 && count <= 36, `${count} base files`);
  assert.ok(lines(base) >= 500 && lines(base) <= 900, `${lines(base)} base lines`);
  const layer = Object.fromEntries(CONTEXT_LAYER.map((rel) => [rel, fixtureFiles("with")[rel]]));
  assert.ok(lines(layer) >= 120 && lines(layer) <= 260, `${lines(layer)} layer lines`);
  assert.ok(lines({ a: layer["AGENTS.md"] }) <= 120, "the root brief stays short, as the template asks");
});

test("buildFixture refuses a directory that already holds something", () => {
  const dir = temp();
  buildFixture(join(dir, "shop"), { arm: "with", git: false });
  assert.throws(() => buildFixture(join(dir, "shop"), { arm: "with", git: false }), /not empty/);
  rmSync(dir, { recursive: true, force: true });
});
