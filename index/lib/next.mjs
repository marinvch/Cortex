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
import { ENRICHED_REL } from "./enrich.mjs";
import { AGENT_DOC_NAMES } from "./context-docs.mjs";

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

function repoSkills(root) {
  const dir = join(root, ".claude", "skills");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
      .map((e) => e.name)
      .sort();
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
  const indexPath = join(root, ".cortex", "index", "index.json");
  const indexed = existsSync(indexPath);
  return {
    root,
    legacyEngine: LEGACY_ENGINES.filter((d) => has(root, d)),
    indexed,
    findings: filesIn(root, ".cortex/findings"),
    view: has(root, ".cortex/view/repo.html"),
    enriched: has(root, ENRICHED_REL),
    rootBrief: has(root, "AGENTS.md"),
    glossary: has(root, "CONTEXT.md"),
    adrs: filesIn(root, "docs/adr"),
    briefs: scopedBriefs(root, index),
    skills: repoSkills(root),
    memory: filesIn(root, ".cortex/memory"),
    priorDocs: priorAgentDocs(root),
    ...overrides,
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

  rows.push({
    id: "index",
    title: "Index the codebase",
    cmd: "/cortex-install",
    done: s.indexed,
    why: s.indexed
      ? ".cortex/index/index.json is present"
      : "nothing knows what is in this repo yet — this is the entry point",
  });

  rows.push({
    id: "findings",
    title: "Read the ranked findings report",
    cmd: "/cortex-install",
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
        : "root AGENTS.md, the shims, CONTEXT.md, docs/adr/",
  });

  rows.push({
    id: "brief",
    title: "Give critical areas their own scoped brief",
    cmd: "/cortex-brief <dir>",
    done: s.briefs.length > 0,
    why: s.briefs.length
      ? plural(s.briefs.length, "scoped brief") + ": " + s.briefs.join(", ")
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
    why: s.memory.length
      ? plural(s.memory.length, "digest") + " in .cortex/memory/ (committed)"
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
  return {
    root,
    state,
    steps: rows.map((r) => ({ ...r, next: r === next })),
    next,
    done: rows.filter((r) => r.done).length,
    total: rows.length,
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
