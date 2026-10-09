import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_DOC_NAMES, CORTEX_BRIEF_NAMES, SHIMMED_DOC_NAMES, isContextDoc, pointsAtRootBrief } from "../lib/context-docs.mjs";
import { readState } from "../lib/next.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

function repo(files = {}) {
  const root = tempDir("cortex-ctx-");
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

// --- a doc for another tool: a pointer at AGENTS.md, or text of its own (#548, item 13) -----------

test("the shims Cortex writes for another tool point at the root brief", () => {
  // The two texts in circulation: /install-project's template and tools/cortex-init.sh's.
  assert.ok(pointsAtRootBrief("All project context and conventions live in AGENTS.md at the repo root. Follow it.\n"));
  assert.ok(pointsAtRootBrief("All project context and conventions live in `AGENTS.md` at the repo root. Read and follow it.\n"));
  assert.ok(pointsAtRootBrief("@AGENTS.md\n"));
  assert.ok(pointsAtRootBrief("\r\n\r\nSee AGENTS.md for all project context.\r\n\r\n"), "blank lines and CRLF are not text");
  assert.ok(pointsAtRootBrief("# Copilot\n\nRead AGENTS.md at the repo root.\n\nFollow it.\n"), "three lines is still a pointer");
});

test("a doc that never names AGENTS.md holds its own text, however short", () => {
  assert.ok(!pointsAtRootBrief("Use tabs.\n"));
  assert.ok(!pointsAtRootBrief(""), "an empty file points nowhere");
  assert.ok(!pointsAtRootBrief("See MY-AGENTS.md for the rules.\n"), "another file's name is not the brief");
  assert.ok(!pointsAtRootBrief("See OLD.AGENTS.md for the rules.\n"));
  assert.ok(!pointsAtRootBrief("See AGENTS.md.backup for the rules.\n"));
  assert.ok(!pointsAtRootBrief("See AGENTS.mdx for the rules.\n"));
});

test("a doc that names AGENTS.md and goes on for longer than a pointer holds its own text", () => {
  const long = ["See AGENTS.md.", "Always use tabs.", "Never commit to main.", "Run the linter first."].join("\n");
  assert.ok(!pointsAtRootBrief(long), "four lines of rules is a second brief, not a shim");
});

test("only a doc Cortex has a shim for is checked", () => {
  // .cursorrules and .windsurfrules have no Cortex shim to offer in their place, and CLAUDE.md and
  // GEMINI.md are Cortex's own to judge: /cortex appends sections to CLAUDE.md on purpose.
  assert.deepEqual(SHIMMED_DOC_NAMES, [".github/copilot-instructions.md"]);
  for (const name of SHIMMED_DOC_NAMES) assert.ok(AGENT_DOC_NAMES.includes(name), `${name} is an agent doc`);
});

test("readState says which other-tool doc holds its own text", () => {
  const rules = "# Copilot instructions\n\nUse the v1 API client.\nRun `npm run test:legacy` before a commit.\nNever touch `lib/old`.\n";
  const own = repo({ "AGENTS.md": "x", "CONTEXT.md": "x", ".github/copilot-instructions.md": rules });
  assert.deepEqual(readState(own, { files: [] }).standaloneDocs, [".github/copilot-instructions.md"]);

  const shim = repo({ "AGENTS.md": "x", "CONTEXT.md": "x", ".github/copilot-instructions.md": "All project context and conventions live in AGENTS.md at the repo root. Follow it.\n" });
  assert.deepEqual(readState(shim, { files: [] }).standaloneDocs, [], "the shim is not a doc to reconcile");

  assert.deepEqual(readState(repo({ "AGENTS.md": "x" }), { files: [] }).standaloneDocs, [], "and a repo without the file has none");
});

test("a doc too large to be a pointer is its own text without being read", () => {
  // The first line names AGENTS.md and there are no line breaks: only the size says it is not a shim.
  const huge = "See AGENTS.md. " + "x".repeat(10000);
  const root = repo({ "AGENTS.md": "x", "CONTEXT.md": "x", ".github/copilot-instructions.md": huge });
  assert.deepEqual(readState(root, { files: [] }).standaloneDocs, [".github/copilot-instructions.md"]);
});

test("a directory where the doc should be is not a doc", () => {
  const root = repo({ "AGENTS.md": "x", ".github/copilot-instructions.md/keep": "x" });
  assert.deepEqual(readState(root, { files: [] }).standaloneDocs, []);
});

test("the two questions stay separate, which is why review.mjs stays pure", () => {
  // "Is this path a context document" is a predicate over a path and needs no filesystem.
  // "What does this repo have" is an observation and needs one. reviewContext asks only the first,
  // over indexed paths, so it must not be handed readState — that would put an fs dependency and a
  // root into a module whose whole design is purity over the index.
  assert.equal(typeof isContextDoc, "function");
  assert.equal(isContextDoc.length, 1, "one argument: a path, and nothing about a repository");
});
