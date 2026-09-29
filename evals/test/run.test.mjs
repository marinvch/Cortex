// run.mjs is the alarm for "my edit made this ritual worse", so each guard it holds is tested here with
// the model call injected — nothing in this file spawns `claude`. A guard that silently passed would be
// worse than no guard: it would tell a contributor their edit was measured when it was not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bodySha256, skillBody, check, runTasks, judgeRecord, main, NO_SKILL_SYSTEM } from "../run.mjs";

const EVALS = join(dirname(fileURLToPath(import.meta.url)), "..");
const TASKS = JSON.parse(readFileSync(join(EVALS, "data", "resume", "test", "tasks.json"), "utf8")).slice(0, 4);
const right = (t) => `UNCOMMITTED: ${t.uncommitted}\nHIDDEN: ${t.hidden.join(", ") || "none"}\nROUTE: ${t.route}`;
const truthOf = (user) => TASKS.find((t) => t.prompt === user).truth;

const FM = "---\nname: resume\ndescription: pick up work in flight\nmetadata:\n  capability: judgment\n---\n";
const BODY = "# /resume\n\nRead the state off disk before touching anything.\n";

// A throwaway repo root with the three places run.mjs reads: the skill, the tasks, the baseline.
function fixture({ skill = FM + BODY, baseline } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cortex-evals-run-"));
  mkdirSync(join(root, "skills", "resume"), { recursive: true });
  writeFileSync(join(root, "skills", "resume", "SKILL.md"), skill);
  mkdirSync(join(root, "evals", "data", "resume", "test"), { recursive: true });
  writeFileSync(join(root, "evals", "data", "resume", "test", "tasks.json"), JSON.stringify(TASKS));
  if (baseline) {
    mkdirSync(join(root, "evals", "baselines"), { recursive: true });
    writeFileSync(join(root, "evals", "baselines", "resume.json"), JSON.stringify(baseline, null, 2) + "\n");
  }
  return root;
}
const baselinePath = (root) => join(root, "evals", "baselines", "resume.json");
const quiet = { log() {}, error() {} };
const deps = (root, call, extra = {}) => ({ root, call, skills: ["resume"], ...quiet, ...extra });
const prev = (over = {}) => ({ skill: "resume", bodySha256: bodySha256(FM + BODY), split: "test", n: 4, hard: 1, soft: 1, model: "m", recordedAt: "2026-01-01T00:00:00.000Z", ...over });

// ── the hash ──────────────────────────────────────────────────────────────────────────────────────

test("the body hash ignores frontmatter — routing metadata is never trained, so editing it needs no re-measure", () => {
  const other = "---\nname: resume\ndescription: a different description entirely\n---\n";
  assert.equal(bodySha256(other + BODY), bodySha256(FM + BODY));
  assert.equal(skillBody(FM + BODY), BODY);
});

test("the body hash ignores line endings, so a CRLF checkout never demands a re-measure", () => {
  assert.equal(bodySha256((FM + BODY).replace(/\n/g, "\r\n")), bodySha256(FM + BODY));
});

test("the body hash changes when one word of the body changes", () => {
  assert.notEqual(bodySha256(FM + BODY.replace("disk", "desk")), bodySha256(FM + BODY));
});

// ── --check ───────────────────────────────────────────────────────────────────────────────────────

test("--check passes when every evaled skill's body matches its baseline", async () => {
  const root = fixture({ baseline: prev() });
  assert.deepEqual(check({ root, skills: ["resume"] }).problems, []);
  assert.equal(await main(["--check"], deps(root)), 0);
  rmSync(root, { recursive: true, force: true });
});

test("--check passes after a frontmatter-only edit", () => {
  const root = fixture({ skill: FM.replace("pick up", "resume") + BODY, baseline: prev() });
  assert.deepEqual(check({ root, skills: ["resume"] }).problems, []);
  rmSync(root, { recursive: true, force: true });
});

