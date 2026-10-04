// team.test.mjs — what /cortex offers of the agent team, and with which values (plan step 14).
//
// Spec T4, T6 and T9 (docs/specs/2026-09-28-agent-team-design.md): every role is offered and the
// developer picks each one; the Project manager only where there is something to manage; a role an
// existing agent covers is never offered again; the verifier is offered the upgrade to the
// Reviewer, and declining keeps it — and keeps the Reviewer covered. Every value a template needs is
// detected or asked for, never invented.
//
// Fixtures are real directories (the plan folders, CLAUDE.md and the stamp record are disk facts)
// with a literal index, so each test states exactly which files the index saw.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { teamState, teamValues, testLocations, TEAM_STAMPS, PLAYBOOK_HEADING } from "../lib/team.mjs";
import { ROLES } from "../lib/agents.mjs";
import { recordStamp, writeStamps } from "../lib/stamps.mjs";
import { renderTemplate } from "../lib/placeholders.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const VERIFIER = ".claude/agents/verifier.md";

/** A repo on disk holding `files`, and a literal index listing them. */
function world(files = {}) {
  const root = tempDir("cortex-team-state-");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  const paths = Object.keys(files).filter((p) => !p.endsWith("/"));
  const index = {
    files: paths.map((path) => ({
      path,
      category: /\.(m?js|ts|py|go|java)$/.test(path) ? "code" : path.endsWith(".md") ? "docs" : "config",
      isTest: /(^|\/)(tests?|__tests__)\/|\.test\.|_test\./.test(path),
    })),
    stats: { files: paths.length },
  };
  return { root, index };
}

const state = (files, opts = {}) => {
  const w = world(files);
  return { ...w, s: teamState(w.root, w.index, { testCmd: "npm test", verifierPath: VERIFIER, ...opts }) };
};
const offered = (s) => s.offer.map((o) => o.role);
const verifierText = renderTemplate(readFileSync(join(REPO, "templates/loop/verifier.md"), "utf8"), { RUN: "npm run dev" });
const agentFile = (name, description, extra = "") => `---\nname: ${name}\ndescription: ${description}\n${extra}---\nYou help.\n`;

// --- what is offered ------------------------------------------------------------------------------

test("no index is an unanswered question, never an offer", () => {
  assert.equal(teamState(tempDir("cortex-team-none-"), null, { testCmd: "npm test", verifierPath: VERIFIER }), null);
});

