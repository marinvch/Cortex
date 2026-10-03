// instructions.test.mjs — when Cortex says a repo's scoped briefs do not load on their own.
//
// The fact is narrow on purpose: a CLAUDE.md that counts at the root, and at least one scoped
// AGENTS.md whose own directory has no CLAUDE.md. Each case below removes one of those conditions,
// and the last three pin that the report and cortex-next print the same sentence from one place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { leavesNotLoaded, leavesNote } from "../lib/instructions.mjs";
import { render } from "../lib/findings.mjs";
import { nextSteps } from "../lib/next.mjs";
import { rule } from "../../core/claude-code.js";

const fact = (paths) =>
  leavesNotLoaded({ briefs: paths.filter((p) => p.endsWith("/AGENTS.md")), exists: (p) => paths.includes(p) });

test("a root CLAUDE.md and a scoped brief: the brief loads by routing only", () => {
  assert.deepEqual(fact(["CLAUDE.md", "AGENTS.md", "src/auth/AGENTS.md"]), {
    counting: ["CLAUDE.md"],
    leaves: ["src/auth/AGENTS.md"],
  });
});

test("each file the docs count as a CLAUDE.md counts", () => {
  for (const counting of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
    assert.deepEqual(fact([counting, "src/AGENTS.md"])?.counting, [counting], counting);
  }
});

test("no CLAUDE.md at the root: Claude Code reads the briefs itself, so nothing is said", () => {
  assert.equal(fact(["AGENTS.md", "src/auth/AGENTS.md"]), null);
  assert.equal(fact(["GEMINI.md", "AGENTS.md", "src/auth/AGENTS.md"]), null);
});

test("a CLAUDE.md with no scoped brief: nothing is left unloaded", () => {
  assert.equal(fact(["CLAUDE.md", "AGENTS.md"]), null);
});

test("a brief whose own directory has a CLAUDE.md is not listed", () => {
  assert.equal(fact(["CLAUDE.md", "src/auth/AGENTS.md", "src/auth/CLAUDE.md"]), null);
  assert.deepEqual(fact(["CLAUDE.md", "src/auth/AGENTS.md", "src/auth/CLAUDE.md", "src/pay/AGENTS.md"])?.leaves, [
    "src/pay/AGENTS.md",
  ]);
});

test("a CLAUDE.md in a subdirectory does not count for the root", () => {
  assert.equal(fact(["docs/CLAUDE.md", "src/auth/AGENTS.md"]), null);
});

test("the sentence names the count, the file, the setting and the rule it rests on", () => {
  const r = rule("agents-md.default-needs-no-claude-md");
  const one = leavesNote({ counting: ["CLAUDE.md"], leaves: ["src/AGENTS.md"] });
  assert.match(one, /^1 scoped brief loads through the routing table only: CLAUDE\.md at the root/);
  assert.ok(one.includes("`claude-md-and-agents-md`"));
  assert.ok(one.includes(`\`${r.id}\``) && one.includes(r.source));
  assert.match(leavesNote({ counting: ["CLAUDE.md"], leaves: ["a/AGENTS.md", "b/AGENTS.md"] }), /^2 scoped briefs load through/);
});

const indexOf = (paths) => ({
  stats: { files: paths.length, lines: 10, edges: 0, tests: 0, languages: {} },
  areas: [],
  commit: null,
  files: paths.map((path) => ({ path })),
});

test("the findings report states it at a glance, with or without findings", () => {
  const paths = ["CLAUDE.md", "AGENTS.md", "src/auth/AGENTS.md"];
  const note = leavesNote(fact(paths));
  assert.ok(render(indexOf(paths), [], { day: "2026-10-03" }).includes(`- ${note}`));
  const some = [{ severity: "low", kind: "x", title: "T", detail: "D", evidence: [] }];
  assert.ok(render(indexOf(paths), some, { day: "2026-10-03" }).includes(`- ${note}`));
});

test("the findings report says nothing when Claude Code reads the briefs itself", () => {
  const out = render(indexOf(["AGENTS.md", "src/auth/AGENTS.md"]), [], { day: "2026-10-03" });
  assert.ok(!out.includes("routing table only"));
});

test("cortex-next carries the same sentence on the brief step, and only when it is true", () => {
  const make = (files) => {
    const root = mkdtempSync(join(tmpdir(), "cortex-instr-"));
    for (const rel of files) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), "x");
    }
    return root;
  };
  const shim = make(["CLAUDE.md", "AGENTS.md", "src/auth/AGENTS.md"]);
  const brief = nextSteps(shim).steps.find((s) => s.id === "brief");
  assert.ok(brief.why.includes(leavesNote({ counting: ["CLAUDE.md"], leaves: ["src/auth/AGENTS.md"] })), brief.why);
  rmSync(shim, { recursive: true, force: true });

  const direct = make(["AGENTS.md", "src/auth/AGENTS.md"]);
  assert.ok(!nextSteps(direct).steps.find((s) => s.id === "brief").why.includes("routing table only"));
  rmSync(direct, { recursive: true, force: true });
});