test("--check fails on an edited body, naming the skill and the exact command that re-measures it", async () => {
  const root = fixture({ skill: FM + BODY + "\nOne more rule.\n", baseline: prev() });
  const { problems } = check({ root, skills: ["resume"] });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].skill, "resume");
  assert.match(problems[0].message, /node evals\/run\.mjs resume --split test --record/);
  assert.equal(await main(["--check"], deps(root)), 1);
  rmSync(root, { recursive: true, force: true });
});

test("--check fails on a skill in SKILLS with no baseline at all", async () => {
  const root = fixture();
  const { problems } = check({ root, skills: ["resume"] });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /no baseline/);
  assert.match(problems[0].message, /node evals\/run\.mjs resume --split test --record/);
  assert.equal(await main(["--check"], deps(root)), 1);
  rmSync(root, { recursive: true, force: true });
});

// ── running tasks ─────────────────────────────────────────────────────────────────────────────────

test("the skill BODY — not its frontmatter — is the system prompt, and the task prompt is the user message", async () => {
  const root = fixture({ skill: (FM + BODY).replace(/\n/g, "\r\n") });
  const seen = [];
  await main(["resume"], deps(root, async (m) => { seen.push(m); return right(truthOf(m.user)); }));
  assert.equal(seen.length, TASKS.length);
  for (const m of seen) assert.equal(m.system, BODY);
  assert.deepEqual(seen.map((m) => m.user).sort(), TASKS.map((t) => t.prompt).sort());
  rmSync(root, { recursive: true, force: true });
});

test("a failed model call scores 0 with its reason, and the other tasks still run", async () => {
  const call = async ({ user }) => {
    if (user === TASKS[1].prompt) throw new Error("claude exited 1: overloaded");
    return right(truthOf(user));
  };
  const results = await runTasks({ tasks: TASKS, system: BODY, call, concurrency: 2 });
  assert.equal(results.length, TASKS.length);
  assert.deepEqual(results.map((r) => r.id), TASKS.map((t) => t.id), "results keep task order");
  const failed = results.find((r) => r.id === TASKS[1].id);
  assert.equal(failed.hard, 0);
  assert.equal(failed.soft, 0);
  assert.equal(failed.failed, true);
  assert.match(failed.reason, /overloaded/);
  for (const r of results) if (r !== failed) assert.equal(r.hard, 1, r.id);
});

test("a call that never answers is cut off at the timeout and scores 0", async () => {
  let aborted = false;
  const call = ({ signal }) => new Promise(() => { signal.addEventListener("abort", () => { aborted = true; }); });
  const [r] = await runTasks({ tasks: TASKS.slice(0, 1), system: BODY, call, timeoutMs: 30 });
  assert.equal(r.soft, 0);
  assert.match(r.reason, /timed out/);
  assert.ok(aborted, "the timed-out call was told to stop");
});

// ── --record ──────────────────────────────────────────────────────────────────────────────────────

test("judgeRecord: a drop of exactly 0.1 is accepted, anything more is refused", () => {
  assert.equal(judgeRecord({ split: "test", soft: 0.9 }, { split: "test", soft: 0.8 }).ok, true);
  assert.equal(judgeRecord({ split: "test", soft: 0.9 }, { split: "test", soft: 0.79 }).ok, false);
  assert.equal(judgeRecord(null, { split: "test", soft: 0 }).ok, true, "a first baseline has nothing to fall from");
  assert.equal(judgeRecord({ split: "test", soft: 0.9 }, { split: "test", soft: 0.5 }, "rewrote §2 on purpose").ok, true);
});

// #472: with no skill at all, /resume kept 0.944 soft but fell 0.21 hard. Soft alone would have let
// the skill be deleted; hard counts whole tasks, and a skill that gets every task nearly right is the
// shape soft cannot see.
test("judgeRecord: a hard drop of more than 0.2 is refused even when soft held", () => {
  const prev = { split: "test", soft: 1, hard: 1 };
  assert.equal(judgeRecord(prev, { split: "test", soft: 0.95, hard: 0.8 }).ok, true, "exactly 0.2 is accepted");
  const v = judgeRecord(prev, { split: "test", soft: 0.95, hard: 0.7857 });
  assert.equal(v.ok, false);
  assert.match(v.message, /hard fell 0\.2143, more than 0\.2/);
  assert.doesNotMatch(v.message, /soft fell/, "soft held, so only hard is named");
  assert.equal(judgeRecord(prev, { split: "test", soft: 0.95, hard: 0.5 }, "tasks made harder").ok, true, "--accept-drop covers a hard drop too");
});

