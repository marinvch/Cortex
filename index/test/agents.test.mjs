// agents.test.mjs — the agents a repo already has: listed, graded, mapped to a role, and improved.
//
// Spec T6 (docs/specs/2026-09-28-agent-team-design.md): an existing agent is graded with the
// claude-setup checks, mapped to one of the five roles, and given concrete edits — and a role it
// covers is never offered again. Every mapping rule may only DROP a candidate, so the failures
// pinned here are the two that matter: a guess where the answer is "ask", and a covered role offered
// twice.
//
// Fixtures are literal text through `read`/`exists`, except where a template has to be read off the
// disk — the roster comes from templates/team/, and one test proves each template maps to itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { repoAgents, mapRole, proposeEdits, rosterGaps, agentReport, teamRoster, ROLES } from "../lib/agents.mjs";
import { renderTemplate } from "../lib/placeholders.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const TEMPLATES = join(REPO, "templates");

/** An index over `files` ({ path: text }) and the read/exists pair every reader here accepts. */
function repo(files) {
  const paths = Object.keys(files);
  const index = { files: paths.map((path) => ({ path, category: path.endsWith(".md") ? "docs" : "code", isTest: false })) };
  const opts = { read: (p) => (p in files ? files[p] : null), exists: (p) => paths.includes(p) };
  return { index, opts };
}

const agentFile = (fm, body = "You help.\n") => `---\n${fm}\n---\n${body}`;
const VERIFIER_AT = ".claude/agents/verifier.md";

/** The one agent at `.claude/agents/x.md`, as repoAgents reads it. */
function one(fm, body, extra = {}) {
  const { index, opts } = repo({ ".claude/agents/x.md": agentFile(fm, body), ...extra });
  const list = repoAgents(null, index, opts);
  assert.equal(list.length, 1);
  return list[0];
}
const roleOf = (fm, body) => mapRole(one(fm, body));

const VALUES = {
  TEST_CMD: "npm test",
  RUN: "npm run dev",
  ADR_DIR: "docs/adr/",
  TEST_PATHS: "`test/**`",
  PLAN_DIRS: "`docs/plans/`",
  SCOPED_BRIEFS: "   - `src/billing/AGENTS.md`",
};
const rendered = (rel) => renderTemplate(readFileSync(join(TEMPLATES, rel), "utf8"), VALUES);

// --- listing and grading ---------------------------------------------------------------------------

test("repoAgents lists the repo's own .claude/agents/*.md, with the claude-setup findings for each", () => {
  const { index, opts } = repo({
    ".claude/agents/good.md": agentFile("name: good\ndescription: Reviews a diff. Use once a change is done.\ntools: Read, Grep"),
    ".claude/agents/odd.md": agentFile("name: odd\ndescription: Reviews a diff.\ncolour: red"),
    // Not this repo's team: a nested package's agents, and an agent a plugin in the repo ships.
    "packages/web/.claude/agents/nested.md": agentFile("name: nested\ndescription: x"),
    ".claude-plugin/plugin.json": "{}",
    "agents/shipped.md": agentFile("name: shipped\ndescription: x"),
  });
  const list = repoAgents(null, index, opts);
  assert.deepEqual(list.map((a) => a.path), [".claude/agents/good.md", ".claude/agents/odd.md"]);
  const [good, odd] = list;
  assert.equal(good.name, "good");
  assert.deepEqual(good.tools, ["Read", "Grep"]);
  assert.equal(good.disallowedTools, null);
  assert.deepEqual(good.findings, []);
  assert.deepEqual(odd.findings.map((f) => f.kind), ["claude-setup/subagent-unknown-key"]);
  assert.match(odd.findings[0].evidence[0], /colour/);
  assert.equal(odd.tools, null, "no tools: line is null, not an empty list — it inherits every tool");
});

test("a file with no frontmatter is listed as not loaded, and never mapped", () => {
  const { index, opts } = repo({ ".claude/agents/README.md": "# Our agents\n" });
  const [readme] = repoAgents(null, index, opts);
  assert.equal(readme.loads, false);
  const m = mapRole(readme);
  assert.equal(m.role, null);
  assert.equal(m.reason, "not-loaded");
});

