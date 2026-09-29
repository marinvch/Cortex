// team.mjs — what /cortex offers of the agent team, and the values each file is rendered with.
//
// Plan step 14 (docs/specs/2026-09-28-agent-team-design.md, T4, T6, T9). `agents.mjs` answers which
// roles the repo's own agents already play; this module turns that into the offer:
//
//   - **Every role is offered, and the developer picks each one** (T4). The Project manager only where
//     there is something to manage — a plan folder on disk — and a withheld role is named with the
//     reason, never dropped silently.
//   - **A role an existing agent covers is never offered again** (T6). That agent's proposed edits are
//     carried per agent instead, for a per-agent question with its diff.
//   - **The verifier /cortex stamped is offered the upgrade to the Reviewer** (T9). Declining keeps it,
//     and it keeps the Reviewer covered, so the role is still not offered twice.
//   - **Every value a template needs is detected or asked** — `needs`, per role, with the question.
//     Nothing is invented: a command a repo never declared, written into an agent, fails the first
//     time the agent runs it.
//
// After the picks, `teamValues` gives the files to write, the values to render them with and the
// `{{ROSTER}}` the playbook names — computed here so the line in CLAUDE.md is exactly the team that
// was written. The playbook is a block appended to CLAUDE.md, a file the team also writes, so it is
// not recorded in `.cortex/stamps.json` (as the verification block is not); every whole file is.
//
// Reads files; writes nothing. Deterministic for a given tree: no model, no clock, no network.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLES, agentReport } from "./agents.mjs";
import { adrLocation } from "./adr.mjs";
import { placeholderMatches } from "./placeholders.mjs";
import { readStamps } from "./stamps.mjs";
import { findSections } from "./section.mjs";

const TEMPLATES_DIR = fileURLToPath(new URL("../../templates/", import.meta.url));

/** The heading the playbook block writes into CLAUDE.md — how a repo is known to have a team. */
export const PLAYBOOK_HEADING = "Working as a team";

const FENCE = { path: ".claude/hooks/test-paths.sh", template: "team/test-paths.sh" };
const SKILL = { path: ".claude/skills/team/SKILL.md", template: "team/team-skill.md" };
const PLAYBOOK = { path: "CLAUDE.md", template: "team/playbook.md" };
const roleFile = (role) => ({ path: `.claude/agents/${role}.md`, template: `team/${role}.md` });

/**
 * Every whole file the team row stamps, for `LOOP_STAMPS`: recorded, and updated like any loop file.
 * `adopt: false` on all of them. The team shipped after the stamp record, so no Cortex ever wrote one
 * without recording it — a `.claude/agents/architect.md` in a repo with no record is the team's own.
 */
export const TEAM_STAMPS = [...ROLES.map(roleFile), FENCE, SKILL].map((s) => ({ ...s, adopt: false }));

// The plan folders a Project manager keeps, in the README's order. Its offer waits on one (T4).
const PLAN_DIRS = ["intent", "docs/specs", "docs/plans"];

// Each value's question, for when it was not detected. PLAN_DIRS is never asked: without a plan
// folder the role is not offered. ADR_DIR and SCOPED_BRIEFS always have an answer.
const QUESTIONS = {
  TEST_CMD: "What command runs the tests once and exits? None was detected, and one that watches never returns.",
  RUN: "What command launches the change, so the Reviewer can exercise it? No verifier run command is recorded here.",
  TEST_PATHS: "Where do this repo's tests live? The index marks no file as a test.",
  TEST_GLOBS: "Which files may the Tester edit, as shell globs such as \"*/test/*\"? The index marks no test, and an empty list refuses every edit.",
};

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const span = (s) => `\`${s}\``;

/** The placeholders a team template uses, read from the template — the one list of them. */
function placeholdersIn(template) {
  const text = readText(join(TEMPLATES_DIR, ...template.split("/"))) ?? "";
  return [...new Set(placeholderMatches(text).map((m) => m.name))];
}

// --- test locations --------------------------------------------------------------------------------

