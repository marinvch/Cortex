import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootProblem } from "../lib/root.mjs";

// Eight CLIs took a repo root and trusted whatever they resolved. The failure had no error state:
// buildIndex on a directory that does not exist returns zero files rather than throwing, so
// `cortex-index -v` printed "Indexed 0 files" and wrote ./-v/.cortex/index/index.json, and
// `cortex-next /nope` printed "0 of 8 steps done. Every ✓ is a file on disk, not a guess."

test("a real directory is not a problem", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-root-"));
  assert.equal(rootProblem(root), null);
});

test("a path that does not exist is refused, and named", () => {
  const root = join(mkdtempSync(join(tmpdir(), "cortex-root-")), "nope");
  const problem = rootProblem(root);
  assert.ok(problem, "a missing root must not pass");
  assert.match(problem, /not a directory/);
  assert.ok(problem.includes(root), "the message names the path, because the user has to fix it");
  assert.match(problem, /Nothing was changed/, "and says nothing happened");
});

test("a FILE is refused too — existence is not the question", () => {
  // The cheap version of this check is existsSync, and it passes here. `cortex-index ./VERSION`
  // would then walk a file as though it were a repository.
  const dir = mkdtempSync(join(tmpdir(), "cortex-root-"));
  const file = join(dir, "VERSION");
  writeFileSync(file, "2.0.0\n");
  assert.ok(rootProblem(file), "a file is not a repository root");
});

test("a symlink to a real directory is fine", () => {
  // statSync follows links, deliberately. A repo reached through a symlink is a repo — containment
  // is core/paths.js's question, and conflating the two would break a normal checkout layout.
  const base = mkdtempSync(join(tmpdir(), "cortex-root-"));
  const real = join(base, "real");
  const link = join(base, "link");
  mkdirSync(real);
  try {
    symlinkSync(real, link, "dir");
  } catch {
    return; // unprivileged Windows cannot create one; the assertion is not worth an admin shell
  }
  assert.equal(rootProblem(link), null);
});

test("the message is one string, so eight commands cannot disagree about one problem", () => {
  const a = rootProblem("/no/such/path/one");
  const b = rootProblem("/no/such/path/two");
  assert.equal(
    a.replace("/no/such/path/one", "X"),
    b.replace("/no/such/path/two", "X"),
    "only the path may differ between two reports of the same fault",
  );
});