test("no index is an unanswered question, never an empty roster", () => {
  assert.equal(agentReport(null, null), null);
});

// --- mapping ---------------------------------------------------------------------------------------

test("each team template, stamped where /cortex will put it, maps to its own role", () => {
  for (const role of ROLES) {
    const { index, opts } = repo({ [`.claude/agents/${role}.md`]: rendered(`team/${role}.md`) });
    const [a] = repoAgents(null, index, opts);
    const m = mapRole(a);
    assert.equal(m.role, role, `${role}: mapped to ${m.role} (${m.reason}; candidates ${m.candidates.join(", ")})`);
  }
});

test("Cortex's own verifier maps to the Reviewer and is marked for the upgrade (T9)", () => {
  const { index, opts } = repo({ ".claude/agents/verifier.md": rendered("loop/verifier.md") });
  const [a] = repoAgents(null, index, opts);
  const m = mapRole(a, { verifierPath: VERIFIER_AT });
  assert.equal(m.role, "reviewer");
  assert.equal(m.upgrade?.to, "reviewer");
  assert.equal(m.upgrade?.template, "team/reviewer.md");
  // Only at the path /cortex stamps it: a verifier elsewhere is a reviewer with no upgrade.
  const { index: i2, opts: o2 } = repo({ ".claude/agents/check.md": rendered("loop/verifier.md") });
  const m2 = mapRole(repoAgents(null, i2, o2)[0], { verifierPath: VERIFIER_AT });
  assert.equal(m2.role, "reviewer");
  assert.equal(m2.upgrade, null);
  // And only when the caller says where that is — loop.mjs owns the path.
  assert.equal(mapRole(a).upgrade, null);
});

test("agents in a subfolder of .claude/agents/ are the repo's own — Claude Code scans it recursively", () => {
  const { index, opts } = repo({
    ".claude/agents/review/code.md": agentFile("name: code-reviewer\ndescription: Reviews the diff."),
    "packages/web/.claude/agents/nested.md": agentFile("name: nested\ndescription: x"),
  });
  assert.deepEqual(repoAgents(null, index, opts).map((a) => a.path), [".claude/agents/review/code.md"]);
});

test("the developer's own mapping outranks the mapper's, and a wrong answer is refused", () => {
  const { index, opts } = repo({
    ".claude/agents/code-reviewer.md": agentFile("name: code-reviewer\ndescription: Reviews the diff."),
    ".claude/agents/helper.md": agentFile("name: helper\ndescription: Explains code."),
  });
  const r = agentReport(null, index, { ...opts, as: { ".claude/agents/code-reviewer.md": null, ".claude/agents/helper.md": "tester" } });
  assert.deepEqual(r.covered, { tester: [".claude/agents/helper.md"] });
  assert.equal(r.agents.find((a) => a.path === ".claude/agents/helper.md").mapping.reason, "developer");
  assert.throws(() => agentReport(null, index, { ...opts, as: { ".claude/agents/x.md": "tester" } }), /no agent at/);
  assert.throws(() => agentReport(null, index, { ...opts, as: { ".claude/agents/helper.md": "boss" } }), /not a role/);
});

test("the evidence names the words and the tools that decided it", () => {
  const m = roleOf("name: code-reviewer\ndescription: Reviews the diff for regressions. Use once a change is done.\ntools: Read, Grep");
  assert.equal(m.role, "reviewer");
  assert.deepEqual(m.evidence.name, ["reviewer"]);
  assert.ok(m.evidence.description.some((w) => /review/i.test(w)), m.evidence.description.join("|"));
  assert.match(m.evidence.tools.join(" "), /Read, Grep/);
});

test("an agent that matches two roles is unmapped — ask — never a guess", () => {
  const m = roleOf("name: helper\ndescription: Writes the implementation plan, then implements it.");
  assert.equal(m.role, null);
  assert.equal(m.reason, "ambiguous");
  assert.deepEqual(m.candidates.sort(), ["architect", "implementer"]);
});