const TEST_DIRS = new Set(["__tests__", "test", "tests", "spec"]);
// A test file's name, as a shell glob — the same conventions `isTestPath` reads (lib/langs.mjs).
const NAME_GLOBS = [
  [/\.(test|spec)\.([a-z]+)$/, (m) => `*.${m[1]}.${m[2]}`],
  [/_(test|spec)\.([a-z]+)$/, (m) => `*_${m[1]}.${m[2]}`],
  [/(?:^|\/)test_[^/]+\.py$/, () => "*/test_*.py"],
  [/(?:^|\/)conftest\.py$/, () => "*/conftest.py"],
  [/(?:^|\/)test-[^/]+\.(sh|bash|zsh|py)$/, (m) => `*/test-*.${m[1]}`],
  [/\.bats$/, () => "*.bats"],
  [/(Tests?)\.(java|kt|cs|scala)$/, (m) => `*${m[1]}.${m[2]}`],
  [/Spec\.(kt|scala)$/, (m) => `*Spec.${m[1]}`],
];

/**
 * Where this repo's tests live, from the files the index marks `isTest`: `{ paths, globs }` or `null`.
 * A test directory (`test/`, `__tests__/`…) is one glob for every file under it, anywhere in the repo;
 * a file outside one is matched by its name's convention. `globs` are the hook's list — each matched
 * against `/` plus the repo path — and `paths` the same locations as the Tester's prose names them.
 * Only globs a real test file produced: an extra one widens the fence, and the fence fails closed.
 */
export function testLocations(index) {
  // Never from under .claude/: the fence refuses every edit there, and the fence itself,
  // `.claude/hooks/test-paths.sh`, is named like a shell test — found on the first real team stamp.
  const tests = (index?.files ?? []).filter((f) => f.isTest && !f.path.startsWith(".claude/")).map((f) => f.path);
  if (!tests.length) return null;
  const dirs = new Set();
  const names = new Set();
  for (const p of tests) {
    const segs = p.split("/").slice(0, -1);
    const dir = segs.find((s) => TEST_DIRS.has(s));
    if (dir) { dirs.add(dir); continue; }
    for (const [re, glob] of NAME_GLOBS) {
      const m = p.match(re);
      if (m) { names.add(glob(m)); break; }
    }
  }
  if (!dirs.size && !names.size) return null;
  const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const dirList = [...dirs].sort(byCode);
  const nameList = [...names].sort(byCode);
  return {
    globs: [...dirList.map((d) => `"*/${d}/*"`), ...nameList.map((n) => `"${n}"`)],
    paths: [...dirList.map((d) => span(`**/${d}/**`)), ...nameList.map((n) => span(`**/${n.replace(/^\*\//, "")}`))].join(", "),
  };
}

// --- the state the team row reads ----------------------------------------------------------------

/**
 * Whether `.claude/skills/team/SKILL.md` is there, and whose: `null` (absent), `ours` (the stamp record
 * holds it) or `theirs`. The playbook tells every session to load the skill named `team`, so a skill
 * of that name the team wrote for something else would be loaded in its place.
 */
function skillState(root) {
  if (!existsSync(join(root, ...SKILL.path.split("/")))) return null;
  try {
    return readStamps(root)?.files?.[SKILL.path] ? "ours" : "theirs";
  } catch {
    return "theirs";
  }
}

/** The run command the verifier was stamped with, or null. A damaged record costs this value only. */
function recordedRun(root, verifierPath) {
  try {
    const run = readStamps(root)?.files?.[verifierPath]?.values?.RUN;
    return typeof run === "string" && run.trim() ? run : null;
  } catch {
    return null; // next.mjs names a damaged record as its own row; the team offer does not repeat it
  }
}

/**
 * What the team row offers this repo, or `null` without an index. Options: `testCmd` (the loop's
 * detected test command), `verifierPath` (where /cortex stamps its verifier) and `as` (the developer's
 * own mapping of existing agents, `{ path: role | null }`).
 *
 * `{ report, playbook, teamSkill, values, covered, offer, withheld, upgrade, unmapped, proposals }`.
 * `values` holds each detected value and `null` for one that was not; `offer` is the roles to ask
 * about, each with the questions its files need.
 */
