// team-templates.test.mjs — the agent-team role templates are fit to stamp before anything stamps them.
//
// templates/team/ holds one Claude Code subagent per role (docs/specs/2026-09-28-agent-team-design.md).
// Nothing writes them into a repo yet — the /cortex row lands in plan step 14 — so this pins what that
// step will rely on:
//
//   - rendered with realistic values and committed at `.claude/agents/<role>.md`, every file passes
//     every claude-setup check (roadmap Q9), with a positive control proving the checker saw them;
//   - rendering is reproducible, and through the CLI /cortex will use, because stamps.json records
//     the values and re-renders from them;
//   - each role carries the tools the spec's roster table gives it and no more, and the two
//     read-only roles cannot edit;
//   - every placeholder is documented in templates/team/README.md, and nothing documented is unused;
//   - the prose the design depends on is there: the citation rule, the scoped-brief rule, the debate
//     pointer, the verifier's discipline in the Reviewer — and no fence the Tester does not have yet.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex } from "../lib/build.mjs";
import { claudeSetupFindings, readFrontmatter } from "../lib/claude-setup.mjs";
import { placeholdersOf, renderTemplate, unfilledPlaceholders } from "../lib/placeholders.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const TEAM = join(REPO, "templates", "team");
const STAMPS_CLI = join(REPO, "index", "cortex-stamps.mjs");