test("an agent with no role words is unmapped, and says so", () => {
  const m = roleOf("name: storyteller\ndescription: Explains unfamiliar code as a narrative.");
  assert.equal(m.role, null);
  assert.equal(m.reason, "no-role-words");
  assert.deepEqual(m.candidates, []);
});

test("a negated job is not a job — 'never writes code' is not an Implementer", () => {
  const m = roleOf("name: owner\ndescription: Writes user stories and acceptance criteria. Never writes code.");
  assert.equal(m.role, "project-manager");
  assert.ok(!m.candidates.includes("implementer"));
});

test("a sequencing clause is when to call it, not what it does — 'use after implementing'", () => {
  const m = roleOf("name: second-look\ndescription: Use after implementing a feature, before writing code for the next. Reviews the diff.");
  assert.equal(m.role, "reviewer");
  assert.ok(!m.candidates.includes("implementer"));
});

test("'ready for review' is when to call it; 'reviews the diff' is the job", () => {
  assert.equal(roleOf("name: branch-prep\ndescription: Rebases the branch until it is ready for review.").role, null);
  assert.equal(roleOf("name: branch-prep\ndescription: Reviews the diff before merge.").role, "reviewer");
});

test("dialogue examples in a description are not the job — <example> blocks are dropped", () => {
  const m = roleOf(
    "name: planner\ndescription: Use this agent to plan a multi-step task. <example>user: implement the store\\nassistant: I will write code and review it</example>",
  );
  assert.equal(m.role, "architect");
  assert.deepEqual(m.candidates, ["architect"]);
});

test("a lens specialist is not the role — a security reviewer leaves the Reviewer to be offered", () => {
  for (const name of ["security-reviewer", "a11y-auditor", "ux", "wireframe-architect", "performance-reviewer"]) {
    const m = roleOf(`name: ${name}\ndescription: Reviews and audits the design.`);
    assert.equal(m.role, null, `${name} mapped to ${m.role}`);
    assert.equal(m.reason, "lens", name);
  }
});

test("an agent that cannot edit is never the Implementer or the Tester", () => {
  const coder = roleOf("name: coder\ndescription: Implements features.\ntools: Read, Grep, Bash");
  assert.equal(coder.role, null);
  assert.ok(coder.dropped.some((d) => d.role === "implementer" && /edit/i.test(d.why)));
  const denied = roleOf("name: tester\ndescription: Writes tests.\ntools: Read, Edit, Write\ndisallowedTools: Edit, Write");
  assert.equal(denied.role, null);
  const ro = roleOf("name: coder\ndescription: Implements features. Read-only: it changes nothing.");
  assert.equal(ro.role, null, "an agent whose prose says it changes nothing is not an implementer");
});

test("the name outranks a description that names the neighbouring roles", () => {
  const m = roleOf("name: tester\ndescription: Writes the failing test, then hands off so the Implementer implements the change.");
  assert.equal(m.role, "tester");
  assert.ok(m.dropped.some((d) => d.role === "implementer"));
});

test("a generic job noun defers to the role word beside it — a test engineer is a Tester", () => {
  assert.equal(roleOf("name: python-test-engineer\ndescription: Creates new tests and fixes failing ones.").role, "tester");
  assert.equal(roleOf("name: test-developer\ndescription: Keeps the suite healthy.").role, "tester");
  assert.equal(roleOf("name: be-developer\ndescription: Backend API implementation.").role, "implementer");
});

test("QA names two roles, and only the description may pick between them", () => {
  assert.equal(roleOf("name: qa\ndescription: Verifies that completed work meets the definition of done.").role, "reviewer");
  assert.equal(roleOf("name: qa\ndescription: Writes failing tests first, in RED mode.").role, "tester");
  const both = roleOf("name: qa\ndescription: Quality assurance.");
  assert.equal(both.role, null);
  assert.equal(both.reason, "ambiguous");
  assert.deepEqual(both.candidates.sort(), ["reviewer", "tester"]);
});

test("a project-manager needs a manager word with it — a context manager is not one", () => {
  assert.equal(roleOf("name: product-owner\ndescription: Turns requests into stories.").role, "project-manager");
  assert.equal(roleOf("name: pm\ndescription: Keeps the sprint board.").role, "project-manager");
  assert.equal(roleOf("name: context-manager\ndescription: Manages context across sessions.").role, null);
});

