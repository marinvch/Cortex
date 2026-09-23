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

// --- the shared memory reports its currency, not just its count ---------------------------------
//
// `done: s.memory.length > 0` is correct and stays: "was the shared memory ever started" is settled
// by a file existing, which is the rule this module is built on. What was missing is the other
// half. The evidence read `4 digests in .cortex/memory/ (committed)` and stopped there, so a repo
// whose newest digest was 27 days old and one written this morning printed the same green tick and
// the same sentence. That is the shape of the enrichment bug this package just fixed one layer up —
// `absent`, `stale` and `ok` arriving as one silent value — and memory is where it bites hardest,
// because memory is a CADENCE step. Enrichment is run once on an unfamiliar repo; a digest is
// supposed to land at the end of a working day, so "started" and "current" are different questions
// and only one of them was being answered.
//
// The fix has to name the date rather than compute an age. A clock in here would mean the same tree
// answers differently tomorrow, which `index/AGENTS.md` forbids for this module by name. So the
// sequence states the fact and the reader supplies today — the same division readEnrichment makes,
// where the reader owns the fact and the caller owns the policy.

test("a started memory names its newest digest, so currency is visible", () => {
  const root = repo(({ put }) => {
    put(".cortex/memory/2026-08-15.md");
    put(".cortex/memory/2026-08-23.md");
    put(".cortex/memory/2026-08-17.md");
  });
  const step = nextSteps(root).steps.find((s) => s.id === "memory");

  assert.equal(step.done, true, "three digests exist, so the step is started");
  assert.match(step.why, /2026-08-23/, "the evidence names the newest digest");
  assert.equal(readState(root).memoryLatest, "2026-08-23", "and the fact is on state for callers");
  rmSync(root, { recursive: true, force: true });
});

// A test asserting the maximum against sort order was written here and removed. `filesIn` sorts
// and ISO dates sort lexically, so `at(-1)` and the maximum are the same value for every input that
// can reach `readState` — it passed under both implementations, pinned nothing, and would have read
// as coverage. The date filter below is the half that does carry weight.

test("an unstarted memory has no newest digest and still invites the first one", () => {
  // Absence is not staleness. Enrichment's reader charges nothing for `absent` and neither does
  // this: a repo that never dreamt gets the invitation it always got, and `memoryLatest` is null
  // rather than a placeholder date a caller could subtract from.
  const root = repo(() => {});
  const step = nextSteps(root).steps.find((s) => s.id === "memory");

  assert.equal(step.done, false);
  assert.equal(readState(root).memoryLatest, null);
  assert.doesNotMatch(step.why, /\d{4}-\d{2}-\d{2}/, "no date is invented for a memory that has none");
  rmSync(root, { recursive: true, force: true });
});

test("a digest whose name is not a date does not become the newest one", () => {
  // `.cortex/memory/` is one file per day, but nothing stops a stray README landing there, and a
  // non-date sorting above every real digest would pin the evidence to a file that is not a digest.
  const root = repo(({ put }) => {
    put(".cortex/memory/README.md");
    put(".cortex/memory/2026-08-23.md");
  });
  assert.equal(readState(root).memoryLatest, "2026-08-23");
  rmSync(root, { recursive: true, force: true });
});
