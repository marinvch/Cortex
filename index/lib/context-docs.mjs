// What counts as a context document — asked once.
//
// Three modules answered this and gave three answers, and the answers reached one user from one
// command. On a repo whose only agent doc is `.cursorrules`:
//
//   cortex-findings .  → "#### No agent context file"
//   cortex-next .      → "· Reconcile the agent docs that were already here"
//
// Both printed by `cortex-findings`, because it ends with `nextLine()` as its footer. Under
// ADR 0006 the report is the install wizard's script, so a report contradicting its own footer is
// control flow disagreeing with itself, not a cosmetic wobble.
//
// The three answers were: `findings.mjs` checking two names by hand, `next.mjs` holding a list of
// six, and `review.mjs` matching a regex over four plus `docs/adr/`. None was wrong on its own
// terms; there were simply three terms.
//
// This module owns the VOCABULARY — which names are context documents. It deliberately does not own
// the observation of a particular repo: `readState` in next.mjs does that, reading the filesystem
// for root documents and the INDEX for scoped briefs, and its reasoning for the split is better
// than either of the others had ("so a brief under an ignored directory is not counted as coverage
// agents will never load"). Two different questions, two homes:
//
//   "is this path a context document?"      → here, a pure predicate
//   "what does THIS repo have, and where?"  → readState, one observation

import { isAdrPath } from "./adr.mjs";

/**
 * Root-level agent briefs, in the order a reader should think of them.
 *
 * The first three are files Cortex writes or adopts. The last three belong to other tools and are
 * the reason this list is longer than "AGENTS.md": a repo carrying one is NOT a repo where every
 * agent starts from zero, and saying so was a false claim rather than a strict one.
 */
export const AGENT_DOC_NAMES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  ".windsurfrules",
];

/** The three Cortex writes or routes. A `.cursorrules` is context; it is not a brief Cortex owns. */
export const CORTEX_BRIEF_NAMES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];

/**
 * The other tools' docs Cortex has a one-line shim for, so "replace it with the shim" is an offer
 * that exists. `/install-project` and `tools/cortex-init.sh` write it. `.cursorrules` and
 * `.windsurfrules` have no shim, and `CLAUDE.md` is not here because `/cortex` appends sections to
 * it on purpose: text of its own there is not a second brief.
 */
export const SHIMMED_DOC_NAMES = [".github/copilot-instructions.md"];

/** A pointer is this many lines of text at most. The shims in circulation are one. */
const POINTER_LINES = 3;

/** Above this many bytes a file is not a pointer whatever it says, and is not read to find out. */
export const POINTER_BYTES = 2048;

/**
 * Does this text only point at the root brief — a shim — or does it hold rules of its own?
 *
 * A pointer names `AGENTS.md` and is at most three non-blank lines. The rule is about shape, not
 * about one wording, because two shim texts are already in circulation and a person may write a
 * third. It cannot say a doc is stale: only that it is a second copy somebody has to keep true.
 */
export function pointsAtRootBrief(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.length > 0 && lines.length <= POINTER_LINES && /(^|[^\w.-])AGENTS\.md(?![\w-]|\.\w)/.test(text);
}

/**
 * Is this indexed path a document that GOVERNS code — a brief, the glossary, or an ADR?
 *
 * Scoped, on purpose. It matches `AGENTS.md` at any depth, because a leaf brief governs its
 * directory, and it does NOT match the third-party names above: those are root-level tool
 * configuration, and widening `citationDrift`'s input is how a check that found 7 real problems on
 * this repo went to 157 when its rules were loosened once before. If that changes, measure it
 * against a real repo first — several carry a `.github/copilot-instructions.md`.
 */
export function isContextDoc(path) {
  return /(^|\/)(AGENTS|CLAUDE|GEMINI|CONTEXT)\.md$/i.test(path) || isAdrPath(path);
}