test("another agent's hyphenated name in a description is a neighbour, not the job", () => {
  // Found on a real repo: a researcher that "feeds the wireframe-architect and product-owner agents".
  const m = roleOf("name: researcher\ndescription: Synthesises research. Feeds the wireframe-architect and product-owner agents.");
  assert.equal(m.role, null);
  assert.deepEqual(m.candidates, []);
});

test("a devil's advocate asked for 'a second opinion on an approach' is not the Reviewer", () => {
  // Found on a real repo; mapping it would have marked the Reviewer covered by an agent that runs nothing.
  const m = roleOf("name: critical-thinking\ndescription: Challenges assumptions. Use when you want a second opinion on an approach.");
  assert.equal(m.role, null);
  assert.equal(roleOf("name: rubber-duck\ndescription: Independent second-opinion reviewer after complex changes.").role, "reviewer");
});

test("found on real repos: an engineer of a discipline, a debugger and an audit-trail expert are none of the five", () => {
  // `prompt-engineer` mapped to the Implementer through the generic noun; the qualifier was a discipline.
  assert.equal(roleOf("name: prompt-engineer\ndescription: Use this agent when you need to create or refine prompts.").role, null);
  // "implementing robust fixes" — a debugger is /diagnosing-bugs' job, not the Implementer's.
  const dbg = roleOf("name: systematic-debugger\ndescription: Diagnoses bugs, and excels at implementing robust fixes.");
  assert.equal(dbg.role, null);
  assert.equal(dbg.reason, "outside-roster");
  // "the audit trail", "auditing which write paths are logged" — a domain, not a review.
  assert.equal(roleOf("name: activity-logging-expert\ndescription: Use when working with the activity log (audit trail) — auditing which write paths are logged.").role, null);
});

test("a job title spelled out in the description names the project manager behind an acronym", () => {
  assert.equal(roleOf("name: tdm\ndescription: Technical Delivery Manager - orchestrates agents, manages blockers.").role, "project-manager");
});

test("mapping is deterministic — the same agent maps the same way twice", () => {
  const fm = "name: reviewer\ndescription: Reviews the diff.";
  assert.deepEqual(roleOf(fm), roleOf(fm));
});

// --- proposals -------------------------------------------------------------------------------------

const SCOPED = { "AGENTS.md": "# root\n", "CLAUDE.md": "@AGENTS.md\n", "src/billing/AGENTS.md": "# billing\n" };

function propose(fm, body, role, extra = {}) {
  const { index, opts } = repo({ ".claude/agents/x.md": agentFile(fm, body), ...extra });
  const a = repoAgents(null, index, opts).find((x) => x.path === ".claude/agents/x.md");
  return proposeEdits(a, role === undefined ? mapRole(a).role : role, agentReport(null, index, opts).grounding);
}
const kindsOf = (ps) => ps.map((p) => p.kind).sort();

test("every team template, against itself, proposes nothing", () => {
  for (const role of ROLES) {
    const { index, opts } = repo({ [`.claude/agents/${role}.md`]: rendered(`team/${role}.md`), ...SCOPED });
    const [a] = repoAgents(null, index, opts);
    assert.deepEqual(proposeEdits(a, role, agentReport(null, index, opts).grounding), [], role);
  }
});

test("a reviewer that can edit is told which line grants it, and the line that fixes it", () => {
  const ps = propose("name: reviewer\ndescription: Reviews the diff. Use once a change is done.\ntools: Read, Edit, Grep, Write", "Cite path:line.\n", "reviewer");
  const p = ps.find((x) => x.kind === "tools-can-edit");
  assert.ok(p, kindsOf(ps).join(", "));
  assert.equal(p.line, 4);
  assert.equal(p.current, "tools: Read, Edit, Grep, Write");
  assert.equal(p.text, "tools: Read, Grep");
});