test("judgeRecord: both drops are named when both fell", () => {
  const v = judgeRecord({ split: "test", soft: 1, hard: 1 }, { split: "test", soft: 0.6, hard: 0.1 });
  assert.equal(v.ok, false);
  assert.match(v.message, /soft fell 0\.4.*and hard fell 0\.9/);
});

test("judgeRecord: a baseline recorded without a hard score is judged on soft alone", () => {
  assert.equal(judgeRecord({ split: "test", soft: 1 }, { split: "test", soft: 0.95, hard: 0 }).ok, true);
});

test("--record refuses a hard drop and leaves the baseline untouched", async () => {
  // Every task nearly right: one field wrong in each, so soft stays at 2/3 of full marks while hard is 0.
  const root = fixture({ baseline: prev({ soft: 0.7, hard: 1 }) });
  const before = readFileSync(baselinePath(root));
  const call = async ({ user }) => { const t = truthOf(user); return `UNCOMMITTED: ${t.uncommitted}\nHIDDEN: ${t.hidden.join(", ") || "none"}\nROUTE: /nowhere`; };
  const errors = [];
  assert.equal(await main(["resume", "--record"], deps(root, call, { error: (m) => errors.push(m) })), 1);
  assert.deepEqual(readFileSync(baselinePath(root)), before);
  assert.match(errors.join("\n"), /hard fell 1/);
  rmSync(root, { recursive: true, force: true });
});

test("--record writes a first baseline with the body hash, the scores and the model", async () => {
  const root = fixture();
  const call = async ({ user }) => ({ text: right(truthOf(user)), model: "claude-test-model" });
  assert.equal(await main(["resume", "--record"], deps(root, call)), 0);
  const b = JSON.parse(readFileSync(baselinePath(root), "utf8"));
  assert.equal(b.skill, "resume");
  assert.equal(b.bodySha256, bodySha256(FM + BODY));
  assert.equal(b.split, "test");
  assert.equal(b.n, TASKS.length);
  assert.equal(b.hard, 1);
  assert.equal(b.soft, 1);
  assert.equal(b.model, "claude-test-model");
  assert.ok(!Number.isNaN(Date.parse(b.recordedAt)));
  assert.equal(b.note, undefined);
  rmSync(root, { recursive: true, force: true });
});

test("--record refuses a soft drop of more than 0.1 and leaves the baseline byte-for-byte untouched", async () => {
  const root = fixture({ baseline: prev() });
  const before = readFileSync(baselinePath(root));
  const call = async () => "I am not sure.\nROUTE: /dream";
  const errors = [];
  assert.equal(await main(["resume", "--record"], deps(root, call, { error: (m) => errors.push(m) })), 1);
  assert.deepEqual(readFileSync(baselinePath(root)), before);
  assert.match(errors.join("\n"), /--accept-drop/);
  rmSync(root, { recursive: true, force: true });
});

test("--record --accept-drop records the drop and keeps the reason as the note", async () => {
  const root = fixture({ baseline: prev() });
  const call = async () => "ROUTE: /dream";
  assert.equal(await main(["resume", "--record", "--accept-drop", "traded recall for a shorter skill"], deps(root, call)), 0);
  const b = JSON.parse(readFileSync(baselinePath(root), "utf8"));
  assert.ok(b.soft < 0.9);
  assert.equal(b.note, "traded recall for a shorter skill");
  rmSync(root, { recursive: true, force: true });
});

