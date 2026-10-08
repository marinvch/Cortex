// next.mjs — where a repo is in the Cortex sequence, and what to run next.
//
// The problem this solves is not technical. Every Cortex CLI and skill knows its own job; none of
// them knew the ORDER, so a user who ran /cortex-install got a table of eleven commands and no
// answer to "which one now". A table is a menu. This is a position.
//
// Every `done` here is a filesystem fact, never an inference. A step whose completion cannot be
// checked is reported `optional` and stays visible — claiming a step is finished when nothing on
// disk says so is worse than admitting the sequence cannot tell.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultIndexPath } from "./format.mjs";
import { ENRICHED_REL } from "./enrich.mjs";
import { AGENT_DOC_NAMES } from "./context-docs.mjs";
import { LOOP_STAMPS, loopPlan } from "./loop.mjs";
import { adrLocation } from "./adr.mjs";
import { listRepoSkills, skillDrift } from "./skill-drift.mjs";
import {
  adoptionCandidates, olderPlugin, readStamps, runningCortex, stampStatus, stampsIgnoreRule, STAMPS_REL,
} from "./stamps.mjs";
import { sectionReport } from "./sections.mjs";
import { leavesNotLoaded, leavesNote } from "./instructions.mjs";

// The templates this Cortex ships — what a stamped file is compared against. Next to this file in a
// clone and in an installed plugin alike.
const TEMPLATES_DIR = fileURLToPath(new URL("../../templates/", import.meta.url));

// Facts about the artifact chain, borrowed rather than recomputed. `loop.mjs` owns which artifacts
// a repo is missing and why; this file owns the order of the sequence. Two modules each keeping
// their own list is how the same run prints two answers, so the sequence asks.
//
// `loopServed: null` is a third state and not a zero: it means the plan could not be read at all,
// which the row renders as a description of the step rather than as a score of 0. A repo told it
// has 0 of 0 loop artifacts has been given a number that looks like a measurement.
function loopFacts(root, index) {
  try {
    const plan = loopPlan(root, index);
    return {
      loopServed: plan.served,
      loopTotal: plan.total,
      loopComplete: plan.complete,
      loopMissing: plan.missing.map((m) => m.id),
    };
  } catch {
    return { loopServed: null, loopTotal: null, loopComplete: false, loopMissing: null };
  }
}

// The two loop rows one pass of `/cortex` cannot close, because each waits on something only time
// produces. Both are blocked until that pass writes their prerequisite (CLAUDE.md, REVIEW.md), so
// they surface as missing only AFTER it — and the loop row used to answer that with "Next → /cortex"
// again, forever, on a repo whose owner had rightly deferred bands for want of a metric. Each gets
// its own row naming its own command, and says what it is waiting for.
//
// evals is not optional: a suite gating the agent's own configuration is worth having as soon as one
// real task exists. bands is: a library with no production metric may never have one, and a
// sequence that stays open until it does trains the reader to ignore it.
const SECOND_ROUND = {
  evals: {
    title: "Seed the agent evals from real past tasks",
    cmd: "/cortex evals",
    optional: false,
    why: "evals/ has no cases yet — each is a real task the team already did, so this waits for task history; invented cases prove nothing",
  },
  bands: {
    title: "Put a control band on one production metric",
    cmd: "/cortex bands",
    optional: true,
    why: "needs one metric with a stable history to band — a repo with no production metric has nothing to put here, and that is a finished state",
  },
};

// The list moved to context-docs.mjs. This file knew six names and findings.mjs knew two, and both
// answers reached one user from one command — `cortex-findings` prints `nextLine()` as its footer.
const AGENT_DOCS = AGENT_DOC_NAMES;

const LEGACY_ENGINES = [".ai-os", ".github/ai-os"];

function has(root, rel) {
  return existsSync(join(root, rel));
}

function filesIn(root, rel, ext = ".md") {
  const dir = join(root, rel);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
  } catch {
    return [];
  }
}