test("a repo with no agents is offered the four core roles; the Project manager waits for a plan folder (T4)", () => {
  const { s } = state({ "src/a.js": "x\n" });
  assert.deepEqual(offered(s), ["architect", "implementer", "tester", "reviewer"]);
  const pm = s.withheld.find((w) => w.role === "project-manager");
  assert.ok(pm, "the withheld role is named, never silently dropped");
  assert.match(pm.why, /intent\/.*docs\/specs\/.*docs\/plans\//);
});

test("with a plan folder the Project manager is offered, and PLAN_DIRS names each folder that exists", () => {
  const { s } = state({ "src/a.js": "x\n", "docs/plans/p.md": "x\n", "intent/README.md": "x\n" });
  assert.ok(offered(s).includes("project-manager"));
  assert.equal(s.values.PLAN_DIRS, "`intent/`, `docs/plans/`");
});

test("a role an existing agent covers is never offered again (T6), and says which agent covers it", () => {
  const { s } = state({
    "src/a.js": "x\n",
    ".claude/agents/code-reviewer.md": agentFile("code-reviewer", "Reviews the diff. Use once a change is done.", "tools: Read, Grep\n"),
    ".claude/agents/review/security.md": agentFile("security-reviewer", "Reviews for vulnerabilities."),
  });
  assert.deepEqual(offered(s), ["architect", "implementer", "tester"]);
  const w = s.withheld.find((x) => x.role === "reviewer");
  assert.match(w.why, /code-reviewer/);
  assert.deepEqual(s.covered.reviewer.map((a) => a.path), [".claude/agents/code-reviewer.md"]);
  // A subfolder is scanned: Claude Code loads .claude/agents/ recursively.
  assert.ok(s.unmapped.some((a) => a.path === ".claude/agents/review/security.md"), "the nested lens agent is listed, as unmapped");
});

test("the verifier /cortex stamped is offered the upgrade to the Reviewer, and keeps the role covered (T9)", () => {
  const { s } = state({ "src/a.js": "x\n", [VERIFIER]: verifierText });
  assert.ok(!offered(s).includes("reviewer"), "no second reviewer beside it");
  assert.equal(s.upgrade?.path, VERIFIER);
  assert.equal(s.upgrade?.template, "team/reviewer.md");
  assert.deepEqual(s.covered.reviewer.map((a) => a.path), [VERIFIER]);
  // Its own proposals are the upgrade; they are not offered separately.
  assert.ok(!s.proposals.some((p) => p.path === VERIFIER));
});

test("existing agents' proposals are carried per agent, for the per-agent question", () => {
  const { s } = state({
    "src/a.js": "x\n",
    ".claude/agents/reviewer.md": agentFile("reviewer", "Performs structured code review."),
  });
  const p = s.proposals.find((x) => x.path === ".claude/agents/reviewer.md");
  assert.ok(p, "the agent with provable edits is listed");
  assert.equal(p.role, "reviewer");
  assert.ok(p.proposals.some((q) => q.kind === "tools-can-edit"));
  assert.ok(p.proposals.every((q) => Number.isInteger(q.line) && typeof q.text === "string"));
});

test("the developer's answer outranks the mapper: a rejected mapping frees the role, an assigned one covers it", () => {
  const files = {
    "src/a.js": "x\n",
    ".claude/agents/code-reviewer.md": agentFile("code-reviewer", "Reviews the diff.", "tools: Read, Grep\n"),
    ".claude/agents/helper.md": agentFile("helper", "Plans the change, then implements it."),
  };
  const { s } = state(files, { as: { ".claude/agents/code-reviewer.md": null, ".claude/agents/helper.md": "architect" } });
  assert.ok(offered(s).includes("reviewer"), "the developer said code-reviewer is not the reviewer");
  assert.ok(!offered(s).includes("architect"), "and that helper is the architect");
  assert.deepEqual(s.covered.architect.map((a) => a.path), [".claude/agents/helper.md"]);
  assert.throws(() => state(files, { as: { ".claude/agents/helper.md": "boss" } }), /not a role/);
  assert.throws(() => state(files, { as: { ".claude/agents/nope.md": "tester" } }), /no agent/);
});

test("a repo whose CLAUDE.md already carries the playbook has a team", () => {
  assert.equal(state({ "src/a.js": "x\n" }).s.playbook, false);
  const { s } = state({ "src/a.js": "x\n", "CLAUDE.md": `@AGENTS.md\n\n## ${PLAYBOOK_HEADING}\n\nThis repo has…\n` });
  assert.equal(s.playbook, true);
});

// --- the values ------------------------------------------------------------------------------------

test("values are detected from the repo, and what is not detected is a question — never invented", () => {
  const { s } = state({ "src/a.js": "x\n", "src/billing/AGENTS.md": "# b\n", "docs/adr/0001-x.md": "# x\n" }, { testCmd: null });
  assert.equal(s.values.TEST_CMD, null);
  assert.equal(s.values.RUN, null, "no stamp record, so the verifier's run command is unknown");
  assert.equal(s.values.ADR_DIR, "docs/adr/");
  assert.equal(s.values.SCOPED_BRIEFS, "   - `src/billing/AGENTS.md`");
  assert.equal(s.values.TEST_PATHS, null, "the index marks no test");
  const needs = Object.fromEntries(s.offer.map((o) => [o.role, o.needs.map((n) => n.placeholder)]));
  assert.deepEqual(needs.implementer, ["TEST_CMD"]);
  assert.deepEqual(needs.reviewer.sort(), ["RUN", "TEST_CMD"]);
  assert.deepEqual(needs.tester.sort(), ["TEST_CMD", "TEST_GLOBS", "TEST_PATHS"]);
  assert.deepEqual(needs.architect, [], "the ADR directory and the briefs are always answered");
  for (const o of s.offer) for (const n of o.needs) assert.ok(n.question.length > 20, `${o.role}: ${n.placeholder} has no question`);
});

test("the Reviewer's run command is the one the verifier was stamped with", () => {
  const w = world({ "src/a.js": "x\n", [VERIFIER]: verifierText });
  const tpl = readFileSync(join(REPO, "templates/loop/verifier.md"), "utf8");
  writeStamps(w.root, recordStamp(null, { path: VERIFIER, template: "loop/verifier.md", version: "2.40.0", templateText: tpl, fileText: verifierText, values: { RUN: "npm run dev" } }));
  const s = teamState(w.root, w.index, { testCmd: "npm test", verifierPath: VERIFIER });
  assert.equal(s.values.RUN, "npm run dev");
});

test("a damaged stamp record costs the run command, never the offer", () => {
  const w = world({ "src/a.js": "x\n", ".cortex/stamps.json": "{ not json" });
  const s = teamState(w.root, w.index, { testCmd: "npm test", verifierPath: VERIFIER });
  assert.equal(s.values.RUN, null);
  assert.ok(offered(s).length > 0);
});

test("test locations: a test directory is one glob for the whole tree, a name pattern covers the rest", () => {
  const index = (paths) => ({ files: paths.map((path) => ({ path, isTest: true })) });
  const t = testLocations(index(["test/a.test.js", "src/__tests__/b.ts", "pkg/x/y_test.go", "lib/c.test.ts", "lib/d.test.ts"]));
  assert.deepEqual(t.globs, ['"*/__tests__/*"', '"*/test/*"', '"*.test.ts"', '"*_test.go"']);
  assert.equal(t.paths, "`**/__tests__/**`, `**/test/**`, `**/*.test.ts`, `**/*_test.go`");
  assert.equal(testLocations(index([])), null);
  assert.equal(testLocations({ files: [{ path: "src/a.js", isTest: false }] }), null);
  // Every glob matches the test files it came from, in the form the hook tests them: "/" + path.
  const shellMatch = (glob, path) => new RegExp("^" + glob.slice(1, -1).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(path);
  for (const p of ["test/a.test.js", "src/__tests__/b.ts", "pkg/x/y_test.go", "lib/c.test.ts"]) {
    assert.ok(t.globs.some((g) => shellMatch(g, `/${p}`)), `${p} matches no glob`);
  }
  assert.ok(!t.globs.some((g) => shellMatch(g, "/src/app.ts")), "and no glob matches the code");
  // The fence is named like a shell test and the index marks it one; nothing under .claude/ is a
  // place the Tester may write, so it never adds a glob (the first real team stamp, step 15).
  assert.deepEqual(testLocations(index(["test/a.test.js", ".claude/hooks/test-paths.sh"])).globs, ['"*/test/*"']);
  assert.equal(testLocations(index([".claude/hooks/test-paths.sh"])), null);
});

test("TEST_GLOBS renders as the hook's list: one quoted glob per line, indented two spaces", () => {
  const { s } = state({ "src/a.js": "x\n", "test/a.test.js": "x\n" });
  assert.equal(s.values.TEST_GLOBS, '  "*/test/*"');
  assert.equal(s.values.TEST_PATHS, "`**/test/**`");
});

// --- after the picks: the files, the values, the roster ---------------------------------------------

test("picking roles gives each file with its template, the Tester's fence with the Tester, and the roster", () => {
  const { s } = state({ "src/a.js": "x\n", "test/a.test.js": "x\n", "docs/plans/p.md": "x\n" });
  const t = teamValues(s, ["tester", "reviewer"]);
  assert.deepEqual(t.files.map((f) => `${f.template} → ${f.path}${f.mode === "append" ? " (appended)" : ""}`), [
    "team/tester.md → .claude/agents/tester.md",
    "team/test-paths.sh → .claude/hooks/test-paths.sh",
    "team/reviewer.md → .claude/agents/reviewer.md",
    "team/team-skill.md → .claude/skills/team/SKILL.md",
    "team/playbook.md → CLAUDE.md (appended)",
  ]);
  assert.equal(t.values.ROSTER, "`tester`, `reviewer`");
  assert.ok(t.files.find((f) => f.path === ".claude/hooks/test-paths.sh").executable);
  assert.equal(t.files.find((f) => f.mode === "append").recorded, false, "the playbook is a block in a shared file");
  assert.ok(t.files.filter((f) => f.mode === "write").every((f) => f.recorded), "every whole file is recorded");
  assert.deepEqual(t.needs.map((n) => n.placeholder).sort(), ["RUN"], "only what was not detected is asked");
});

test("the roster names stamped roles by role, and existing agents as `name` (role)", () => {
  const { s } = state({
    "src/a.js": "x\n",
    ".claude/agents/code-reviewer.md": agentFile("code-reviewer", "Reviews the diff.", "tools: Read, Grep\n"),
    ".claude/agents/storyteller.md": agentFile("storyteller", "Explains code."),
  });
  assert.equal(teamValues(s, ["architect"]).values.ROSTER, "`architect`, `code-reviewer` (reviewer)");
  // With nothing picked, the existing agents are the team: the playbook is still offered.
  const none = teamValues(s, []);
  assert.equal(none.values.ROSTER, "`code-reviewer` (reviewer)");
  assert.ok(none.files.some((f) => f.template === "team/playbook.md"));
});

test("no agent on the team means no playbook and no team skill", () => {
  const { s } = state({ "src/a.js": "x\n" });
  const t = teamValues(s, []);
  assert.deepEqual(t.files, []);
  assert.equal(t.values.ROSTER, undefined);
});

test("accepting the upgrade replaces the verifier; declining keeps it on the roster as the reviewer", () => {
  const { s } = state({ "src/a.js": "x\n", [VERIFIER]: verifierText });
  const up = teamValues(s, ["reviewer"]);
  assert.equal(up.upgrade?.remove, VERIFIER, "the verifier file goes, and its record entry with it");
  assert.equal(up.values.ROSTER, "`reviewer`");
  const kept = teamValues(s, ["architect"]);
  assert.equal(kept.upgrade, null);
  assert.equal(kept.values.ROSTER, "`architect`, `verifier` (reviewer)");
});

test("a covered role, a withheld Project manager or an unknown role cannot be picked", () => {
  const { s } = state({ "src/a.js": "x\n", ".claude/agents/code-reviewer.md": agentFile("code-reviewer", "Reviews the diff.", "tools: Read, Grep\n") });
  assert.throws(() => teamValues(s, ["reviewer"]), /covered by `code-reviewer`/);
  assert.throws(() => teamValues(s, ["project-manager"]), /plan folder/);
  assert.throws(() => teamValues(s, ["boss"]), /not a role/);
});

test("a role whose file or name is taken is withheld, never written over (the developer freed it with `as`)", () => {
  // The developer says the team's own `reviewer.md` is not the reviewer: the role is free, the file is not.
  const files = { "src/a.js": "x\n", ".claude/agents/reviewer.md": agentFile("reviewer", "Performs structured code review.") };
  const { s } = state(files, { as: { ".claude/agents/reviewer.md": null } });
  assert.ok(!offered(s).includes("reviewer"), "offering it would overwrite their reviewer.md");
  assert.match(s.withheld.find((w) => w.role === "reviewer").why, /`reviewer` \(\.claude\/agents\/reviewer\.md\) already takes the name.*rename it first/);
  assert.throws(() => teamValues(s, ["reviewer"]), /already takes the name/);
  // The name alone collides too: Claude Code loads one of two agents called `tester`.
  const named = state({ "src/a.js": "x\n", ".claude/agents/qa/checks.md": agentFile("tester", "Explains code.") }, { as: { ".claude/agents/qa/checks.md": null } }).s;
  assert.match(named.withheld.find((w) => w.role === "tester").why, /`tester` \(\.claude\/agents\/qa\/checks\.md\)/);
  // And a file the index never saw (gitignored) is still a file on disk.
  const w = world({ "src/a.js": "x\n" });
  mkdirSync(join(w.root, ".claude", "agents"), { recursive: true });
  writeFileSync(join(w.root, ".claude", "agents", "architect.md"), "their notes\n");
  const hidden = teamState(w.root, w.index, { testCmd: "npm test", verifierPath: VERIFIER });
  assert.ok(!offered(hidden).includes("architect"));
  assert.match(hidden.withheld.find((w) => w.role === "architect").why, /\.claude\/agents\/architect\.md is already here/);
});

test("the upgrade waits while another agent holds the Reviewer's file or name; the verifier keeps the role", () => {
  const files = {
    "src/a.js": "x\n",
    [VERIFIER]: verifierText,
    ".claude/agents/reviewer.md": agentFile("reviewer", "Explains code."),
  };
  const { s } = state(files, { as: { ".claude/agents/reviewer.md": null } });
  assert.equal(s.upgrade, null, "accepting it would overwrite reviewer.md");
  assert.match(s.withheld.find((w) => w.role === "reviewer").why, /covered by `verifier`.*the upgrade waits: `reviewer`/);
  assert.throws(() => teamValues(s, ["reviewer"]), /upgrade waits/);
  assert.equal(teamValues(s, ["architect"]).values.ROSTER, "`architect`, `verifier` (reviewer)");
});

test("a team skill Cortex did not write is a conflict to ask about, never overwritten; one it recorded is kept", () => {
  const theirs = state({ "src/a.js": "x\n", ".claude/skills/team/SKILL.md": "---\nname: team\ndescription: Our standup notes.\n---\n" }).s;
  assert.equal(theirs.teamSkill, "theirs");
  const t = teamValues(theirs, ["architect"]);
  assert.ok(!t.files.some((f) => f.path === ".claude/skills/team/SKILL.md"), "their skill is never written over");
  assert.equal(t.conflicts.length, 1);
  assert.match(t.conflicts[0], /\.claude\/skills\/team\/SKILL\.md is already here and not Cortex's/);

  const skill = readFileSync(join(REPO, "templates/team/team-skill.md"), "utf8");
  const w = world({ "src/a.js": "x\n", ".claude/skills/team/SKILL.md": skill });
  writeStamps(w.root, recordStamp(null, { path: ".claude/skills/team/SKILL.md", template: "team/team-skill.md", version: "2.40.0", templateText: skill, fileText: skill }));
  const ours = teamState(w.root, w.index, { testCmd: "npm test", verifierPath: VERIFIER });
  assert.equal(ours.teamSkill, "ours");
  const o = teamValues(ours, ["architect"]);
  assert.deepEqual(o.conflicts, []);
  assert.ok(!o.files.some((f) => f.path === ".claude/skills/team/SKILL.md"), "an update is the stamp record's job, not a rewrite");
  assert.deepEqual(teamValues(state({ "src/a.js": "x\n" }).s, ["architect"]).conflicts, []);
});

test("with the playbook already in CLAUDE.md, a later pick rewrites only its roster line", () => {
  const { s } = state({ "src/a.js": "x\n", "CLAUDE.md": `@AGENTS.md\n\n## ${PLAYBOOK_HEADING}\n\nThis repo has…\n` });
  const t = teamValues(s, ["architect"]);
  assert.deepEqual(t.files.filter((f) => f.path === "CLAUDE.md").map((f) => f.mode), ["roster"], "a second block is never appended");
});

test("the verifier the developer places in another role is not offered the Reviewer's upgrade", () => {
  const { s } = state({ "src/a.js": "x\n", [VERIFIER]: verifierText }, { as: { [VERIFIER]: "tester" } });
  assert.equal(s.upgrade, null);
  assert.deepEqual(s.covered.tester.map((a) => a.path), [VERIFIER]);
  assert.ok(offered(s).includes("reviewer"));
});

test("SCOPED_BRIEFS lists the repo's scoped briefs, never the root one or a file under .claude/ or .cortex/", () => {
  const { s } = state({
    "src/a.js": "x\n",
    "AGENTS.md": "# root\n",
    "src/billing/AGENTS.md": "x\n",
    ".claude/skills/x/AGENTS.md": "x\n",
    ".cortex/memory/AGENTS.md": "x\n",
  });
  assert.equal(s.values.SCOPED_BRIEFS, "   - `src/billing/AGENTS.md`");
});

// #548, item 2. A pass that takes scoped briefs and the team stamped the Architect with the old brief
// list: the list came from the index, and the index was built before the briefs were written.
test("SCOPED_BRIEFS is read off disk, so a brief written after the index was built is on the list", () => {
  const w = world({ "src/a.js": "x\n", "src/billing/pay.js": "x\n", "src/billing/AGENTS.md": "x\n", "src/old/AGENTS.md": "x\n", "src/old/b.js": "x\n" });
  // Written by /cortex-brief in this pass; the index has never seen it.
  writeFileSync(join(w.root, "src", "AGENTS.md"), "# src\n");
  // Deleted since the index was built; the index still lists it.
  rmSync(join(w.root, "src", "old", "AGENTS.md"));
  const s = teamState(w.root, w.index, { testCmd: "npm test", verifierPath: VERIFIER });
  assert.equal(s.values.SCOPED_BRIEFS, "   - `src/AGENTS.md`\n   - `src/billing/AGENTS.md`");
});

/**
 * A repo whose `roles` Cortex stamped and recorded, as a first team pass leaves it: each file is its
 * template rendered with the values detected then, plus `answers` for what was asked.
 */
function stampedTeam(roles, { files = {}, answers = {}, opts = {} } = {}) {
  const w = world({ "src/a.js": "x\n", "src/a.test.js": "x\n", ...files });
  const options = { testCmd: "npm test", verifierPath: VERIFIER, ...opts };
  const first = teamValues(teamState(w.root, w.index, options), roles);
  const values = { ...first.values, ...answers };
  let record = null;
  for (const f of first.files.filter((x) => x.recorded)) {
    const templateText = readFileSync(join(REPO, "templates", f.template), "utf8");
    const fileText = renderTemplate(templateText, values);
    mkdirSync(join(w.root, f.path, ".."), { recursive: true });
    writeFileSync(join(w.root, f.path), fileText);
    w.index.files.push({ path: f.path, category: f.path.endsWith(".md") ? "docs" : "config", isTest: false });
    record = recordStamp(record, { path: f.path, template: f.template, version: "2.41.0", templateText, fileText, values });
  }
  writeStamps(w.root, record);
  return { ...w, options };
}
const ARCHITECT = ".claude/agents/architect.md";

test("a role Cortex stamped can be picked again, for values that changed since; it is never offered as new", () => {
  const w = stampedTeam(["architect"]);
  const quiet = teamState(w.root, w.index, w.options).stamped;
  assert.deepEqual(quiet.map((x) => [x.role, x.path, x.edited, x.changed]), [["architect", ARCHITECT, false, []]], "nothing changed, nothing to refresh");

  writeFileSync(join(w.root, "src", "AGENTS.md"), "# src\n"); // /cortex-brief, later in the same pass
  const s = teamState(w.root, w.index, w.options);
  assert.ok(!offered(s).includes("architect"), "it is still not offered as a new role");
  assert.deepEqual(s.stamped[0].changed, ["SCOPED_BRIEFS"], "the state names what went stale");
  const t = teamValues(s, ["architect"]);
  assert.deepEqual(t.files.find((f) => f.path === ARCHITECT), {
    path: ARCHITECT, template: "team/architect.md", mode: "write", recorded: true, executable: false, refresh: true,
  });
  assert.equal(t.values.SCOPED_BRIEFS, "   - `src/AGENTS.md`", "with the brief list as it is now");
  assert.deepEqual(t.conflicts, [], "an untouched file is re-rendered without a question");
  assert.ok(!t.files.some((f) => f.path === ".claude/skills/team/SKILL.md"), "the team skill is already here");
});

test("a stamped role stays on the roster by role name, picked again or not", () => {
  const w = stampedTeam(["architect", "tester"]);
  const s = teamState(w.root, w.index, w.options);
  assert.equal(teamValues(s, ["architect"]).values.ROSTER, "`architect`, `tester`", "once each: the file on disk is the same agent");
  assert.equal(teamValues(s, ["implementer"]).values.ROSTER, "`architect`, `implementer`, `tester`");
  assert.ok(teamValues(s, ["implementer"]).files.every((f) => !f.refresh), "a new role is a plain write");
  const fence = teamValues(s, ["tester"]).files.find((f) => f.path === ".claude/hooks/test-paths.sh");
  assert.equal(fence.refresh, true, "the Tester's fence is rendered again with the Tester");
});

test("rendering again over a file the team edited is a conflict to ask about", () => {
  const w = stampedTeam(["architect"]);
  appendFileSync(join(w.root, ARCHITECT), "\nAlways read the runbook first.\n");
  const s = teamState(w.root, w.index, w.options);
  assert.equal(s.stamped[0].edited, true);
  const t = teamValues(s, ["architect"]);
  assert.equal(t.conflicts.length, 1);
  assert.match(t.conflicts[0], /\.claude\/agents\/architect\.md was edited since Cortex stamped it.*replaces those edits/);
});

test("an answer given on the first pass is kept from the record, not asked again", () => {
  // No test command detected: the first pass asked, and the answer went into the record.
  const w = stampedTeam(["implementer"], { answers: { TEST_CMD: "make check" }, opts: { testCmd: null } });
  const s = teamState(w.root, w.index, w.options);
  assert.deepEqual(s.stamped[0].kept, { TEST_CMD: "make check" });
  assert.deepEqual(s.stamped[0].needs, []);
  const t = teamValues(s, ["implementer"]);
  assert.equal(t.values.TEST_CMD, "make check");
  assert.deepEqual(t.needs, []);
  // A command detected since outranks the recorded answer, and is named as changed.
  const now = teamState(w.root, w.index, { ...w.options, testCmd: "npm test" });
  assert.deepEqual(now.stamped[0].changed, ["TEST_CMD"]);
  assert.equal(teamValues(now, ["implementer"]).values.TEST_CMD, "npm test");
});

test("an agent the team wrote itself is still never picked over, record or no record", () => {
  // Same file name, no entry in the record: theirs.
  const own = state({ "src/a.js": "x\n", [ARCHITECT]: agentFile("architect", "Plans the change before code is written.") }).s;
  assert.deepEqual(own.stamped, []);
  assert.throws(() => teamValues(own, ["architect"]), /not offered here/);
  // A record entry for another template at that path is not the role's stamp either.
  const w = stampedTeam(["architect"]);
  const doc = JSON.parse(readFileSync(join(w.root, ".cortex", "stamps.json"), "utf8"));
  doc.files[ARCHITECT].template = "loop/verifier.md";
  writeFileSync(join(w.root, ".cortex", "stamps.json"), JSON.stringify(doc));
  const other = teamState(w.root, w.index, w.options);
  assert.deepEqual(other.stamped, []);
  assert.throws(() => teamValues(other, ["architect"]), /not offered here/);
});

test("the playbook's roster is never empty and every role is a real template", () => {
  for (const s of TEAM_STAMPS) assert.equal(s.adopt, false, `${s.path}: the team shipped after the record, so it is never adopted`);
  assert.deepEqual(TEAM_STAMPS.filter((s) => s.path.startsWith(".claude/agents/")).map((s) => s.template), ROLES.map((r) => `team/${r}.md`));
});

test("the team state is deterministic", () => {
  const w = world({ "src/a.js": "x\n", "test/a.test.js": "x\n", [VERIFIER]: verifierText });
  const a = teamState(w.root, w.index, { testCmd: "npm test", verifierPath: VERIFIER });
  const b = teamState(w.root, w.index, { testCmd: "npm test", verifierPath: VERIFIER });
  assert.deepEqual(a, b);
});
