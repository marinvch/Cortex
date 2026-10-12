// rule-ledger.mjs — every rule a repo's briefs state, and which test files each one names.
//
// A brief is where a repo writes down what must stay true. Some of those sentences end by naming
// the test that fails when they stop being true, and some rest on the sentence alone. Nothing told
// the two apart: `review.mjs` reads the briefs to judge a change, and `citationDrift` asks whether
// the paths they name still exist. Neither asks what a rule points at.
//
// This finds and cites, and never judges, for the reason `review.mjs` gives. A row says what the
// rule NAMES. It does not say the rule is enforced, and it does not say it is not: deciding that a
// test covers a sentence needs a model, and a gotcha ("import resolution is regex-based") is a
// fact no test could pin. So no field or state here carries the word, and a test holds that.
//
// Direction of error is chosen: a row may say a rule names no test when it does (a directory, a
// file name two files share), and never the reverse. Telling someone a rule is pinned when it is
// not costs more than a second look.
//
// What a rule is, is a PLACE: a top-level list item in a section whose heading says invariants,
// gotchas or rules. Those are the two sections `templates/target-AGENTS.md` stamps, plus the word
// this repo's own briefs use. The first version read a FORMAT instead, any item opening with bold
// text, and it was wrong in both directions on the first real repos it met: every bold-led item in
// vercel/ai's brief was a definition ("**Node.js**: v22.13+"), and the template Cortex itself
// stamps writes its invariants as plain items, so a scaffolded repo would have listed nothing.
// Bold is one repo's habit. The heading is what the product writes.
//
// A brief that keeps its rules under another heading, or in paragraphs, yields no rows. The caller
// is told how many briefs were read and how many held such a section, so that an empty ledger is
// not taken for a clean one.
//
// The citation rules are `review.mjs`'s, imported and not copied. `looksLikePath` took that module
// from 157 findings to 7, and a second copy would not inherit the next fix. One rule is added: a
// bare file name counts when exactly one indexed file carries it, because a leaf brief writes
// "`build.test.mjs` asserts two runs agree" with no directory, and the index knows whether that
// name identifies one file.

import { CITATION_IN_CODE, CITATION_IN_LINK, dirOf, looksLikePath, normalizeFrom } from "./review.mjs";
import { pointsAtRootBrief } from "./context-docs.mjs";
import { canBeTest } from "./langs.mjs";

/** The three names a brief goes by. `CONTEXT.md` defines terms and an ADR records history. */
const BRIEF = /(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/i;

/** A heading that opens a rules section. Whole words, so "Rulebook" and "Overrules" do not. */
const RULES_HEADING = /\b(invariants?|gotchas?|rules?)\b/i;

/** A file name with an extension and no directory: `build.test.mjs`. */
const BARE_FILE = /^[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,6}$/;

/** What a template leaves where a rule goes: `- {{an invariant, and why it holds}}`. */
const PLACEHOLDER = /^\{\{.*\}\}$/;

const TEXT_SHOWN = 120;

/** `CLAUDE.md` holding `@AGENTS.md` is the root brief under another name, not a second one. */
function isShim(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return pointsAtRootBrief(text) || (lines.length <= 1 && /^@\S+\.md$/.test(text.trim()));
}

/**
 * The rules a markdown text states: `{ sections, items: [{ line, section, lines }] }`.
 *
 * A rules section runs from its heading to the next heading at the same level or above, so a
 * subsection belongs to it and carries its own name. `sections` counts the headings that opened
 * one.
 *
 * An item runs from its `- ` at column 0 through every indented line after it, across blank lines:
 * an indented paragraph under an item is still that item, as markdown reads it. Text at column 0
 * ends it. Lines inside a code fence are neither headings nor items: a brief that shows an example
 * rule is not stating one.
 */
function readRules(text) {
  const items = [];
  const open = []; // the headings above this line: { level, name, rules }
  let sections = 0;
  let cur = null;
  let fenced = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) {
      fenced = !fenced;
      if (!/^\s/.test(l)) cur = null;
      continue;
    }
    if (fenced) continue;
    const h = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      while (open.length && open.at(-1).level >= level) open.pop();
      const name = h[2].replace(/[`*_]/g, "").trim();
      const rules = RULES_HEADING.test(name);
      if (rules) sections++;
      open.push({ level, name, rules });
      cur = null;
    } else if (/^- /.test(l)) {
      const inRules = open.some((s) => s.rules);
      cur = inRules && !PLACEHOLDER.test(l.slice(2).trim()) ? { line: i + 1, section: open.at(-1).name, lines: [l] } : null;
      if (cur) items.push(cur);
    } else if (cur && /^\s+\S/.test(l)) {
      cur.lines.push(l);
    } else if (l.trim() !== "") {
      cur = null;
    }
  }
  return { sections, items };
}

/**
 * ruleLedger(index, { readText }) → { hasBriefs, briefs, withSections, unread, rows, counts }
 *
 * `readText(path)` returns a document's contents or null. A row is
 * `{ doc, line, section, text, state, tests, others }`, with `state` one of `test` (the item names
 * at least one file the index marks as a test), `other` (it names files, none of them a test) and
 * `none`. `withSections` is how many of the briefs read hold a rules section at all.
 */
export function ruleLedger(index, { readText = () => null } = {}) {
  const known = new Map(index.files.map((f) => [f.path, f]));
  const byBase = new Map(); // basename → [paths]
  for (const f of index.files) {
    const base = f.path.split("/").pop();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f.path);
  }

  /** The indexed file a citation names, or null. Doc-relative, then repo-root, then a unique name. */
  const resolve = (home, cited) => {
    if (looksLikePath(cited)) {
      const near = normalizeFrom(home, cited);
      if (known.has(near)) return near;
      return known.has(cited) ? cited : null;
    }
    if (!BARE_FILE.test(cited)) return null;
    const near = normalizeFrom(home, cited);
    if (known.has(near)) return near;
    if (known.has(cited)) return cited;
    const named = byBase.get(cited) || [];
    return named.length === 1 ? named[0] : null;
  };

  const docs = index.files
    .map((f) => f.path)
    .filter((p) => BRIEF.test(p) && !p.startsWith("templates/"))
    .sort((a, b) => a.localeCompare(b));

  const rows = [];
  const unread = [];
  let briefs = 0;
  let withSections = 0;
  for (const doc of docs) {
    const text = readText(doc);
    if (text === null) {
      unread.push(doc);
      continue;
    }
    if (isShim(text)) continue;
    briefs++;
    const home = dirOf(doc);
    const { sections, items } = readRules(text);
    if (sections) withSections++;
    for (const item of items) {
      const tests = new Set();
      const others = new Set();
      for (const l of item.lines) {
        for (const re of [CITATION_IN_CODE, CITATION_IN_LINK]) {
          for (const m of l.matchAll(re)) {
            const cited = m[1].replace(/[#?].*$/, "").replace(/^\.\//, "");
            const path = cited && resolve(home, cited);
            if (!path || path === doc) continue;
            (known.get(path).isTest && canBeTest(path) ? tests : others).add(path);
          }
        }
      }
      rows.push({
        doc,
        line: item.line,
        section: item.section,
        text: item.lines[0].replace(/^- /, "").trim().slice(0, TEXT_SHOWN),
        state: tests.size ? "test" : others.size ? "other" : "none",
        tests: [...tests].sort(),
        others: [...others].sort(),
      });
    }
  }

  const counts = { test: 0, other: 0, none: 0 };
  for (const r of rows) counts[r.state]++;
  return { hasBriefs: briefs > 0, briefs, withSections, unread, rows, counts };
}