test("a reviewer with no tools line inherits Edit, and gets the roster's own two lines", () => {
  const ps = propose("name: reviewer\ndescription: Reviews the diff. Use once a change is done.", "Cite path:line.\n", "reviewer");
  const p = ps.find((x) => x.kind === "tools-can-edit");
  assert.ok(p, kindsOf(ps).join(", "));
  assert.equal(p.action, "insert-before");
  assert.equal(p.line, 4, "before the closing ---");
  const roster = teamRoster().reviewer;
  assert.equal(p.text, `tools: ${roster.tools.join(", ")}\ndisallowedTools: ${roster.disallowedTools.join(", ")}`);
});

test("an implementer with no tools line is offered the roster's tools — omitted means every tool", () => {
  const ps = propose("name: dev\ndescription: Implements the plan. Use once the test is red.", "Cite path:line.\n", "implementer");
  const p = ps.find((x) => x.kind === "tools-inherit");
  assert.ok(p, kindsOf(ps).join(", "));
  assert.equal(p.text, `tools: ${teamRoster().implementer.tools.join(", ")}`);
});

test("tools outside the role's roster are named — but MCP tools and TodoWrite are the repo's own tuning", () => {
  const ps = propose("name: architect\ndescription: Plans the change. Use before a change.\ntools: Read, Grep, WebSearch, Task, TodoWrite, mcp__db__query", "Cite path:line.\n", "architect");
  const p = ps.find((x) => x.kind === "tools-beyond-roster");
  assert.ok(p, kindsOf(ps).join(", "));
  assert.deepEqual(p.tools, ["Task", "WebSearch"]);
  assert.equal(p.text, "tools: Read, Grep, TodoWrite, mcp__db__query");
});

test("a description that never says when to call it gets the role template's own 'Use …' sentence", () => {
  const ps = propose("name: reviewer\ndescription: Performs structured code review.\ntools: Read, Grep", "Cite path:line.\n", "reviewer");
  const p = ps.find((x) => x.kind === "description-when");
  assert.ok(p, kindsOf(ps).join(", "));
  assert.equal(p.line, 3);
  assert.equal(p.text, teamRoster().reviewer.when);
  assert.match(p.text, /^Use /);
  // Any of the usual shapes counts as saying when — only an absence is proposed.
  for (const d of ["Use PROACTIVELY for reviews.", "Use this agent when a PR is open.", "Invoked by the orchestrator after planning.", "MUST BE USED before merge.", "Reviews code; runs before DISCOVER."]) {
    const q = propose(`name: reviewer\ndescription: ${d}\ntools: Read, Grep`, "Cite path:line.\n", "reviewer");
    assert.ok(!q.some((x) => x.kind === "description-when"), d);
  }
});

test("no citation rule is proposed as the template's sentence, appended at the end", () => {
  const body = "You review.\n\nBe thorough.\n";
  const ps = propose("name: reviewer\ndescription: Reviews the diff. Use once done.\ntools: Read, Grep", body, "reviewer");
  const p = ps.find((x) => x.kind === "citation-rule");
  assert.ok(p, kindsOf(ps).join(", "));
  assert.equal(p.action, "append");
  assert.equal(p.line, 8, "after the last non-empty line");
  assert.equal(p.text, teamRoster().reviewer.citation);
  assert.match(p.text, /^Every claim you make about this repo cites/);
  for (const has of ["Cite a path:line for every finding.", "Every finding carries `src/a.ts:12`.", "Quote file:line."]) {
    const q = propose("name: reviewer\ndescription: Reviews. Use once done.\ntools: Read, Grep", has, "reviewer");
    assert.ok(!q.some((x) => x.kind === "citation-rule"), has);
  }
});

