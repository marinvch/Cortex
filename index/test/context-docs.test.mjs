import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_DOC_NAMES, CORTEX_BRIEF_NAMES, isContextDoc } from "../lib/context-docs.mjs";
import { readState } from "../lib/next.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

function repo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "cortex-ctx-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

test("the vocabulary has one home, and readState is the one reader of a repo", () => {
  // findings.mjs checked two names, next.mjs listed six, review.mjs matched a regex over four plus
  // docs/adr. Three answers to one question, and two of them reached the user from one command.
  assert.equal(AGENT_DOC_NAMES.length, 6);
  assert.ok(AGENT_DOC_NAMES.includes("AGENTS.md"));
  assert.ok(AGENT_DOC_NAMES.includes(".cursorrules"), "the name that made the two answers disagree");
  assert.deepEqual(CORTEX_BRIEF_NAMES, ["AGENTS.md", "CLAUDE.md", "GEMINI.md"], "the ones Cortex writes or routes");

  const root = repo({ ".cursorrules": "x", "src/a.js": "" });
  const s = readState(root, { files: [] });
  assert.equal(s.rootBrief, false, "there is no AGENTS.md");
  assert.deepEqual(s.priorDocs, [".cursorrules"], "and readState says what there IS instead");
});

test("isContextDoc governs code; it deliberately does not include another tool's config", () => {
  // Scoped on purpose. Widening citationDrift's input is how a check that found 7 real problems on
  // this repo once returned 157. Several real repos carry a .github/copilot-instructions.md, so
  // this is a live constraint rather than a hypothetical one.
  assert.ok(isContextDoc("AGENTS.md"));
  assert.ok(isContextDoc("index/AGENTS.md"), "a leaf brief governs its directory");
  assert.ok(isContextDoc("CONTEXT.md"));
  assert.ok(isContextDoc("docs/adr/0001-x.md"));
  assert.ok(!isContextDoc(".cursorrules"), "root tool configuration is context, but it governs nothing");
  assert.ok(!isContextDoc(".github/copilot-instructions.md"));
  assert.ok(!isContextDoc("README.md"));
});

test("the two questions stay separate, which is why review.mjs stays pure", () => {
  // "Is this path a context document" is a predicate over a path and needs no filesystem.
  // "What does this repo have" is an observation and needs one. reviewContext asks only the first,
  // over indexed paths, so it must not be handed readState — that would put an fs dependency and a
  // root into a module whose whole design is purity over the index.
  assert.equal(typeof isContextDoc, "function");
  assert.equal(isContextDoc.length, 1, "one argument: a path, and nothing about a repository");
});