export function teamState(root, index, { testCmd = null, verifierPath = null, as = {} } = {}) {
  if (!index) return null;
  const report = agentReport(root, index, { verifierPath, as });
  const claudeMd = readText(join(root, "CLAUDE.md")) ?? "";
  const tests = testLocations(index);
  const planDirs = PLAN_DIRS.filter((d) => isDir(join(root, ...d.split("/"))));
  const briefs = (index.files ?? [])
    .map((f) => f.path)
    .filter((p) => /\/AGENTS\.md$/.test(p) && !p.startsWith(".claude/") && !p.startsWith(".cortex/"))
    .sort();

  const values = {
    TEST_CMD: testCmd || null,
    RUN: recordedRun(root, verifierPath),
    ADR_DIR: `${adrLocation(root).dir}/`,
    TEST_PATHS: tests?.paths ?? null,
    TEST_GLOBS: tests ? tests.globs.map((g) => `  ${g}`).join("\n") : null,
    PLAN_DIRS: planDirs.length ? planDirs.map((d) => span(`${d}/`)).join(", ") : null,
    SCOPED_BRIEFS: briefs.map((b) => `   - ${span(b)}`).join("\n"),
  };

  const members = report.agents.filter((a) => a.loads && a.mapping.role);
  const covered = {};
  for (const role of ROLES) {
    const by = members.filter((a) => a.mapping.role === role).map((a) => ({ path: a.path, name: a.name }));
    if (by.length) covered[role] = by;
  }
  // Never clobber, and never a second agent of one name: Claude Code loads only one of two files
  // declaring the same `name`, by read order. Reached when the developer says an agent called
  // `reviewer` is not the reviewer — the role is free, and its file and its name are not.
  const clashFor = (role, except = null) => {
    const at = roleFile(role).path;
    const clash = report.agents.find((a) => a.path !== except && (a.path === at || a.name === role));
    if (clash) return `${span(clash.name)} (${clash.path}) already takes the name or the file ${at}`;
    return at !== except && existsSync(join(root, ...at.split("/"))) ? `${at} is already here` : null;
  };
  const up = members.find((a) => a.mapping.upgrade);
  const upClash = up ? clashFor("reviewer", up.path) : null;
  const upgrade = up && !upClash ? { path: up.path, name: up.name, ...up.mapping.upgrade } : null;

  const offer = [];
  const withheld = [];
  for (const role of ROLES) {
    if (covered[role]) {
      const who = covered[role].map((a) => `${span(a.name)} (${a.path})`).join(", ");
      const note = role !== "reviewer" || !up ? "" : upgrade ? " — offered the upgrade instead" : ` — the upgrade waits: ${upClash}, and Claude Code loads one agent per name`;
      withheld.push({ role, why: `covered by ${who}${note}` });
      continue;
    }
    if (role === "project-manager" && !planDirs.length) {
      withheld.push({ role, why: "nothing to manage yet: no plan folder (intent/, docs/specs/ or docs/plans/)" });
      continue;
    }
    const clash = clashFor(role);
    if (clash) {
      withheld.push({ role, why: `${clash}, and Claude Code loads one agent per name — rename it first` });
      continue;
    }
    offer.push({ role, ...roleFile(role), needs: needsFor(role, values) });
  }

  return {
    report,
    // The one reader of the section (lib/section.mjs): a heading in a code fence is not the playbook.
    playbook: findSections(claudeMd, PLAYBOOK_HEADING).length > 0,
    teamSkill: skillState(root),
    values,
    covered,
    offer,
    withheld,
    upgrade: upgrade ? { ...upgrade, needs: needsFor("reviewer", values) } : null,
    unmapped: report.agents.filter((a) => a.loads && !a.mapping.role).map((a) => ({ path: a.path, name: a.name, reason: a.mapping.reason })),
    // The upgrade is the verifier's proposal; its own line edits would be superseded by it.
    proposals: members
      .filter((a) => a.proposals.length && !a.mapping.upgrade)
      .map((a) => ({ path: a.path, name: a.name, role: a.mapping.role, proposals: a.proposals })),
  };
}

