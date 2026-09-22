import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readState, nextSteps, nextLine } from "../lib/next.mjs";

function repo(build) {
  const root = mkdtempSync(join(tmpdir(), "cortex-next-"));
  const put = (rel, body = "x") => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  };
  build({ root, put });
  return root;
}

const INDEX = JSON.stringify({ version: "1", files: [], edges: [], areas: [], layers: [] });

test("a bare repo starts at step one", () => {
  const root = repo(() => {});
  const plan = nextSteps(root);
  assert.equal(plan.next.id, "index");
  assert.equal(plan.done, 0);
  // `/cortex`, not `/cortex-install`. The sequence is what a user gets walking it one command at a
  // time; the front door exists so they do not have to, and one run of it satisfies index through
  // skills. Naming the sub-step here would send someone who asked "what now" back to the menu.
  assert.match(nextLine(root), /\/cortex\b/);
  assert.doesNotMatch(nextLine(root), /cortex-install/);
  rmSync(root, { recursive: true, force: true });
});

test("done is a file on disk, never an inference", () => {
  const root = repo(({ put }) => put(".cortex/index/index.json", INDEX));
  const plan = nextSteps(root);
  const step = plan.steps.find((s) => s.id === "index");
  assert.equal(step.done, true);
  assert.equal(plan.next.id, "findings");
  rmSync(root, { recursive: true, force: true });
});

test("optional steps never become next and never block", () => {
  const root = repo(({ put }) => {
    put(".cortex/index/index.json", INDEX);
    put(".cortex/findings/2026-01-01.md");
  });
  const plan = nextSteps(root);
  // `view` is optional and unfinished, and sits above scaffold in the list — it must be skipped.
  assert.equal(plan.steps.find((s) => s.id === "view").done, false);
  assert.equal(plan.next.id, "scaffold");
  rmSync(root, { recursive: true, force: true });
});

test("a retired engine jumps the queue no matter how far along the repo is", () => {
  const root = repo(({ put }) => {
    put(".ai-os/memory.json", "{}");
    put(".cortex/index/index.json", INDEX);
    put(".cortex/findings/2026-01-01.md");
    put("AGENTS.md");
    put("CONTEXT.md");
  });
  const plan = nextSteps(root);
  assert.equal(plan.next.id, "migrate");
  assert.equal(plan.next.blocking, true);
  assert.match(plan.next.why, /\.ai-os/);
  rmSync(root, { recursive: true, force: true });
});

test("agent docs that predate the index are flagged for reconciling BEFORE scaffold", () => {
  const root = repo(({ put }) => {
    put("CLAUDE.md", "# hand-written");
    put(".cortex/index/index.json", INDEX);
    put(".cortex/findings/2026-01-01.md");
  });
  const plan = nextSteps(root);
  const ids = plan.steps.map((s) => s.id);
  assert.ok(ids.includes("reconcile"), "reconcile step is present");
  assert.ok(ids.indexOf("reconcile") < ids.indexOf("scaffold"), "reconcile comes before scaffold");
  assert.equal(plan.next.id, "reconcile");
  rmSync(root, { recursive: true, force: true });
});

test("classifying a prior agent doc does not depend on write order or a filesystem clock", () => {
  // The first version compared mtimes against the index and passed on Windows while failing on
  // Linux, where both writes land in the same millisecond. Writing the doc AFTER the index — the
  // order that made the mtime check say "Cortex wrote this" — must still flag it.
  const root = repo(({ put }) => {
    put(".cortex/index/index.json", INDEX);
    put(".cortex/findings/2026-01-01.md");
    put("CLAUDE.md", "# hand-written, saved last");
  });
  assert.equal(nextSteps(root).next.id, "reconcile");
  rmSync(root, { recursive: true, force: true });
});

test("once the context layer exists, an old AGENTS.md is Cortex's own and not a reconcile job", () => {
  const root = repo(({ put }) => {
    put("AGENTS.md");
    put("CONTEXT.md");
    put(".cortex/index/index.json", INDEX);
    put(".cortex/findings/2026-01-01.md");
  });
  const plan = nextSteps(root);
  assert.ok(!plan.steps.some((s) => s.id === "reconcile"));
  rmSync(root, { recursive: true, force: true });
});

test("scoped briefs are counted from the index, not from a filesystem sweep", () => {
  const root = repo(({ put }) => put(".cortex/index/index.json", INDEX));
  const index = {
    files: [{ path: "src/auth/AGENTS.md" }, { path: "AGENTS.md" }, { path: "src/app.js" }],
  };
  const state = readState(root, index);
  assert.deepEqual(state.briefs, ["src/auth/AGENTS.md"], "root AGENTS.md is not a scoped brief");
  rmSync(root, { recursive: true, force: true });
});

// What "finished" means changed, and the fixture is where that is visible. A context layer used to
// be the end of the sequence; it is now the middle of it. A repo with AGENTS.md and no artifact
// chain has somewhere for an agent to read context and nowhere for a decision to land, which is
// exactly the half-served state the loop row was added to stop reporting as done.
//
// The rows added below are the ones that APPLY to this fixture. The rest — evals, bands, the
// verifier — are blocked on a CI system and a declared test command it does not have, and blocked
// rows deliberately do not hold `complete` open: a repo with no CI is legitimately finished without
// an eval suite, and reporting it incomplete forever would train the reader to ignore the number.
test("a finished repo reports complete and names the per-change rituals", () => {
  const root = repo(({ put }) => {
    put(".cortex/index/index.json", INDEX);
    put(".cortex/findings/2026-01-01.md");
    put("AGENTS.md");
    put("CLAUDE.md");
    put("CONTEXT.md");
    put("REVIEW.md");
    put("intent/README.md");
    put("src/auth/AGENTS.md");
    put(".claude/skills/plan-feature/SKILL.md");
  });
  const plan = nextSteps(root);
  assert.equal(plan.complete, true);
  assert.equal(plan.next, null);
  assert.match(nextLine(root), /cortex-review/);
  rmSync(root, { recursive: true, force: true });
});

test("every step carries a command and a reason", () => {
  const root = repo(() => {});
  for (const s of nextSteps(root).steps) {
    assert.ok(s.cmd && s.cmd.length, `${s.id} has a command`);
    assert.ok(s.why && s.why.length, `${s.id} says why`);
    assert.ok(s.title && s.title.length, `${s.id} has a title`);
  }
  rmSync(root, { recursive: true, force: true });
});