test("the AGENTS.md grounding line is proposed only where a brief exists that the agent would not load", () => {
  const fm = "name: reviewer\ndescription: Reviews the diff. Use once done.\ntools: Read, Grep";
  const body = "Cite path:line.\n";
  // A scoped brief is never loaded on its own, so an agent that does not read it misses its rules.
  const withScoped = propose(fm, body, "reviewer", SCOPED);
  const p = withScoped.find((x) => x.kind === "grounding-agents-md");
  assert.ok(p, kindsOf(withScoped).join(", "));
  assert.equal(p.text, teamRoster().reviewer.grounding);
  assert.match(p.why, /src\/billing\/AGENTS\.md/);
  // No AGENTS.md at all: nothing to ground in.
  assert.ok(!propose(fm, body, "reviewer").some((x) => x.kind === "grounding-agents-md"));
  // A root AGENTS.md that CLAUDE.md imports is already loaded into every subagent.
  assert.ok(!propose(fm, body, "reviewer", { "AGENTS.md": "# r\n", "CLAUDE.md": "@AGENTS.md\n" }).some((x) => x.kind === "grounding-agents-md"));
  // CLAUDE.md as a symlink to AGENTS.md: stored as a one-line file without symlink support, read as
  // the same text with it. Both load the root brief.
  assert.ok(!propose(fm, body, "reviewer", { "AGENTS.md": "# r\n", "CLAUDE.md": "AGENTS.md" }).some((x) => x.kind === "grounding-agents-md"));
  assert.ok(!propose(fm, body, "reviewer", { "AGENTS.md": "# r\n", "CLAUDE.md": "# r\n" }).some((x) => x.kind === "grounding-agents-md"));
  // A root AGENTS.md nothing imports is not loaded.
  assert.ok(propose(fm, body, "reviewer", { "AGENTS.md": "# r\n" }).some((x) => x.kind === "grounding-agents-md"));
  // An agent that already reads the briefs is left alone.
  assert.ok(!propose(fm, "Read every AGENTS.md on the way. Cite path:line.\n", "reviewer", SCOPED).some((x) => x.kind === "grounding-agents-md"));
});

test("an unmapped agent gets no proposals — there is no role to hold it to", () => {
  assert.deepEqual(propose("name: storyteller\ndescription: Explains code.", "Hi.\n", null), []);
});

// --- the roster ------------------------------------------------------------------------------------

test("rosterGaps: a covered role is never offered again, and an unmapped agent covers nothing", () => {
  assert.deepEqual(rosterGaps([]), ROLES);
  assert.deepEqual(rosterGaps([{ role: "reviewer" }, { role: null }, { role: "tester" }, { role: "reviewer" }]), ["architect", "implementer", "project-manager"]);
  assert.deepEqual(rosterGaps(ROLES.map((role) => ({ role }))), []);
});

test("agentReport puts it together: each agent graded, mapped and proposed; the gaps; the covered roles", () => {
  const { index, opts } = repo({
    ".claude/agents/verifier.md": rendered("loop/verifier.md"),
    ".claude/agents/security-reviewer.md": agentFile("name: security-reviewer\ndescription: Reviews for vulnerabilities."),
    ...SCOPED,
  });
  const r = agentReport(null, index, opts);
  assert.deepEqual(r.agents.map((a) => [a.path, a.mapping.role]), [
    [".claude/agents/security-reviewer.md", null],
    [".claude/agents/verifier.md", "reviewer"],
  ]);
  assert.deepEqual(r.covered, { reviewer: [".claude/agents/verifier.md"] });
  assert.deepEqual(r.gaps, ["architect", "implementer", "tester", "project-manager"]);
  assert.deepEqual(r.unmapped, [".claude/agents/security-reviewer.md"]);
  assert.deepEqual(r.agents[0].proposals, [], "an unmapped agent is asked about, not edited");
  assert.ok(r.agents[1].proposals.some((p) => p.kind === "citation-rule"), "the verifier has no citation rule");
  assert.deepEqual(agentReport(null, index, opts), r, "deterministic");
});

test("the roster is read from templates/team — the tools table has one home", () => {
  const roster = teamRoster();
  assert.deepEqual(Object.keys(roster), ROLES);
  assert.deepEqual(roster.architect.tools, ["Read", "Grep", "Glob", "Bash"]);
  assert.equal(roster.architect.canEdit, false);
  assert.equal(roster.implementer.canEdit, true);
  for (const role of ROLES) {
    assert.match(roster[role].when, /^Use /, role);
    assert.match(roster[role].citation, /^Every claim you make about this repo cites/, role);
    assert.match(roster[role].grounding, /AGENTS\.md/, role);
  }
});