/** The questions a role's files need answered: each placeholder they use that was not detected. */
function needsFor(role, values) {
  const used = new Set(placeholdersIn(roleFile(role).template));
  if (role === "tester") for (const p of placeholdersIn(FENCE.template)) used.add(p);
  return [...used]
    .filter((p) => values[p] === null && QUESTIONS[p])
    .sort()
    .map((placeholder) => ({ placeholder, question: QUESTIONS[placeholder] }));
}

// --- after the picks -----------------------------------------------------------------------------

/**
 * What to write once the developer has picked: `{ files, values, needs, conflicts, upgrade }`. A
 * `conflicts` entry is a sentence to put to the developer before anything is written.
 *
 * `files` in writing order, each `{ template, path, mode, recorded, executable }` — `mode` is `write`
 * for a whole file (recorded in stamps.json), `append` for the playbook block (not recorded), or
 * `roster` when the block is already in CLAUDE.md and only its roster line changes. `values` holds
 * every detected value plus `ROSTER`; `needs` is what must still be asked. `upgrade.remove` is the
 * verifier the Reviewer replaces, when the developer accepted it.
 *
 * A pick that is not on offer is refused with the reason: a covered role, a withheld Project manager,
 * or a name that is not a role. Picking `reviewer` where the verifier holds the role accepts T9's
 * upgrade.
 */
export function teamValues(state, picked) {
  for (const role of picked) {
    if (!ROLES.includes(role)) throw new Error(`${role} is not a role — one of ${ROLES.join(", ")}`);
    if (state.offer.some((o) => o.role === role)) continue;
    if (role === "reviewer" && state.upgrade) continue;
    const w = state.withheld.find((x) => x.role === role);
    throw new Error(`${role} is not offered here: ${w?.why ?? "not on offer"}`);
  }
  const chosen = ROLES.filter((r) => picked.includes(r));
  const upgrading = Boolean(state.upgrade) && chosen.includes("reviewer");

  const files = [];
  for (const role of chosen) {
    files.push({ ...roleFile(role), mode: "write", recorded: true, executable: false });
    if (role === "tester") files.push({ ...FENCE, mode: "write", recorded: true, executable: true });
  }
  const roster = rosterFor(chosen, state, upgrading);
  const conflicts = [];
  if (roster) {
    if (!state.teamSkill) files.push({ ...SKILL, mode: "write", recorded: true, executable: false });
    if (state.teamSkill === "theirs") {
      conflicts.push(
        `${SKILL.path} is already here and not Cortex's. The playbook tells every session to load the skill named team, ` +
          "so a different skill of that name runs in its place. Ask whether it is this team's protocol; if not, it needs another name first.",
      );
    }
    files.push({ ...PLAYBOOK, mode: state.playbook ? "roster" : "append", recorded: false, executable: false });
  }

  const values = Object.fromEntries(Object.entries(state.values).filter(([, v]) => v !== null));
  if (roster) values.ROSTER = roster;
  const needs = [];
  for (const role of chosen) {
    const asked = role === "reviewer" && upgrading ? state.upgrade.needs : state.offer.find((o) => o.role === role).needs;
    for (const n of asked) if (!needs.some((x) => x.placeholder === n.placeholder)) needs.push(n);
  }
  return {
    files,
    values,
    needs,
    conflicts,
    upgrade: upgrading ? { remove: state.upgrade.path, why: state.upgrade.why } : null,
  };
}

/**
 * `{{ROSTER}}`: the roles stamped in this run by role name, then every existing agent that plays a
 * role as `` `name` (role) `` — minus a verifier the Reviewer just replaced. Roster order, then path.
 * An empty string when nobody is on the team, which means no playbook.
 */
function rosterFor(chosen, state, upgrading) {
  const stamped = chosen.map((r) => ({ order: ROLES.indexOf(r), path: "", text: span(r) }));
  const existing = [];
  for (const [role, agents] of Object.entries(state.covered)) {
    for (const a of agents) {
      if (upgrading && state.upgrade && a.path === state.upgrade.path) continue;
      existing.push({ order: ROLES.indexOf(role), path: a.path, text: `${span(a.name)} (${role})` });
    }
  }
  const byOrder = (a, b) => a.order - b.order || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return [...stamped.sort(byOrder), ...existing.sort(byOrder)].map((x) => x.text).join(", ");
}
