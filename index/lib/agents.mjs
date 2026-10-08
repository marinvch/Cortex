// agents.mjs — the agents a repo already has: which role each one plays, and what would sharpen it.
//
// Spec T6 (docs/specs/2026-09-28-agent-team-design.md): before /cortex offers the agent team, the
// repo's own `.claude/agents/*.md` are graded with the claude-setup checks, mapped to one of the
// five roles in templates/team/, and given concrete edits the developer confirms one agent at a
// time. A role an agent already covers is never offered again — a second reviewer beside the team's
// own is the duplication T6 exists to prevent.
//
// Three rules shape everything below.
//
//   - **Every mapping rule may only DROP a candidate** — the principle `skill-drift.mjs` and
//     `orphans.mjs` hold. A role is proposed from the agent's name and the job its description
//     states; negation, sequencing clauses, a lens specialist, missing edit tools and a name that says
//     otherwise each remove one. What survives alone is the mapping; two survivors, or none, is
//     `null` — "unmapped, ask". A wrong mapping costs more than an unanswered one: it hides a role
//     the repo does not have (it is never offered) and it pushes edits toward the wrong job.
//   - **A proposal must be provable from the file and the roster.** Tools outside the role's table,
//     a description that never says when to call it, no citation rule, a scoped brief the agent would
//     never load. Each names its line and the text to put there. No prose is rewritten: the words
//     proposed are the role template's own, quoted from templates/team/, so there is one copy.
//   - **Reuse, never re-derive.** The agent list, the frontmatter reader, the tool reading and the
//     read-only prose test are `claude-setup.mjs`'s; the roster's tools are the templates'. A second
//     frontmatter parser here would agree today and disagree in a month.
//
// Reads files; writes nothing. Deterministic for a given tree: no model, no clock, no network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { triggerPhrasing } from "../../core/claude-code.js";
import { subagentGrades, readFrontmatter, toolList, claimsReadOnly, EDIT_TOOLS } from "./claude-setup.mjs";
import { textSource } from "./repo-text.mjs";

/** The roster, in the order the spec's table gives it — also the order gaps are reported in. */
export const ROLES = ["architect", "implementer", "tester", "reviewer", "project-manager"];

export const AGENTS_REL = ".claude/agents";
// Recursive: "Claude Code scans `.claude/agents/` and `~/.claude/agents/` recursively, so you can
// organize definitions into subfolders" (code.claude.com/docs/en/sub-agents). Identity is `name`.
const OWN_AGENT = /^\.claude\/agents\/.+\.md$/;
const TEAM_DIR = fileURLToPath(new URL("../../templates/team/", import.meta.url));

// ---------------------------------------------------------------------------------------------
// The roster, read from the templates — the tools table has one home
// ---------------------------------------------------------------------------------------------

const rosterCache = new Map();