// The newest digest in .cortex/memory/, as the date its filename carries, or null for a memory
// nobody has started. One file per day is the store's whole shape (ADR 0002), so the name IS the
// date and reading it costs no clock.
//
// A maximum rather than the last element. Note honestly what that buys: `filesIn` sorts and ISO
// dates sort lexically, so today `at(-1)` returns the same value for every input that can reach
// here — the two are indistinguishable from outside this module and no test can tell them apart.
// The maximum is kept because it survives `filesIn` ever returning unsorted, not because anything
// currently proves it. The filter is the half that does carry weight: a stray README.md sorts above
// every real digest, and without it the evidence would name a file that is not a digest.
//
// It does NOT return an age. A duration needs `now`, and this module is deterministic by the same
// rule as the index: same tree, same answer, tomorrow included. The sequence states the date and
// the reader supplies today — the division `readEnrichment` already draws, where the reader owns
// the fact and the caller owns the policy.
function latestDigest(files) {
  const dates = files
    .map((f) => /^(\d{4}-\d{2}-\d{2})\.md$/.exec(f))
    .filter(Boolean)
    .map((m) => m[1]);
  return dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null;
}

// Scoped briefs are <dir>/AGENTS.md anywhere but the root. Prefer the index over the filesystem so
// a brief under an ignored directory is not counted as coverage that agents will never load.
function scopedBriefs(root, index) {
  const fromIndex = (index?.files ?? [])
    .map((f) => f.path)
    .filter((p) => p.endsWith("/AGENTS.md"));
  if (fromIndex.length) return fromIndex.sort();
  const out = [];
  const walk = (rel, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(join(root, rel || "."), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const child = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(child, depth + 1);
      else if (e.name === "AGENTS.md" && rel) out.push(child);
    }
  };
  walk("", 0);
  return out.sort();
}

// skill-drift.mjs lists them too, and one listing keeps "which skills exist" and "which of them
// drifted" from disagreeing about a directory that holds no SKILL.md.
function repoSkills(root) {
  return listRepoSkills(root).map((s) => s.name);
}

// The skills whose text the repo on disk now contradicts — a path gone, "no tests" beside a test
// suite, a script nobody declares (#462). Only with an index: without one nothing is provable, and
// `null` keeps "not checked" apart from "checked, clean". A failure here must never cost the rest of
// the sequence, so it degrades to not checked.
function driftedSkills(root, index) {
  if (!index) return null;
  try {
    return skillDrift(root, index)?.drifted ?? null;
  } catch {
    return null;
  }
}

// The stamp record, read the way `cortex-stamps.mjs . --json` reads it (spec S4). `stamps` is the
// per-file status, or null with no record; `stampsAdopt` is what an older /cortex left and nothing
// recorded; `stampsIgnored` is the rule that keeps the record out of git; `stampsOlderPlugin` is set
// when the record was written by a newer Cortex than this one (spec S5). Only asked when there is
// something to ask about, so a repo with neither a record nor a loop file pays one stat per location
// and reads exactly as it did before the record existed. A damaged record is carried as an error,
// never degraded to "no record": that would offer adoption over a record the team still has.
function stampFacts(root) {
  const none = { stamps: null, stampsAdopt: [], stampsIgnored: null, stampsOlderPlugin: null, stampsError: null };
  try {
    const record = readStamps(root);
    const adopt = adoptionCandidates(root, record, LOOP_STAMPS);
    if (!record && !adopt.length) return none;
    return {
      stamps: record ? stampStatus({ repoRoot: root, record, templatesDir: TEMPLATES_DIR }) : null,
      stampsAdopt: adopt,
      stampsIgnored: stampsIgnoreRule(root),
      stampsOlderPlugin: olderPlugin(record, runningCortex()),
      stampsError: null,
    };
  } catch (e) {
    return { ...none, stampsError: e.message };
  }
}