/** The roster, and each role's tools, as the spec's table gives them. */
const ROSTER = {
  architect: { tools: ["Read", "Grep", "Glob", "Bash"], readOnly: true },
  implementer: { tools: ["Read", "Edit", "Write", "Bash"], readOnly: false },
  tester: { tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"], readOnly: false },
  reviewer: { tools: ["Read", "Grep", "Glob", "Bash"], readOnly: true },
  "project-manager": { tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"], readOnly: false },
};
const ROLES = Object.keys(ROSTER);
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

/** Values of the shape /cortex will fill from a real repo — a TypeScript service with two briefs. */
const VALUES = {
  TEST_CMD: "npm test",
  RUN: "npm run dev",
  ADR_DIR: "docs/adr/",
  TEST_PATHS: "`test/**`, `src/**/*.test.ts`",
  PLAN_DIRS: "`intent/`, `docs/plans/`",
  SCOPED_BRIEFS: "   - `src/billing/AGENTS.md`\n   - `src/auth/AGENTS.md`",
};

const source = (role) => readFileSync(join(TEAM, `${role}.md`), "utf8");
const render = (role, values = VALUES) => renderTemplate(source(role), values);
const toolList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : String(v).split(/[,\s]+/).filter(Boolean));

/** The README's placeholder table: name → the roles it says use it. */
function documented() {
  const readme = readFileSync(join(TEAM, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const out = new Map();
  for (const line of readme.split("\n")) {
    const m = line.match(/^\|\s*`\{\{([A-Z_]+)\}\}`\s*\|([^|]*)\|/);
    if (m) out.set(m[1], [...m[2].matchAll(/`([a-z-]+)`/g)].map((x) => x[1]).sort());
  }
  return out;
}

/** Every placeholder a template uses: name → the roles using it. */
function used() {
  const out = new Map();
  for (const role of ROLES) {
    for (const token of placeholdersOf(source(role))) {
      const name = token.slice(2, -2).trim();
      out.set(name, [...(out.get(name) ?? []), role].sort());
    }
  }
  return out;
}

/** A repo shaped like one /cortex serves, with each role stamped where step 14 will put it. */
function stamp(bodies) {
  const root = tempDir("cortex-team-");
  execFileSync("git", ["init", "-q", "."], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  const put = (rel, body) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  put("package.json", JSON.stringify({ name: "demo", scripts: { test: "node --test", dev: "node src/app.js" } }, null, 2));
  put("src/app.js", "export const app = () => 1;\n");
  put("src/billing/AGENTS.md", "# billing\n");
  put("AGENTS.md", "# demo\n");
  put("CLAUDE.md", "@AGENTS.md\n");
  for (const [role, body] of Object.entries(bodies)) put(`.claude/agents/${role}.md`, body);
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "stamp"], { cwd: root });
  return root;
}

const findingsFor = (bodies) => {
  const root = stamp(bodies);
  return claudeSetupFindings(buildIndex(root), root).map((f) => `${f.kind}: ${f.evidence.join(" | ")}`);
};
const allRendered = (values = VALUES) => Object.fromEntries(ROLES.map((r) => [r, render(r, values)]));

// --- the roster ---------------------------------------------------------------------------------

test("templates/team holds exactly the five roles, and a README", () => {
  const files = readdirSync(TEAM).sort();
  assert.deepEqual(files, [...ROLES.map((r) => `${r}.md`), "README.md"].sort());
});

test("no team template is git-ignored — the repo's `team/` rule caught the whole directory once", () => {
  // .gitignore keeps a private team-brain clone out with an unanchored `team/`, which also matched
  // templates/team/. Every test here passed on the author's disk while the files would never have
  // been committed, so CI and every installed plugin would have had none of them.
  const files = readdirSync(TEAM).map((f) => `templates/team/${f}`);
  let ignored = "";
  try {
    ignored = execFileSync("git", ["check-ignore", "--no-index", ...files], { cwd: REPO, encoding: "utf8" });
  } catch (e) {
    if (e.status !== 1) throw e; // 1 is git's "nothing is ignored"
  }
  assert.equal(ignored.trim(), "", "git ignores these templates");
});

test("each role's frontmatter reads cleanly, is named for its file, and says when to call it", () => {
  for (const role of ROLES) {
    const fm = readFrontmatter(render(role));
    assert.equal(fm.state, "ok", `${role}: frontmatter is ${fm.state}`);
    assert.equal(fm.loose, false, `${role}: frontmatter has a loose line or a repeated key`);
    assert.equal(fm.data.name, role);
    assert.match(String(fm.data.description), /\bUse (?:once|when|at|after|before)\b/, `${role}: the description does not say when to call it`);
    // A plain YAML scalar may not hold ": " — Claude Code's parser would reject the whole block.
    for (const line of source(role).split(/\r?\n/).slice(1, source(role).split(/\r?\n/).indexOf("---", 1))) {
      assert.doesNotMatch(line.replace(/^[\w-]+:\s/, ""), /:\s|\s#/, `${role}: "${line}" is not a plain YAML scalar`);
    }
  }
});

test("each role carries exactly the tools the spec's roster gives it", () => {
  for (const role of ROLES) {
    const fm = readFrontmatter(source(role));
    assert.deepEqual(toolList(fm.data.tools).sort(), [...ROSTER[role].tools].sort(), `${role}: tools`);
  }
});

test("the read-only roles — Architect and Reviewer — hold no edit tool and deny every one", () => {
  for (const role of ROLES.filter((r) => ROSTER[r].readOnly)) {
    const fm = readFrontmatter(source(role));
    const tools = toolList(fm.data.tools);
    assert.ok(tools.length, `${role}: no tools line means it inherits every tool, Edit and Write included`);
    assert.deepEqual(tools.filter((t) => EDIT_TOOLS.includes(t)), [], `${role}: an edit tool is granted`);
    const denied = toolList(fm.data.disallowedTools);
    for (const t of ["Edit", "Write", "NotebookEdit"]) assert.ok(denied.includes(t), `${role}: ${t} is not in disallowedTools`);
  }
});

test("no role sets model, permissionMode or hooks yet — the Tester's hook is step 10's", () => {
  for (const role of ROLES) {
    const keys = readFrontmatter(source(role)).keys;
    assert.deepEqual(keys.filter((k) => ["model", "permissionMode", "hooks"].includes(k)), [], role);
  }
});

// --- placeholders -------------------------------------------------------------------------------

test("every placeholder a template uses is documented in the README, with the roles that use it", () => {
  assert.deepEqual([...used().entries()].sort(), [...documented().entries()].sort());
});

test("the test values fill exactly the documented placeholders", () => {
  assert.deepEqual(Object.keys(VALUES).sort(), [...documented().keys()].sort());
});

test("rendering with every value leaves no placeholder, and is the same every time", () => {
  for (const role of ROLES) {
    const once = render(role);
    assert.deepEqual(unfilledPlaceholders(source(role), VALUES), [], `${role}: a placeholder has no value`);
    assert.deepEqual(placeholdersOf(once), [], `${role}: a placeholder survived rendering`);
    assert.equal(render(role), once, `${role}: rendering is not reproducible`);
  }
});

test("the stamps CLI renders each template to the same bytes — the path /cortex and stamps.json use", () => {
  const dir = tempDir("cortex-team-values-");
  const file = join(dir, "values.json");
  writeFileSync(file, JSON.stringify(VALUES));
  for (const role of ROLES) {
    const out = execFileSync(process.execPath, [STAMPS_CLI, "render", `team/${role}.md`, "--values-file", file], { encoding: "utf8" });
    assert.equal(out, render(role), `${role}: the CLI renders differently from renderTemplate`);
  }
});

test("a repo with no scoped briefs removes the Architect's list line and nothing else", () => {
  const empty = render("architect", { ...VALUES, SCOPED_BRIEFS: "" });
  const full = render("architect");
  assert.deepEqual(placeholdersOf(empty), []);
  // The full render put two brief lines where the placeholder line was; the empty one removes it.
  assert.equal(empty.split("\n").length, full.split("\n").length - 2, "more went than the placeholder's line");
  assert.match(empty, /names its brief\.\n2\. /, "step 1 no longer runs straight into step 2");
  assert.doesNotMatch(empty, /\n\s*\n\s*\n/, "removing the list left a double blank line");
});

// --- the checker (roadmap Q9) -------------------------------------------------------------------

test("every role, rendered and stamped at .claude/agents/, passes every claude-setup check", () => {
  assert.deepEqual(findingsFor(allRendered()), [], "a team template breaks a rule it is checked against");
});

test("so does the render for a repo with no scoped briefs", () => {
  assert.deepEqual(findingsFor(allRendered({ ...VALUES, SCOPED_BRIEFS: "" })), []);
});

test("the checker does see the stamped roles — a Reviewer granted Edit is reported", () => {
  // Without this, a stamp at a path the checker never reads would pass the test above on nothing.
  const bodies = allRendered();
  bodies.reviewer = bodies.reviewer.replace(/^tools: (.*)$/m, "tools: $1, Edit").replace(/^disallowedTools: .*\n/m, "");
  const found = findingsFor(bodies);
  assert.ok(
    found.some((f) => f.startsWith("claude-setup/subagent-read-only-can-edit") && f.includes(".claude/agents/reviewer.md")),
    `expected subagent-read-only-can-edit on reviewer.md, got ${found.join("; ") || "none"}`,
  );
});

// --- the prose the design depends on ------------------------------------------------------------

const CITE = "Every claim you make about this repo cites a `path:line`, an ADR, or the output of a command you ran";
const BRIEFS = "read every `AGENTS.md` between it and the repo root";
const DEBATE = "`.claude/skills/team/SKILL.md`";

test("every role carries the shared citation rule and the scoped-brief rule, word for word", () => {
  for (const role of ROLES) {
    const body = source(role).replace(/\s*\n\s*/g, " ");
    assert.ok(body.includes(CITE), `${role}: the citation rule is missing or reworded`);
    assert.ok(body.includes(BRIEFS), `${role}: the scoped-brief rule is missing or reworded`);
  }
});

test("the three debating roles point at the team skill, and only point — two rounds, then the developer", () => {
  for (const role of ["architect", "tester", "reviewer"]) {
    const body = source(role).replace(/\s*\n\s*/g, " ");
    assert.ok(body.includes(DEBATE), `${role}: no pointer to the team skill`);
    assert.match(body, /two rounds/, `${role}: the round cap is not stated`);
    assert.match(body, /goes to the developer/, `${role}: open disagreements do not go to the developer`);
  }
  for (const role of ["implementer", "project-manager"]) assert.ok(!source(role).includes(DEBATE), `${role} does not debate`);
});

test("the Tester is told its edits stay in test files, and promised no fence that does not exist yet", () => {
  // #457 removed a promised test-file lock no template provided. The hook arrives in step 10; until
  // then the body may instruct, never claim enforcement.
  const body = source("tester");
  assert.match(body.replace(/\s*\n\s*/g, " "), /edits are limited to test files/);
  assert.doesNotMatch(body, /\bhook|\bfence|\bblock(?:s|ed)?\b|\benforc/i);
});

test("the Reviewer keeps the verifier's discipline, and the verifier stays until step 14 offers the upgrade", () => {
  const body = source("reviewer").replace(/\s*\n\s*/g, " ");
  assert.match(body, /\*\*Change nothing\.\*\*/);
  assert.match(body, /hand the discrepancy back/);
  assert.match(body, /`\{\{RUN\}\}`/, "the Reviewer runs the same command the verifier did");
  assert.ok(existsSync(join(REPO, "templates", "loop", "verifier.md")));
});

test("each role stays short — well under sixty lines", () => {
  for (const role of ROLES) {
    const n = source(role).replace(/\r\n/g, "\n").trimEnd().split("\n").length;
    assert.ok(n < 60, `${role}.md is ${n} lines`);
  }
});