/** Sentences of a paragraph-joined text; a numbered-list marker becomes its own "sentence". */
function sentences(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z`"'(\d])/))
    .map((s) => s.replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

/**
 * Each role's tools, and the three sentences a proposal quotes: when to call it (the description's
 * "Use …" sentence), the citation rule, and the scoped-brief rule. Read from `templates/team/<role>.md`
 * so a change to a template changes what is proposed, and nothing here can drift from it.
 */
export function teamRoster(dir = TEAM_DIR) {
  if (rosterCache.has(dir)) return rosterCache.get(dir);
  const out = {};
  for (const role of ROLES) {
    const fm = readFrontmatter(readFileSync(join(dir, `${role}.md`), "utf8"));
    const tools = toolList(fm.data.tools) ?? [];
    const disallowedTools = toolList(fm.data.disallowedTools) ?? [];
    const body = sentences(fm.body);
    const citation = sentences(fm.body).join(" ").match(/Every claim you make about this repo cites[\s\S]*?leave it out\./)?.[0] ?? null;
    const grounding = body.find((s) => /read every `AGENTS\.md` between it and the repo root/.test(s)) ?? null;
    out[role] = {
      template: `team/${role}.md`,
      tools,
      disallowedTools,
      canEdit: tools.some((t) => EDIT_TOOLS.includes(t) && !disallowedTools.includes(t)),
      when: sentences(String(fm.data.description ?? "")).find((s) => /^Use\b/.test(s)) ?? null,
      citation,
      grounding: grounding && grounding[0].toUpperCase() + grounding.slice(1),
    };
  }
  rosterCache.set(dir, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Listing and grading
// ---------------------------------------------------------------------------------------------

const str = (v) => (typeof v === "string" ? v : "");

/**
 * The repo's own agents — every `.md` under `.claude/agents/` at its root, subfolders included, the directory Claude Code loads project
 * subagents from and the one /cortex writes the team into (T8). A nested package's agents and the
 * agents a plugin in this repo ships are not this repo's team. Each carries the claude-setup
 * findings for it, from `subagentGrades` — the same checks, one file at a time.
 *
 * `opts.read` / `opts.exists` are passed through to the checker, so a test can give literal text.
 */
export function repoAgents(root, index, opts = {}) {
  return subagentGrades(index, root, opts)
    .filter((g) => OWN_AGENT.test(g.path) && !g.plugin)
    .map((g) => {
      const fm = g.frontmatter ?? { state: "none", data: {}, keys: [], body: "" };
      const data = fm.data ?? {};
      const stem = g.path.split("/").pop().replace(/\.md$/, "");
      const toolsRaw = data.tools;
      const toolsUnreadable = toolsRaw !== undefined && !Array.isArray(toolsRaw) && typeof toolsRaw !== "string";
      const disRaw = data.disallowedTools;
      return {
        path: g.path,
        name: str(data.name).trim() || stem,
        description: str(data.description),
        tools: toolsRaw === undefined || toolsUnreadable ? null : toolList(toolsRaw),
        toolsUnreadable,
        disallowedTools: disRaw === undefined || (!Array.isArray(disRaw) && typeof disRaw !== "string") ? null : toolList(disRaw),
        // Claude Code loads a subagent only with parseable frontmatter holding both required keys.
        loads: fm.state === "ok" && Boolean(str(data.name).trim()) && Boolean(str(data.description).trim()),
        frontmatterState: fm.state,
        text: g.text ?? "",
        body: fm.body ?? "",
        findings: g.findings,
      };
    });
}

/**
 * Can this agent edit files? `true` / `false`, or `null` when its tools line could not be read. No
 * `tools:` line inherits every tool — the rule claude-setup's read-only check cites.
 */
export function canEdit(agent) {
  if (agent.toolsUnreadable) return null;
  const denied = new Set(agent.disallowedTools ?? []);
  return (agent.tools ?? EDIT_TOOLS).some((t) => EDIT_TOOLS.includes(t) && !denied.has(t));
}

// ---------------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------------

// A role word in the NAME. The name is what the team chose to call the agent, so it is the
// strongest evidence there is — and a description that mentions other roles is usually describing
// a handoff ("then hands off so the Implementer…"), which is why the name outranks it below.
const NAME_WORDS = {
  architect: ["architect", "architecture", "planner", "plan", "planning"],
  implementer: ["implementer", "implementor", "coder"],
  tester: ["tester", "test", "tests", "testing", "tdd"],
  reviewer: ["reviewer", "review", "verifier", "verify", "auditor", "audit", "checker", "critic", "vet"],
  "project-manager": ["pm", "po", "prd", "scrum"],
};
// A generic job noun names the Implementer only when nothing more specific stands beside it:
// `python-test-developer` is a Tester, `be-developer` an Implementer. Not "engineer": its qualifier
// is usually a discipline, not a stack — `prompt-engineer`, `release-train-engineer`, `data-engineer`
// on real repos, none of them the one who builds the planned change.
const GENERIC_IMPLEMENTER = ["developer", "dev"];
// QA is the Tester in some teams and the Reviewer in others (on real repos: "writes failing tests"
// in one, "verifies completed work against the definition of done" in two more). It names both,
// and only the description may choose.
const QA_WORDS = ["qa", "qas"];
// A manager is a project manager only with the word that says so — `context-manager` is not one.
const MANAGER = /(?:^|-)(?:project|product|program|delivery)-(?:manager|owner|management|lead)(?:-|$)/;
// A lens is one angle of a review, not a role. A security reviewer beside the team leaves the
// Reviewer to be offered; mapping it would hide the role and push its edits toward the wrong job.
const LENS = [
  "security", "secure", "sec", "appsec", "performance", "perf", "a11y", "accessibility", "seo", "privacy",
  "compliance", "license", "licensing", "ux", "ui", "wireframe", "mockup", "visual", "brand", "i18n", "l10n",
  "localization", "docs", "documentation",
];
// Jobs the roster does not have. Diagnosis is `/diagnosing-bugs`' work and orchestration is the main
// session's (T1): a debugger that "implements robust fixes" is not the Implementer of a plan.
const OUTSIDE = ["debug", "debugger", "debugging", "doctor", "diagnose", "diagnostics", "researcher", "research", "orchestrator", "coordinator", "recruiter"];

// The JOB a description states. Verbs and job phrases, never a bare role noun: the templates
// themselves say "before the Implementer starts", and that is a neighbour, not the job.
const W = "(?:[\\w/-]+,? ){0,3}";
const DESC = {
  architect: [
    /\barchitect(?:s|ing)?\b/gi,
    /\b(?:system|software|solution|technical|api) (?:architecture|design)\b/gi,
    /\barchitecture (?:decisions?|design|diagrams?|plans?|documentation|documents?)\b/gi,
    /\b(?:designs?|designing|defines?|defining|plans?|planning|owns?) (?:the |a |an )?(?:system |software |overall |target )?architecture\b/gi,
    /\b(?:implementation|technical|execution|migration|refactor(?:ing)?|development|detailed|step-by-step|actionable) plans?\b/gi,
    new RegExp(`\\b(?:creates?|writes?|produces?|drafts?|generates?) (?:a |an |the )?${W}plans?\\b`, "gi"),
    new RegExp(`\\binto (?:a |an )?${W}plans?\\b`, "gi"),
    new RegExp(`\\bplan(?:s|ning)? (?:the |a |an )?${W}(?:tasks?|implementation|changes?|features?|work|approach)\\b`, "gi"),
    /\bdecompos(?:e|es|ing)\b/gi,
    /\bblast radius\b/gi,
  ],
  implementer: [
    /\bimplement(?:s|ing)?\b/gi,
    new RegExp(`\\bwrit(?:e|es|ing) ${W}code\\b`, "gi"),
    new RegExp(`\\bbuild(?:s|ing)? (?:the |new )?${W}(?:features?|components?|endpoints?|apis?|services?|applications?|apps?)\\b`, "gi"),
    /\bmakes? (?:the |them |it |a )?(?:failing )?(?:tests? )?pass\b/gi,
    /\bmakes? the (?:agreed |planned |requested )?changes?\b/gi,
    new RegExp(`\\bexecut(?:e|es|ing) ${W}tasks?\\b`, "gi"),
    /\bfeature development\b/gi,
    /\bdevelop(?:s|ing)? (?:new )?features?\b/gi,
  ],
  tester: [
    /\b(?:writ(?:e|es|ing)|creat(?:e|es|ing)|generat(?:e|es|ing)|adds?|adding|author(?:s|ing)?) (?:the |a |an |new |failing |missing |more |unit |integration |e2e |end-to-end |comprehensive |regression |property-based )*(?:tests?|test cases|test suites?)\b/gi,
    /\btest[- ]driven\b/gi,
    /\btdd\b/gi,
    /\btest (?:coverage|automation)\b/gi,
    /\buntested\b/gi,
  ],
  reviewer: [
    /\breview(?:s|ing|er)?\b/gi,
    /\bverif(?:y|ies|ying|ication|ier)\b/gi,
    // Not "audit": "the audit trail", "auditing which write paths are logged" belonged to a domain
    // expert for activity logging. An auditor names itself, and the name list has the word.
    // Not a bare "second opinion": on a real repo that was a devil's advocate for approaches
    // ("use when you want a second opinion on an approach"), which runs and checks nothing.
    /\bindependent (?:check|review|verification|second[- ]opinion)\b/gi,
  ],
  "project-manager": [
    /\bacceptance criteria\b/gi,
    /\buser stor(?:y|ies)\b/gi,
    /\bbacklog\b/gi,
    /\b(?:task|work) (?:lists?|breakdown|items?)\b/gi,
    /\bsprints?\b/gi,
    /\broadmaps?\b/gi,
    /\bprioriti[sz](?:e|es|ing|ation)\b/gi,
    /\bproduct requirements?\b/gi,
    /\bPRDs?\b/g,
    /\bmilestones?\b/gi,
    /\btrack(?:s|ing)? (?:progress|tasks|work|status)\b/gi,
    /\bdefinition of done\b/gi,
    // The job title, spelled out where the name is an acronym (`tdm`, "Technical Delivery Manager").
    /\b(?:project|product|program|delivery) (?:manager|owner|management)\b/gi,
  ],
};

// What sits in front of a match and cancels it.
const NEGATED = /\b(?:not|never|no|don't|doesn't|does not|do not|without|rather than|instead of|nor)\s+(?:[\w-]+\s+){0,2}$/i;
// A sequencing clause says WHEN to call the agent, not what it does: "use after implementing".
const SEQUENCED = /\b(?:after|once|before|until|following|prior to)\s+(?:[\w-]+[\s,]+){0,3}$/i;
// "ready for review" is when; "code review" is the job.
const FOR_REVIEW = /\b(?:ready|submit(?:ted)?|up|open(?:ed)?|sent|send) for $/i;

/** The description's statement of the job: dialogue examples and commentary are not it. */
function jobText(description) {
  return description
    .replace(/\\n/g, "\n")
    .replace(/<example>[\s\S]*?(?:<\/example>|$)/gi, " ")
    .replace(/<commentary>[\s\S]*?(?:<\/commentary>|$)/gi, " ")
    .replace(/\bexamples?:[\s\S]*$/i, " ");
}

function descriptionHits(description) {
  const text = jobText(description);
  const hits = {};
  for (const role of ROLES) {
    for (const re of DESC[role]) {
      for (const m of text.matchAll(re)) {
        const pre = text.slice(Math.max(0, m.index - 40), m.index);
        if (NEGATED.test(pre) || SEQUENCED.test(pre)) continue;
        // Part of a hyphenated name is another agent, not this one's job: "feeds the
        // wireframe-architect and product-owner agents".
        if (text[m.index - 1] === "-" || text[m.index + m[0].length] === "-") continue;
        if (role === "reviewer" && FOR_REVIEW.test(pre)) continue;
        (hits[role] ??= []).push(m[0]);
      }
    }
  }
  for (const role of Object.keys(hits)) hits[role] = [...new Set(hits[role])];
  return hits;
}

function nameHits(name) {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const joined = tokens.join("-");
  const hits = {};
  const add = (role, word) => (hits[role] ??= []).includes(word) || hits[role].push(word);
  for (const role of ROLES) for (const t of tokens) if (NAME_WORDS[role].includes(t)) add(role, t);
  if (MANAGER.test(joined)) add("project-manager", joined.match(MANAGER)[0].replace(/^-|-$/g, ""));
  for (const t of tokens) if (QA_WORDS.includes(t)) { add("tester", t); add("reviewer", t); }
  const generic = tokens.filter((t) => GENERIC_IMPLEMENTER.includes(t));
  if (generic.length && !Object.keys(hits).length) for (const t of generic) add("implementer", t);
  return { hits, tokens };
}

/**
 * Which role this agent plays, with the evidence — or `role: null` and the reason to ask.
 *
 * `{ role, reason, candidates, remaining, evidence: { name, description, tools }, dropped, upgrade, note }`.
 * `reason` is `mapped`, `ambiguous` (two roles survived — ask which), `no-role-words`, `dropped`
 * (every candidate was ruled out), `lens` (a specialist on one angle), `outside-roster` (a job the
 * five do not have: a debugger, a researcher, an orchestrator), or `not-loaded`; `note` says why for
 * the two name-based ones. `upgrade` is set on the verifier /cortex stamps, which T9 offers the
 * Reviewer's upgrade. `verifierPath` is where that verifier lands; `loop.mjs` owns it and passes it.
 */
export function mapRole(agent, { verifierPath = null } = {}) {
  const edit = canEdit(agent);
  const toolsEvidence = [];
  if (agent.toolsUnreadable) toolsEvidence.push("tools: could not be read");
  else if (agent.tools) toolsEvidence.push(`tools: ${agent.tools.join(", ")}${edit ? "" : " — no edit tool"}`);
  else toolsEvidence.push("no tools: line — inherits every tool, Edit and Write included");
  if (agent.disallowedTools?.length) toolsEvidence.push(`disallowedTools: ${agent.disallowedTools.join(", ")}`);

  const result = (role, reason, extra = {}) => ({
    role,
    reason,
    candidates: [],
    remaining: role ? [role] : [],
    evidence: { name: [], description: [], tools: toolsEvidence },
    dropped: [],
    upgrade: null,
    note: null,
    ...extra,
  });

  if (!agent.loads) return result(null, "not-loaded");

  const { hits: byName, tokens } = nameHits(agent.name);
  const byDesc = descriptionHits(agent.description);
  const candidates = ROLES.filter((r) => byName[r] || byDesc[r]);
  const evidence = {
    name: [...new Set(Object.values(byName).flat())],
    description: [...new Set(candidates.flatMap((r) => byDesc[r] ?? []))],
    tools: toolsEvidence,
  };
  const dropped = [];
  let live = [...candidates];
  const drop = (role, why) => {
    if (!live.includes(role)) return;
    live = live.filter((r) => r !== role);
    dropped.push({ role, why });
  };

  // 1. A lens specialist, or a job the roster does not have, is none of the five.
  const lens = tokens.find((t) => LENS.includes(t));
  if (lens) {
    for (const r of [...live]) drop(r, `the name scopes it to one lens (${lens}) — a specialist, not the ${r}`);
    return result(null, "lens", { candidates, remaining: [], evidence, dropped, note: `the name scopes it to one lens (${lens}), not a role` });
  }
  const outside = tokens.find((t) => OUTSIDE.includes(t));
  if (outside) {
    for (const r of [...live]) drop(r, `the name says ${outside}, a job the roster does not have`);
    return result(null, "outside-roster", { candidates, remaining: [], evidence, dropped, note: `the name says ${outside}, a job the roster does not have` });
  }

  // 2. Implementer and Tester write files; an agent that cannot is neither.
  const saysReadOnly = claimsReadOnly(agent.description, agent.body);
  for (const r of ["implementer", "tester"]) {
    if (edit === false) drop(r, `it cannot edit (${toolsEvidence.join("; ")}), and the ${r} writes files`);
    else if (saysReadOnly) drop(r, `its prose says it changes nothing, and the ${r} writes files`);
  }

  // 3. The name outranks a description that names other work.
  const named = live.filter((r) => byName[r]);
  if (named.length) {
    for (const r of live.filter((x) => !byName[x])) {
      drop(r, `the name says ${named.join(" or ")}; "${(byDesc[r] ?? []).join('", "')}" in the description reads as a handoff`);
    }
    // 4. A name naming two roles (QA, `plan-reviewer`) is settled by the description or not at all.
    if (named.length > 1) {
      const confirmed = named.filter((r) => byDesc[r]);
      if (confirmed.length) for (const r of named.filter((x) => !confirmed.includes(x))) drop(r, `the name names it, but the description states another of the name's roles`);
    }
  }

  let upgrade = null;
  if (live.length === 1 && live[0] === "reviewer" && verifierPath && agent.path === verifierPath) {
    upgrade = {
      to: "reviewer",
      template: teamRoster().reviewer.template,
      why: `${agent.path} is where /cortex stamps its verifier; T9 offers it the Reviewer's upgrade, and it keeps working until the developer accepts`,
    };
  }
  if (live.length === 1) return result(live[0], "mapped", { candidates, evidence, dropped, upgrade });
  if (live.length > 1) return result(null, "ambiguous", { candidates, remaining: live, evidence, dropped });
  return result(null, candidates.length ? "dropped" : "no-role-words", { candidates, remaining: [], evidence, dropped });
}