test("--record refuses when a model call failed — an outage is not a measurement", async () => {
  const root = fixture();
  const call = async ({ user }) => { if (user === TASKS[0].prompt) throw new Error("rate limited"); return right(truthOf(user)); };
  assert.equal(await main(["resume", "--record"], deps(root, call)), 1);
  assert.equal(existsSync(baselinePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});

test("a run without --record prints scores and writes no baseline", async () => {
  const root = fixture();
  const lines = [];
  const call = async ({ user }) => right(truthOf(user));
  assert.equal(await main(["resume"], deps(root, call, { log: (m) => lines.push(m) })), 0);
  assert.equal(existsSync(baselinePath(root)), false);
  assert.match(lines.join("\n"), /mean\s+hard 1\.000\s+soft 1\.000/);
  rmSync(root, { recursive: true, force: true });
});

test("--accept-drop without a reason is a usage error, not a silent acceptance", async () => {
  const root = fixture({ baseline: prev() });
  assert.equal(await main(["resume", "--record", "--accept-drop"], deps(root, async () => "")), 2);
  rmSync(root, { recursive: true, force: true });
});

// ── a body that is not skills/<name>/SKILL.md (#498) ───────────────────────────────────────────────
// The team playbook is a template stamped into a user's CLAUDE.md, and its text decides whether the
// session asks before working. It is measured like a skill: `files` points the skill at the file, and
// the alarm must follow that file — a check that kept reading skills/<name>/SKILL.md would pass while
// the template it claims to guard changed underneath it.

const PLAYBOOK_AT = "templates/team/playbook.md";
function templateFixture(body, { baseline } = {}) {
  const root = fixture({ baseline });
  rmSync(join(root, "skills"), { recursive: true, force: true });
  mkdirSync(join(root, "templates", "team"), { recursive: true });
  writeFileSync(join(root, PLAYBOOK_AT), body);
  return root;
}
const files = { resume: PLAYBOOK_AT };

test("a skill registered at another path is hashed, checked and run from that file", async () => {
  const body = "## Working as a team\n\nAsk first.\n";
  const root = templateFixture(body, { baseline: prev({ bodySha256: bodySha256(body) }) });
  assert.deepEqual(check({ root, skills: ["resume"], files }).problems, []);
  writeFileSync(join(root, PLAYBOOK_AT), body.replace("Ask", "Never ask"));
  const [problem] = check({ root, skills: ["resume"], files }).problems;
  assert.match(problem.message, /templates\/team\/playbook\.md changed since its baseline/);
  let seen;
  const call = async ({ system, user }) => { seen = system; return right(truthOf(user)); };
  assert.equal(await main(["resume"], deps(root, call, { files })), 0);
  assert.equal(seen, "## Working as a team\n\nNever ask first.\n");
  rmSync(root, { recursive: true, force: true });
});

test("a skill may shape its system prompt from the body (a template's placeholders), and the hash stays on the file", async () => {
  const body = "Agents: {{ROSTER}}.\n";
  const root = templateFixture(body);
  let seen;
  const call = async ({ system, user }) => { seen = system; return right(truthOf(user)); };
  const system = (b) => b.replace("{{ROSTER}}", "`architect`");
  assert.equal(await main(["resume", "--record"], deps(root, call, { files, systemFor: { resume: system } })), 0);
  assert.equal(seen, "Agents: `architect`.\n");
  assert.equal(JSON.parse(readFileSync(baselinePath(root), "utf8")).bodySha256, bodySha256(body));
  rmSync(root, { recursive: true, force: true });
});

test("--no-skill runs the same tasks with a one-line generic system prompt, and never records", async () => {
  const root = fixture();
  const systems = new Set();
  const call = async ({ system, user }) => { systems.add(system); return right(truthOf(user)); };
  const lines = [];
  assert.equal(await main(["resume", "--no-skill"], deps(root, call, { log: (m) => lines.push(m) })), 0);
  assert.deepEqual([...systems], [NO_SKILL_SYSTEM]);
  assert.ok(!NO_SKILL_SYSTEM.includes("\n"), "one line");
  assert.match(lines.join("\n"), /no skill/);
  const errors = [];
  assert.equal(await main(["resume", "--no-skill", "--record"], deps(root, call, { error: (m) => errors.push(m) })), 2);
  assert.match(errors.join("\n"), /a control is never recorded/);
  assert.equal(existsSync(baselinePath(root)), false);
  rmSync(root, { recursive: true, force: true });
});
