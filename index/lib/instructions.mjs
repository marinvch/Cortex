// index/lib/instructions.mjs — which of a repo's scoped AGENTS.md briefs Claude Code reads on its own.
//
// Claude Code reads AGENTS.md directly only when no CLAUDE.md counts at or above the working
// directory, and only then does a subdirectory's AGENTS.md load as Claude opens a file there. The
// shim /cortex-scaffold writes (CLAUDE.md holding `@AGENTS.md`) is a CLAUDE.md that counts, so under
// it the scoped briefs are reached through the root's routing table and no other way.
//
// That is a fact about the repo and not a finding: the setting that loads both files is read from
// user or managed settings and ignored in a project's, so no change to the repo fixes it. It is
// reported as one sentence in the findings report and in cortex-next, and both read it from here so
// they cannot say different things. The rules and their sentences are in core/claude-code.js.

import { posix } from "node:path";
import { rule, limit } from "../../core/claude-code.js";

/** The files that count as "a CLAUDE.md" in a directory — any one stops AGENTS.md loading directly. */
const COUNTING = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

/**
 * `briefs` are the repo's scoped AGENTS.md paths (never the root one); `exists(rel)` answers for a
 * repo-relative path. Returns `{ counting, leaves }` when a root CLAUDE.md counts and at least one
 * brief is left to the routing table, else null. A brief whose own directory holds a CLAUDE.md is
 * not listed: Claude reads that CLAUDE.md there, and whether it imports the brief is the repo's
 * business.
 */
export function leavesNotLoaded({ briefs, exists }) {
  const counting = COUNTING.filter((p) => exists(p));
  if (!counting.length) return null;
  const leaves = briefs
    .filter((p) => !COUNTING.some((c) => exists(posix.join(posix.dirname(p), c))))
    .sort();
  return leaves.length ? { counting, leaves } : null;
}

/** The one sentence both surfaces print, citing the rule it rests on. */
export function leavesNote(fact) {
  const n = fact.leaves.length;
  const r = rule("agents-md.default-needs-no-claude-md");
  return (
    `${n} scoped brief${n === 1 ? "" : "s"} load${n === 1 ? "s" : ""} through the routing table only: ` +
    `${fact.counting[0]} at the root keeps Claude Code from reading ${n === 1 ? "it" : "them"} on its own. ` +
    `A developer can set Project instructions to \`${limit("agents-md.setting-loads-both")}\` in /config to load both; ` +
    `a repo's own settings cannot. Rule \`${r.id}\` (${r.source}).`
  );
}