// ---------------------------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------------------------

// Tools a proposal never asks to remove: reading is every role's, TodoWrite changes nothing, and an
// MCP tool is the repo's own wiring — the tuning T6 says a replacement would lose.
const HARMLESS = new Set(["Read", "Grep", "Glob", "LS", "TodoWrite"]);

const WHEN = [
  /\buse\b[^.]{0,80}?\b(?:when|whenever|once|after|before|for|to|at|if|during|on|in)\b/i,
  /\bproactively\b/i,
  /\bmust be used\b/i,
  /\b(?:when|whenever|after|before|once|during|while)\b/i,
  /\binvoked?\b/i,
  /\btrigger(?:s|ed)?\b/i,
];
/** Does a description say when to call the agent? Generous on purpose: only an absence is proposed. */
export function saysWhen(description) {
  const d = jobText(description);
  return Boolean(triggerPhrasing(d)) || WHEN.some((re) => re.test(d));
}

const CITES = [/\bcit(?:e|es|ed|ing|ation|ations)\b/i, /\b(?:path|file):line\b/i, /`[^`\s]+:\d+(?:-\d+)?`/, /\bline numbers?\b/i];

/**
 * Where the repo's briefs are, and whether a subagent loads them on its own. A subagent loads
 * CLAUDE.md and what it imports; a scoped `<dir>/AGENTS.md` is never loaded unless someone reads it.
 */
export function repoGrounding(index, read) {
  const paths = (index?.files ?? []).map((f) => f.path);
  const scoped = paths.filter((p) => /\/AGENTS\.md$/.test(p) && !p.startsWith(".claude/")).sort();
  const root = paths.includes("AGENTS.md");
  const memory = ["CLAUDE.md", ".claude/CLAUDE.md"].map((p) => read(p)).filter((t) => typeof t === "string");
  const agentsMd = root ? read("AGENTS.md") : null;
  // Loaded by an @import, or because CLAUDE.md is a symlink to it — which a checkout without symlink
  // support stores as a one-line file naming the target, and one with it reads as the same text.
  const rootLoaded =
    root &&
    memory.some((t) => /(?:^|\s)@(?:\.\/)?AGENTS\.md\b/m.test(t) || t.trim() === "AGENTS.md" || (typeof agentsMd === "string" && t === agentsMd));
  return { scoped, root, rootLoaded, needed: scoped.length > 0 || (root && !rootLoaded) };
}

function frontmatterLines(text) {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const close = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  const keyLine = (k) => {
    const i = lines.findIndex((l, j) => j > 0 && j < close && new RegExp(`^${k}\\s*:`).test(l));
    return i < 0 ? null : i + 1;
  };
  let last = lines.length;
  while (last > 0 && !lines[last - 1].trim()) last--;
  return { lines, close: close + 1, keyLine, last };
}

/**
 * Concrete edits that would make this agent the `role` in the roster, each provable from the file
 * and the role's template: `{ kind, action, line, current, text, why }`. `action` is `replace` (the
 * line), `insert-before` (the line), `extend` (the description on that line, by one sentence) or
 * `append` (after the last line). `grounding` is `repoGrounding`'s answer; without it the brief
 * proposal is not made. An unmapped agent gets none — there is no role to hold it to.
 */
export function proposeEdits(agent, role, grounding = null) {
  if (!role || !agent.loads || !agent.text) return [];
  const R = teamRoster()[role];
  const fm = frontmatterLines(agent.text);
  const out = [];
  const edit = canEdit(agent);
  const toolsAt = fm.keyLine("tools");

  if (!R.canEdit && edit) {
    if (agent.tools) {
      const kept = agent.tools.filter((t) => !EDIT_TOOLS.includes(t));
      out.push({
        kind: "tools-can-edit",
        action: "replace",
        line: toolsAt,
        current: fm.lines[toolsAt - 1],
        text: `tools: ${(kept.length ? kept : R.tools).join(", ")}`,
        why: `the ${role} changes nothing (${R.template}), and this line grants ${agent.tools.filter((t) => EDIT_TOOLS.includes(t)).join(", ")}. Keep them only if this agent's own job is to write files, and then it is not the ${role}.`,
      });
    } else if (!agent.toolsUnreadable) {
      out.push({
        kind: "tools-can-edit",
        action: "insert-before",
        line: fm.close,
        current: fm.lines[fm.close - 1],
        text: `tools: ${R.tools.join(", ")}\ndisallowedTools: ${R.disallowedTools.join(", ")}`,
        why: `with no tools: line it inherits every tool, Edit and Write included (rule subagent.tools.inherit-when-omitted), and the ${role} changes nothing (${R.template}).`,
      });
    }
  }
  if (R.canEdit && agent.tools === null && !agent.toolsUnreadable) {
    out.push({
      kind: "tools-inherit",
      action: "insert-before",
      line: fm.close,
      current: fm.lines[fm.close - 1],
      text: `tools: ${R.tools.join(", ")}`,
      why: `with no tools: line it inherits every tool, MCP servers included (rule subagent.tools.inherit-when-omitted); the ${role}'s roster in ${R.template} is these.`,
    });
  }
  if (agent.tools) {
    const beyond = agent.tools
      .filter((t) => !R.tools.includes(t) && !HARMLESS.has(t) && !t.startsWith("mcp__") && !EDIT_TOOLS.includes(t))
      .sort();
    if (beyond.length) {
      out.push({
        kind: "tools-beyond-roster",
        action: "replace",
        line: toolsAt,
        current: fm.lines[toolsAt - 1],
        text: `tools: ${agent.tools.filter((t) => !beyond.includes(t)).join(", ")}`,
        tools: beyond,
        why: `${beyond.join(", ")} ${beyond.length === 1 ? "is" : "are"} not in the ${role}'s roster (${R.template}: ${R.tools.join(", ")}); one job, the least tools that do it (T3). Keep ${beyond.length === 1 ? "it" : "them"} if this repo's use of the agent needs ${beyond.length === 1 ? "it" : "them"}.`,
      });
    }
  }
  if (R.when && !saysWhen(agent.description)) {
    const at = fm.keyLine("description");
    out.push({
      kind: "description-when",
      action: "extend",
      line: at,
      current: fm.lines[at - 1],
      text: R.when,
      why: "the description says what it does but never when to call it, and the description is what Claude Code reads to decide when to delegate (T3). The sentence is the role template's; name this repo's moment if it differs.",
    });
  }
  const said = `${agent.description}\n${agent.body}`;
  if (R.citation && !CITES.some((re) => re.test(said))) {
    out.push({
      kind: "citation-rule",
      action: "append",
      line: fm.last,
      current: fm.lines[fm.last - 1],
      text: R.citation,
      why: "nothing asks it to cite a path:line, an ADR or a command's output — an ungrounded agent gives advice true everywhere and actionable nowhere, and on a team task an uncited objection is dropped (T5).",
    });
  }
  if (grounding?.needed && R.grounding && !/AGENTS\.md/.test(said)) {
    const briefs = [...(grounding.root && !grounding.rootLoaded ? ["AGENTS.md"] : []), ...grounding.scoped];
    const shown = briefs.slice(0, 5).join(", ") + (briefs.length > 5 ? `, and ${briefs.length - 5} more` : "");
    out.push({
      kind: "grounding-agents-md",
      action: "append",
      line: fm.last,
      current: fm.lines[fm.last - 1],
      text: R.grounding,
      why: `this repo keeps rules in ${shown}, which no subagent loads on its own, and this agent never mentions AGENTS.md.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The roster's gaps, and the whole report
// ---------------------------------------------------------------------------------------------

/** The roles no mapped agent covers, in roster order. A covered role is never offered again (T6). */
export function rosterGaps(mapped) {
  const covered = new Set(mapped.map((m) => m?.role ?? m?.mapping?.role).filter(Boolean));
  return ROLES.filter((r) => !covered.has(r));
}

/**
 * The developer's answer, applied over the mapper's proposal: `as` is `{ path: role | null }`. A
 * mapping is a proposal the developer confirms (spec, "Existing agents" 3), so their answer wins —
 * `null` says "this is not that role", a role says "this one is". Refused: a path that is no agent
 * here, and a role the roster does not have. The verifier keeps its upgrade only as the Reviewer.
 */
function answered(mapping, agent, as, verifierPath) {
  if (!Object.hasOwn(as, agent.path)) return mapping;
  const role = as[agent.path];
  const upgrade = role === "reviewer" && verifierPath && agent.path === verifierPath ? mapping.upgrade : null;
  return { ...mapping, role, reason: "developer", remaining: role ? [role] : [], upgrade };
}

/**
 * Every agent graded, mapped and proposed; the roles covered and by whom; the gaps; what to ask
 * about. `null` without an index — an unanswered question, never an empty roster.
 *
 * `opts.verifierPath` is where /cortex stamps its verifier (T9); `opts.as` is the developer's own
 * mapping, `{ path: role | null }`, which outranks the mapper's. `opts.remembered` is the same
 * shape, read from an earlier run (`agent-answers.mjs`): `as` outranks it, and an entry naming no
 * agent here or no role is skipped rather than refused, because the agent may have been deleted
 * since. `answered` lists every agent the developer placed; none of them is `unmapped`, which is
 * the list of agents still to ask about.
 */
export function agentReport(root, index, opts = {}) {
  if (!index) return null;
  const text = opts.read ? null : textSource(root, { index });
  const read = opts.read ?? ((p) => text.read(p));
  const grounding = repoGrounding(index, read);
  const as = opts.as ?? {};
  const listed = repoAgents(root, index, opts);
  for (const [path, role] of Object.entries(as)) {
    if (!listed.some((a) => a.path === path)) throw new Error(`there is no agent at ${path} to map`);
    if (role !== null && !ROLES.includes(role)) throw new Error(`${role} is not a role — one of ${ROLES.join(", ")}, or none`);
  }
  const said = {};
  for (const [path, role] of Object.entries(opts.remembered ?? {})) {
    if (role === null || ROLES.includes(role)) said[path] = role; // a path with no agent here matches nothing below
  }
  Object.assign(said, as);
  const agents = listed.map((a) => {
    const mapping = answered(mapRole(a, { verifierPath: opts.verifierPath ?? null }), a, said, opts.verifierPath ?? null);
    return {
      path: a.path,
      name: a.name,
      description: a.description,
      tools: a.tools,
      disallowedTools: a.disallowedTools,
      loads: a.loads,
      findings: a.findings,
      mapping,
      proposals: proposeEdits(a, mapping.role, grounding),
    };
  });
  const covered = {};
  for (const role of ROLES) {
    const by = agents.filter((a) => a.mapping.role === role).map((a) => a.path);
    if (by.length) covered[role] = by;
  }
  return {
    agents,
    covered,
    gaps: rosterGaps(agents.map((a) => a.mapping)),
    unmapped: agents.filter((a) => a.loads && !a.mapping.role && a.mapping.reason !== "developer").map((a) => a.path),
    answered: agents.filter((a) => a.mapping.reason === "developer").map((a) => ({ path: a.path, role: a.mapping.role })),
    notLoaded: agents.filter((a) => !a.loads).map((a) => a.path),
    grounding,
  };
}