// The sections Cortex wrote into a shared file (#505): the team playbook in CLAUDE.md. Only the ones
// a pass has something to say about — outdated, edited, duplicated — so a repo without one, or with
// a current one, reads exactly as before. A failure here costs this row only, never the sequence.
function sectionFacts(root) {
  try {
    return sectionReport(root).filter((s) => ["outdated", "edited", "duplicate"].includes(s.state));
  } catch {
    return [];
  }
}

// An agent doc that predates Cortex needs reconciling BEFORE scaffold rather than after — otherwise
// the target ends up with a curated file plus an AGENTS.generated.md to merge by hand.
//
// "Predates" is decided by CONTEXT.md at the call site, NOT by comparing mtimes against the index.
// The mtime version passed on Windows and failed on Linux: both files land in the same millisecond
// there, so `mtime < indexedAt` was false and a hand-written CLAUDE.md read as Cortex's own. A
// filesystem clock is the wrong witness for "who wrote this" — the scaffold writes CONTEXT.md, so
// its absence is the durable fact, and it cannot be raced.
function priorAgentDocs(root) {
  return AGENT_DOCS.filter((d) => has(root, d));
}

/**
 * Read a target repo's Cortex state off disk.
 * Pure observation — it opens nothing it does not need and writes nothing at all.
 *
 * `overrides` is for a caller that is mid-write and knows a fact the filesystem does not have yet —
 * `cortex-view` rendering the sequence into the very page it is about to save. That is still a
 * fact, not a guess, and it is the only kind of override allowed here: never use it to assume a
 * step someone else is supposed to run.
 */
export function readState(root, index = null, overrides = {}) {
  const indexPath = defaultIndexPath(root);
  const indexed = existsSync(indexPath);
  const memory = filesIn(root, ".cortex/memory");
  // docs/adr/ unless docs/ is a published site — adr.mjs owns that answer and its evidence.
  const adr = adrLocation(root);
  const briefs = scopedBriefs(root, index);
  return {
    root,
    legacyEngine: LEGACY_ENGINES.filter((d) => has(root, d)),
    indexed,
    findings: filesIn(root, ".cortex/findings"),
    view: has(root, ".cortex/view/repo.html"),
    enriched: has(root, ENRICHED_REL),
    rootBrief: has(root, "AGENTS.md"),
    glossary: has(root, "CONTEXT.md"),
    adrs: filesIn(root, adr.dir),
    adrDir: adr.dir,
    adrWhy: adr.why,
    briefs,
    leaves: leavesNotLoaded({ briefs, exists: (p) => has(root, p) }),
    skills: repoSkills(root),
    skillDrift: driftedSkills(root, index),
    memory,
    memoryLatest: latestDigest(memory),
    priorDocs: priorAgentDocs(root),
    ...stampFacts(root),
    sections: sectionFacts(root),
    ...loopFacts(root, index),
    ...overrides,
  };
}

function stampsStep(s, plural) {
  const base = { id: "stamps", cmd: "/cortex", done: false };
  const ignored = s.stampsIgnored
    ? `; ${STAMPS_REL} is ignored by ${s.stampsIgnored.source}:${s.stampsIgnored.line}, so the team does not share it`
    : "";
  if (s.stampsError) {
    return { ...base, title: "Repair the stamp record", why: `${s.stampsError} — nothing Cortex stamped can be checked or updated until it reads` };
  }
  // Before any count: an older plugin compares the files against its own older templates, so "N to
  // update" would be its misreading, and acting on it would put those older templates back. Blocking,
  // because the fix is outside the repo and every stamp answer here waits on it.
  if (s.stampsOlderPlugin) {
    return {
      ...base,
      cmd: s.stampsOlderPlugin.commands.join(" && "),
      blocking: true,
      title: "Update the Cortex plugin — a newer one stamped this repo",
      why: s.stampsOlderPlugin.advice + (ignored ? ` Also, ${ignored.slice(2)}.` : ""),
    };
  }
  if (s.stampsAdopt.length) {
    const list = s.stampsAdopt.map((a) => a.path);
    return {
      ...base,
      title: "Adopt the loop files an earlier Cortex stamped",
      optional: true,
      why:
        `${plural(list.length, "loop file")} where /cortex writes them and no ${STAMPS_REL} ` +
        `(${list.slice(0, 4).join(", ")}${list.length > 4 ? ", …" : ""}) — adopting records each as a conflict, ` +
        `compared with this release's template before anything changes${ignored}`,
    };
  }
  const count = (states) => (s.stamps ?? []).filter((f) => states.includes(f.state)).length;
  const parts = [
    [count(["update"]), "to update"],
    [count(["review", "conflict"]), "to decide file by file"],
    [count(["missing"]), "missing"],
    [count(["retired"]), "retired"],
  ].filter(([n]) => n > 0);
  if (!parts.length && !ignored) return null;
  return {
    ...base,
    title: "Bring the files Cortex stamped up to date",
    optional: count(["update", "review", "conflict"]) === 0,
    why:
      (parts.length ? parts.map(([n, what]) => `${n} ${what}`).join(", ") : "every stamped file is current") +
      ` — \`cortex-stamps.mjs .\` lists each${ignored}`,
  };
}

