import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readState, nextSteps, nextLine } from "../lib/next.mjs";
import { adoptStamp, recordStamp, runningCortex, writeStamps } from "../lib/stamps.mjs";
import { SHIPPED_SECTIONS } from "../lib/shipped-sections.mjs";
import { renderTemplate } from "../lib/placeholders.mjs";

// The loop reads this machine's CORTEX_PROFILE for its team-plugin row. These tests describe a repo,
// not a machine, so a developer on a work profile must get the same answers as CI. A test that is
// about the profile states it through `teamServed(root, env)`.
delete process.env.CORTEX_PROFILE;

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

// --- the second round: what one /cortex pass cannot close -----------------------------------------
//
// evals and bands are blocked until /cortex writes CLAUDE.md and REVIEW.md, so they only become
// `missing` AFTER the pass that could have written them — and then each waits on history a second
// pass cannot invent. The loop row used to answer that with "Next → /cortex", again and forever, on
// a real install (pmndrs/zustand) whose owner had rightly deferred bands for want of a metric.

function servedFirstPass({ put }) {
  put(".cortex/index/index.json", INDEX);
  put(".cortex/findings/2026-01-01.md");
  put("package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
  put("AGENTS.md");
  put("CLAUDE.md", "@AGENTS.md\n\n## Verifying your work\n\n| Test | `npm test` |\n");
  put("CONTEXT.md");
  put("REVIEW.md");
  put("intent/README.md");
  put("src/auth/AGENTS.md");
  put(".claude/skills/add-test/SKILL.md");
  put(".claude/agents/verifier.md");
  put(".claude/settings.json", '{ "hooks": {} }');
  put(".github/workflows/ci.yml", "name: ci\n");
  put(".github/workflows/cortex-review.yml", "name: cortex-review\njobs:\n  review:\n    steps:\n      - run: node \"$CORTEX/index/cortex-review.mjs\" --since \"$BASE\"\n");
}

test("after the first pass, next names /cortex evals — not /cortex again", () => {
  const root = repo(servedFirstPass);
  const plan = nextSteps(root);
  const loop = plan.steps.find((s) => s.id === "loop");
  assert.equal(loop.done, true, "everything one pass can write is written");
  assert.match(loop.why, /wait on history/);
  assert.equal(plan.next.id, "evals");
  assert.equal(plan.next.cmd, "/cortex evals");
  assert.match(plan.next.why, /task history/, "it says what it is waiting for");
  assert.match(nextLine(root), /^Next → \/cortex evals /);
  const bands = plan.steps.find((s) => s.id === "bands");
  assert.equal(bands.cmd, "/cortex bands");
  assert.equal(bands.optional, true, "a repo with no production metric is finished without bands");
  rmSync(root, { recursive: true, force: true });
});

test("a repo whose hooks would have no work finishes the first pass without them", () => {
  // No generated path, no lockfile, no formatter: both hook templates would stamp as no-ops, so the
  // hooks row does not apply. The pass is done without it — and a hooks block left by an earlier
  // release is not what made it done.
  for (const settings of [false, true]) {
    const root = repo(({ root: r, put }) => {
      servedFirstPass({ put });
      if (!settings) rmSync(join(r, ".claude/settings.json"));
    });
    const plan = nextSteps(root);
    const loop = plan.steps.find((s) => s.id === "loop");
    assert.equal(loop.done, true, `settings.json ${settings ? "present" : "absent"}: one pass has nothing left to write`);
    assert.equal(plan.next.id, "evals");
    assert.equal(nextLine(root), nextLine(root), "deterministic");
    rmSync(root, { recursive: true, force: true });
  }
});

test("on a repo with code, the agent team is a loop row like the others — open until the playbook lands", () => {
  // The team row is a loop artifact, so the sequence shows it through the loop row and its count,
  // not as a list of its own. It asks for code: the fixtures above index an empty tree (greenfield),
  // where the row waits and holds nothing open.
  const withCode = JSON.stringify({ version: "1", files: [{ path: "src/a.js" }], stats: { files: 1 }, edges: [], areas: [], layers: [] });
  const open = repo(({ put }) => {
    servedFirstPass({ put });
    put(".cortex/index/index.json", withCode);
  });
  const loop = nextSteps(open, JSON.parse(withCode)).steps.find((s) => s.id === "loop");
  assert.equal(loop.done, false, "the team is still to be offered");
  assert.equal(readState(open, JSON.parse(withCode)).loopMissing.includes("team"), true);
  rmSync(open, { recursive: true, force: true });

  const closed = repo(({ put }) => {
    servedFirstPass({ put });
    put(".cortex/index/index.json", withCode);
    put("CLAUDE.md", "@AGENTS.md\n\n## Verifying your work\n\n| Test | `npm test` |\n\n## Working as a team\n\nAgents: `tester`.\n");
  });
  assert.equal(nextSteps(closed, JSON.parse(withCode)).steps.find((s) => s.id === "loop").done, true, "the playbook in CLAUDE.md closes it");
  rmSync(closed, { recursive: true, force: true });
});

test("a team section an earlier release wrote is a required row; one the team edited is shown, never next (#505)", () => {
  const tpl = (rel) => readFileSync(new URL(`../../templates/${rel}`, import.meta.url), "utf8");
  const OLD = SHIPPED_SECTIONS["team/playbook.md"].earlier[0].text;
  const roster = { ROSTER: "`architect`, `tester`" };
  const withSection = (section) => repo(({ put }) => put("CLAUDE.md", `@AGENTS.md\n\n${section}`));
  const row = (root) => nextSteps(root).steps.find((s) => s.id === "sections");

  const outdated = withSection(renderTemplate(OLD, roster));
  const r = row(outdated);
  assert.ok(r, "an outdated section is a row");
  assert.equal(r.optional, false, "required: a /cortex pass has a decision to make");
  assert.equal(r.cmd, "/cortex");
  assert.match(r.why, /CLAUDE\.md § Working as a team is Cortex 2\.41\.0's text/);
  assert.match(r.why, /cortex-section\.mjs \./);

  const edited = withSection(renderTemplate(tpl("team/playbook.md"), roster).replace("The developer decides", "The lead decides"));
  const e = row(edited);
  assert.equal(e.optional, true, "edited: shown with where to see the diff, but never next — it is theirs");
  assert.match(e.why, /edited here/);
  assert.notEqual(nextSteps(edited).next?.id, "sections");

  assert.equal(row(withSection(renderTemplate(tpl("team/playbook.md"), roster))), undefined, "a current section has no row");
  assert.equal(row(repo(({ put }) => put("CLAUDE.md", "@AGENTS.md\n"))), undefined, "nor does a repo without one");
  for (const root of [outdated, edited]) rmSync(root, { recursive: true, force: true });
});

test("with a real eval case written and bands deferred, the sequence ends", () => {
  const root = repo(({ put }) => {
    servedFirstPass({ put });
    put("evals/cases/login-bug/prompt.md");
  });
  const plan = nextSteps(root);
  assert.equal(plan.complete, true, "deferring bands must not hold the sequence open forever");
  assert.equal(plan.next, null);
  assert.ok(plan.steps.some((s) => s.id === "bands" && !s.done), "bands is still visible, with its command");
  rmSync(root, { recursive: true, force: true });
});

test("before the first pass, the second-round rows do not appear — /cortex reaches them itself", () => {
  const root = repo(({ put }) => {
    put(".cortex/index/index.json", INDEX);
    put(".cortex/findings/2026-01-01.md");
    put("AGENTS.md");
    put("CONTEXT.md");
    put(".github/workflows/ci.yml", "name: ci\n");
  });
  const plan = nextSteps(root);
  assert.equal(plan.steps.find((s) => s.id === "loop").done, false);
  assert.ok(!plan.steps.some((s) => s.id === "evals" || s.id === "bands"));
  rmSync(root, { recursive: true, force: true });
});

// #462: a re-run upgraded the loop and left two skills telling agents the repo had no tests. The
// skills row stays a file fact — the skill exists — and the drift is a row of its own, present only
// when a line is provably wrong, so every repo without drift reads exactly as it did before.
test("a skill the repo contradicts gets its own row, and a clean one adds nothing", () => {
  const index = {
    version: "1",
    files: [{ path: "src/a.ts" }, { path: "src/a.test.ts", isTest: true }, { path: ".claude/skills/t/SKILL.md" }],
    stats: { tests: 1 },
  };
  const root = repo(({ put }) => {
    put("src/a.ts");
    put("src/a.test.ts");
    put(".claude/skills/t/SKILL.md", "---\nname: t\ndescription: x\n---\n\nThere are no tests here. Start at `src/gone.ts`.\n");
  });
  const row = nextSteps(root, index).steps.find((s) => s.id === "skill-drift");
  assert.ok(row, "the drifted skill surfaces");
  assert.equal(row.done, false);
  assert.equal(row.cmd, "/cortex-skills");
  assert.match(row.why, /^t \(2\) — 2 lines/);
  assert.deepEqual(row.drift[0].findings.map((f) => [f.line, f.kind]), [[6, "path"], [6, "tests"]]);
  assert.equal(nextSteps(root, index).steps.find((s) => s.id === "skills").done, true, "the skill still exists");

  // Without an index nothing is provable, so there is no row — never a guess from prose alone.
  assert.ok(!nextSteps(root).steps.some((s) => s.id === "skill-drift"));
  assert.equal(readState(root).skillDrift, null);

  writeFileSync(join(root, ".claude/skills/t/SKILL.md"), "---\nname: t\ndescription: x\n---\n\nStart at `src/a.ts`.\n");
  assert.ok(!nextSteps(root, index).steps.some((s) => s.id === "skill-drift"), "fixing the lines clears the row");
  assert.deepEqual(readState(root, index).skillDrift, []);
  rmSync(root, { recursive: true, force: true });
});

// --- the stamp record (spec S4) ----------------------------------------------------------------------

const REVIEW_TEMPLATE = readFileSync(new URL("../../templates/loop/REVIEW.md", import.meta.url), "utf8");
const stampsRow = (root) => nextSteps(root).steps.find((s) => s.id === "stamps");

// The release this checkout is. A fixture recorded by it is never "a newer Cortex" by accident; one
// recorded by AHEAD always is, whatever VERSION says on the day the test runs.
const RUNNING = runningCortex();
const AHEAD = `${Number(RUNNING.split(".")[0]) + 1}.0.0`;
const esc = (v) => v.replace(/\./g, "\\.");

/** A REVIEW.md on disk, recorded from `templateText` — the real template, or an older one. */
function stampedReview({ put, root }, templateText, fileText = templateText, version = RUNNING) {
  put("REVIEW.md", fileText);
  writeStamps(root, recordStamp(null, { path: "REVIEW.md", template: "loop/REVIEW.md", version, templateText, fileText }));
}

test("a repo with no record and no loop files reads exactly as it did before the record existed", () => {
  const root = repo(({ put }) => put("src/app.ts"));
  assert.equal(stampsRow(root), undefined);
  assert.deepEqual(readState(root).stamps, null);
  assert.deepEqual(readState(root).stampsAdopt, []);
  assert.equal(readState(root).stampsOlderPlugin, null, "a fact stated as null, not left undefined");
  rmSync(root, { recursive: true, force: true });
});

test("a stamped file behind this release's template is a required row, and it clears once current", () => {
  const root = repo((r) => stampedReview(r, "# an older REVIEW.md template\n"));
  const row = stampsRow(root);
  assert.ok(row, "the out-of-date file surfaces");
  assert.equal(row.done, false);
  assert.ok(!row.optional, "an update is a fix not applied — it holds the sequence open");
  assert.equal(row.cmd, "/cortex");
  assert.match(row.why, /1 to update/);
  assert.match(row.why, /cortex-stamps\.mjs \./);

  // Re-stamped from this release's template: current, and the row is gone.
  const root2 = repo((r) => stampedReview(r, REVIEW_TEMPLATE));
  assert.equal(stampsRow(root2), undefined);
  rmSync(root, { recursive: true, force: true });
  rmSync(root2, { recursive: true, force: true });
});

test("a file only the team edited is theirs, and raises no row", () => {
  const root = repo((r) => stampedReview(r, REVIEW_TEMPLATE));
  writeFileSync(join(root, "REVIEW.md"), REVIEW_TEMPLATE + "\nOur own rule.\n");
  assert.equal(readState(root).stamps[0].state, "edited");
  assert.equal(stampsRow(root), undefined);
  rmSync(root, { recursive: true, force: true });
});

test("a conflict is a required row; a missing file alone is an optional one", () => {
  const conflict = repo((r) => stampedReview(r, "# older\n"));
  writeFileSync(join(conflict, "REVIEW.md"), "# older\n\nOur own rule.\n");
  assert.match(stampsRow(conflict).why, /1 to decide file by file/);
  assert.ok(!stampsRow(conflict).optional);

  const missing = repo((r) => stampedReview(r, REVIEW_TEMPLATE));
  rmSync(join(missing, "REVIEW.md"));
  assert.match(stampsRow(missing).why, /1 missing/);
  assert.equal(stampsRow(missing).optional, true, "a file someone deleted on purpose must not block the sequence");
  rmSync(conflict, { recursive: true, force: true });
  rmSync(missing, { recursive: true, force: true });
});

test("loop files from before the record are offered for adoption, never as a blocking step", () => {
  const root = repo(({ put }) => {
    put("REVIEW.md", "# review\n");
    put(".claude/agents/verifier.md", "# verifier\n");
  });
  const row = stampsRow(root);
  assert.ok(row, "an older install's files surface");
  assert.equal(row.optional, true, "declining adoption leaves no trace, so it must not hold the sequence open forever");
  assert.match(row.title, /adopt/i);
  assert.match(row.why, /2 loop files/);
  assert.match(row.why, /REVIEW\.md/);
  rmSync(root, { recursive: true, force: true });
});

test("a record a newer Cortex wrote asks for the plugin update first, with both commands", () => {
  // Stamped from an older template by a newer release: to this plugin the file reads as update, which
  // is exactly the row an older plugin must not offer — it would put its own older template back.
  const root = repo((r) => stampedReview(r, "# an older REVIEW.md template\n", undefined, AHEAD));
  const row = stampsRow(root);
  assert.ok(row);
  assert.ok(!row.optional, "a teammate a release behind must update before anything else here");
  assert.equal(row.blocking, true, "every stamp answer below it is measured against the wrong templates");
  assert.equal(nextSteps(root).next.id, "stamps", "so it is the one command to run now");
  assert.match(row.title, /update the Cortex plugin/i);
  assert.match(row.why, new RegExp(`stamped by Cortex ${esc(AHEAD)} and this is Cortex ${esc(RUNNING)}`));
  assert.match(row.why, /`claude plugin marketplace update cortex`, then `claude plugin update cortex@cortex`, then `\/reload-plugins` or a new session/);
  assert.doesNotMatch(row.why, /to update/, "no count of files to update — that count is the older plugin's misreading");
  assert.equal(row.cmd, "claude plugin marketplace update cortex && claude plugin update cortex@cortex");
  // An ignored record is still said, as its own sentence after the update.
  const ignored = nextSteps(root, null, { stampsIgnored: { source: ".gitignore", line: 3 } }).steps.find((s) => s.id === "stamps");
  assert.match(ignored.why, /a new session\. Also, \.cortex\/stamps\.json is ignored by \.gitignore:3, so the team does not share it\.$/);
  rmSync(root, { recursive: true, force: true });
});

test("the same release, or a record no known release wrote, raises no plugin warning", () => {
  const same = repo((r) => stampedReview(r, REVIEW_TEMPLATE));
  assert.equal(stampsRow(same), undefined, "equal versions: current, and nothing to say");
  const adopted = repo(({ put, root }) => {
    put("REVIEW.md", "# ours\n");
    writeStamps(root, adoptStamp(null, { path: "REVIEW.md", template: "loop/REVIEW.md" }));
  });
  const row = stampsRow(adopted);
  assert.doesNotMatch(row.why, /older plugin/, "cortex: null is no release at all");
  assert.ok(!row.blocking);
  rmSync(same, { recursive: true, force: true });
  rmSync(adopted, { recursive: true, force: true });
});

test("a damaged record is a required row naming the file, never a silent pass", () => {
  const root = repo(({ put }) => put(".cortex/stamps.json", "{ not json"));
  const row = stampsRow(root);
  assert.ok(row);
  assert.ok(!row.optional);
  assert.match(row.why, /stamps\.json/);
  rmSync(root, { recursive: true, force: true });
});