// A section Cortex appended to a shared file, against this release (#505). Required only when one is
// an earlier release's text, untouched — a decision /cortex can make, inside its one confirmation. An
// edited or duplicated section is listed and optional: it is the team's, never overwritten, and a
// required row over the team's own text would never clear.
function sectionsStep(s) {
  const list = s.sections ?? [];
  if (!list.length) return null;
  return {
    id: "sections",
    title: "Bring the sections Cortex wrote into CLAUDE.md up to date",
    cmd: "/cortex",
    done: false,
    optional: !list.some((x) => x.state === "outdated"),
    why: list.map((x) => x.why).join("; ") + " — `cortex-section.mjs .` shows the diff",
  };
}

// One row per step. `done` is a fact; `blocking` jumps the queue; `optional` steps never become
// `next` and never hold the sequence up.
function steps(s) {
  const rows = [];
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

  if (s.legacyEngine.length) {
    rows.push({
      id: "migrate",
      title: "Move off the retired engine",
      cmd: "/migrate-engine",
      done: false,
      blocking: true,
      why: "found " + s.legacyEngine.join(", ") + " — harvest its memory into AGENTS.md before anything else writes there",
    });
  }

  // Both name `/cortex`, not `/cortex-install`. The sequence below is what a user gets when they
  // walk it a command at a time, and the whole point of the front door is that they do not have
  // to: one run of `/cortex` satisfies index, findings, scaffold, brief and skills in one pass.
  // Naming the sub-step here would send a user who asked "what now" back to the menu this file
  // exists to replace. `/cortex-install` is still callable and still correct; it is just no longer
  // the answer to "where do I start".
  rows.push({
    id: "index",
    title: "Index the codebase",
    cmd: "/cortex",
    done: s.indexed,
    why: s.indexed
      ? ".cortex/index/index.json is present"
      : "nothing knows what is in this repo yet — this is the entry point",
  });

  rows.push({
    id: "findings",
    title: "Read the ranked findings report",
    cmd: "/cortex",
    done: s.findings.length > 0,
    why: s.findings.length
      ? ".cortex/findings/" + s.findings[s.findings.length - 1]
      : "the report is the script for every step below it",
  });

  rows.push({
    id: "view",
    title: "See the repo as a graph",
    // The slash command, not the node line. `${CLAUDE_PLUGIN_ROOT}` is set inside a skill and
    // nowhere else, so a plugin user who types the raw command in their own terminal gets nothing —
    // and the path into the plugin cache is version-pinned, so it breaks on the next update.
    cmd: "/cortex-view",
    done: s.view,
    optional: true,
    why: s.view
      ? ".cortex/view/repo.html — open it in a browser"
      : "an Obsidian-style map of the index: files, imports, layers, gaps",
  });

  // Only while the context layer is still unwritten. CONTEXT.md is the witness: the scaffold writes
  // it, so once it exists an AGENTS.md here is Cortex's own and not a doc to reconcile.
  if (s.priorDocs.length && !(s.rootBrief && s.glossary)) {
    rows.push({
      id: "reconcile",
      title: "Reconcile the agent docs that were already here",
      cmd: "/optimize-context",
      done: false,
      why: s.priorDocs.join(", ") + " was not written by Cortex — slim it BEFORE scaffold, or you get two files to merge by hand",
    });
  }

  rows.push({
    id: "scaffold",
    title: "Write the context layer",
    cmd: "/cortex-scaffold",
    done: s.rootBrief && s.glossary,
    why:
      s.rootBrief && s.glossary
        ? "AGENTS.md + CONTEXT.md are in place"
        : `root AGENTS.md, the shims, CONTEXT.md, ${s.adrDir ?? "docs/adr"}/`,
  });

  rows.push({
    id: "brief",
    title: "Give critical areas their own scoped brief",
    cmd: "/cortex-brief <dir>",
    done: s.briefs.length > 0,
    // The note is a fact about how they load, not a step: nothing in the repo changes it.
    why: s.briefs.length
      ? plural(s.briefs.length, "scoped brief") + ": " + s.briefs.join(", ") + (s.leaves ? ". " + leavesNote(s.leaves) : "")
      : "one leaf per area that earns one — never a blanket pass",
  });

  rows.push({
    id: "skills",
    title: "Add skills that fit this stack",
    cmd: "/cortex-skills",
    done: s.skills.length > 0,
    why: s.skills.length
      ? plural(s.skills.length, "skill") + " in .claude/skills/: " + s.skills.join(", ")
      : "proposed from what the index actually detected, not from a template",
  });

  // Only when a skill provably contradicts the repo. `done` on the skills row above stays a file fact
  // — the skill exists — and this row asks the second question, the one a re-run of /cortex used to
  // skip: is what it says still true. Required, because a skill is read as an instruction every time
  // it fires. It clears the moment the lines are fixed, by /cortex-skills or by hand.
  if (s.skillDrift?.length) {
    const lines = s.skillDrift.reduce((n, d) => n + d.findings.length, 0);
    rows.push({
      id: "skill-drift",
      title: "Refresh the skills the repo has moved away from",
      cmd: "/cortex-skills",
      done: false,
      why:
        s.skillDrift.map((d) => `${d.skill} (${d.findings.length}${d.editedNote ? `; ${d.editedNote}` : ""})`).join(", ") +
        ` — ${plural(lines, "line")} the repo on disk contradicts; \`cortex-skills.mjs .\` lists each`,
      drift: s.skillDrift,
    });
  }

  // The files /cortex stamped, against this release's templates (spec S4). The row exists only while
  // something needs attention, so a repo with no record and no loop file reads exactly as before.
  // Required only where a /cortex pass has a decision to make — an update to apply, a file to compare
  // (`review`, `conflict`), or a record it cannot read. A file someone deleted, a retired template
  // and an ignored record are listed but optional: each can be a deliberate choice, and a step that
  // stays open over a choice trains the reader to ignore the sequence. Adoption is optional for the
  // same reason — declining it leaves no trace, so a required row would never clear. `edited` is
  // silent: the team changed it and the template did not, so it is theirs.
  const stampsRow = stampsStep(s, plural);
  if (stampsRow) rows.push(stampsRow);
  const sectionsRow = sectionsStep(s);
  if (sectionsRow) rows.push(sectionsRow);

  // The loop, as one row rather than eight. `loop.mjs` owns which artifacts a repo is missing and
  // why; duplicating those rows here would give the user two lists that disagree the first time one
  // of them changed. This row says only whether the chain is closed, and hands off for the detail.
  //
  // The first pass is what one `/cortex` run can close. The rows in SECOND_ROUND are carved out of it
  // and follow as rows of their own, so "Next → /cortex" is never the answer to a gap that another
  // `/cortex` run cannot close.
  const missing = s.loopMissing ?? null;
  const firstPass = missing ? missing.filter((id) => !SECOND_ROUND[id]) : null;
  const firstPassDone = s.loopComplete || (firstPass !== null && firstPass.length === 0);
  rows.push({
    id: "loop",
    title: "Close the artifact chain — intent → spec → plan → diff → PR → breach",
    cmd: "/cortex",
    done: firstPassDone,
    why:
      s.loopServed === null
        ? "the SDLC loop artifacts: REVIEW.md, the verification block, the verifier, the agent team, intent/, hooks"
        : s.loopComplete
          ? `all ${s.loopTotal} loop artifacts that apply here are in place`
          : firstPassDone
            ? `${s.loopServed} of ${s.loopTotal} in place — the rest wait on history, below`
            : `${s.loopServed} of ${s.loopTotal} in place — run \`cortex-loop.mjs .\` for which and why`,
  });
  // Only once the first pass is done: before that, `/cortex` above is the honest next command and
  // will reach these itself.
  if (firstPassDone && missing) {
    for (const id of missing.filter((m) => SECOND_ROUND[m])) {
      rows.push({ id, ...SECOND_ROUND[id], done: false });
    }
  }

  rows.push({
    id: "enrich",
    title: "Add semantic summaries on top of the index",
    cmd: "/cortex-enrich",
    done: s.enriched,
    optional: true,
    why: s.enriched
      ? ENRICHED_REL + " is present"
      : "costs tokens; worth it on a large unfamiliar repo",
  });

  rows.push({
    id: "memory",
    title: "Start the shared memory",
    cmd: "/dream",
    done: s.memory.length > 0,
    optional: true,
    // `done` stays a file fact — "was this ever started" is settled by a file existing, which is
    // this module's rule. Currency is the other question and it belongs in the evidence: a memory
    // last written weeks ago and one written this morning printed the same sentence, so the one
    // number a reader needed was the one number missing.
    why: s.memory.length
      ? plural(s.memory.length, "digest") + " in .cortex/memory/ (committed), newest " + s.memoryLatest
      : "end-of-day digest the whole team reads tomorrow",
  });

  return rows;
}

// Per-change rituals — not a sequence, a lookup. They never appear as "next" because they are
// triggered by what you are doing, not by how far along the install is.
export const PER_CHANGE = [
  { when: "starting a risky feature", cmd: "/analyze-spec" },
  { when: "before touching files", cmd: "/cortex-impact <files>" },
  { when: "before committing", cmd: "/cortex-review" },
  { when: "chasing a bug you cannot explain", cmd: "/diagnosing-bugs" },
  { when: "back after time away", cmd: "/catch-me-up" },
];

/**
 * The ordered runbook plus the single next command.
 * `next` is the first blocking step, else the first unfinished non-optional step, else null.
 */
export function nextSteps(root, index = null, overrides = {}) {
  const state = readState(root, index, overrides);
  const rows = steps(state);
  const blocking = rows.find((r) => r.blocking && !r.done);
  const next = blocking ?? rows.find((r) => !r.done && !r.optional) ?? null;
  // The count is of REQUIRED steps. Optional ones are listed with their tick but never counted, for
  // the same reason they never become next: they do not hold the sequence up, so they must not move
  // the number that says how far along it is. Counting them made two surfaces disagree about one
  // repo — the viewer ticks "see the repo as a graph" because it is that page (an override
  // `readState` allows), so it printed 6 of 9 while cortex-next, run a moment earlier, printed 5.
  const required = rows.filter((r) => !r.optional);
  return {
    root,
    state,
    steps: rows.map((r) => ({ ...r, next: r === next })),
    next,
    done: required.filter((r) => r.done).length,
    total: required.length,
    complete: !next,
    perChange: PER_CHANGE,
  };
}

/** One line for a CLI footer: the single thing to run now. */
export function nextLine(root, index = null) {
  const { next } = nextSteps(root, index);
  if (!next) return "Next → sequence complete. Per change: /cortex-impact before, /cortex-review before committing.";
  return "Next → " + next.cmd + "   (" + next.title.toLowerCase() + ")";
}
