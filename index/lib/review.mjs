// Which of this repo's own context documents govern a change — and which of them the change just
// made wrong.
//
// Cortex writes `AGENTS.md`, `CONTEXT.md` and ADRs, and until now nothing ever read them back. The
// context layer was write-only: it could be generated, audited for bloat, and never once consulted
// to judge a change.
//
// The second half is the one no other tool does. Documentation drifts silently because a diff
// touches code and nobody re-reads the prose describing it. Two examples from this repo's own
// history, both found by a human reading rather than by any check:
//
//   index/AGENTS.md said "Coverage uses two signals" for weeks after it used three
//   AGENTS.md pointed at `mcp/lib/scrub.js` for months after scrub moved to `core/`
//
// Neither broke a test. Both misled the next agent that read them, which is the entire cost of a
// context layer being wrong rather than merely absent.
//
// Deterministic, per index/AGENTS.md: this finds and cites, it never judges. Deciding whether a
// change actually violates a documented rule is the ritual's job, and it needs a model.

import { isContextDoc } from "./context-docs.mjs";

// isContextDoc is imported from context-docs.mjs, which owns the vocabulary for all three readers.
// This module keeps its purity: it classifies INDEXED PATHS and never touches the filesystem, which
// is why it consumes the predicate rather than `readState`. See the note at the top of that file.

/** The directory a path sits in, "" for repo root. */
function dirOf(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * An `AGENTS.md` governs a file when it sits at or above that file's directory. The NEAREST one
 * wins for detail, but the root always applies too — that is what the routing table in a Cortex
 * scaffold means, and a review that consults only the leaf misses the repo-wide invariants.
 */
function governingBriefs(contextDocs, changedPath) {
  const dir = dirOf(changedPath);
  return contextDocs
    .filter((d) => /(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/i.test(d))
    .filter((d) => {
      const home = dirOf(d);
      return home === "" || dir === home || dir.startsWith(home + "/");
    })
    .sort((a, b) => dirOf(b).length - dirOf(a).length);
}

/**
 * reviewContext(index, changed, { readText }) → { changed, unknown, briefs, glossary, adrs, stale }
 *
 * `readText(path)` returns a document's contents or null. Everything below is evidence for a human
 * or a model to weigh; nothing here concludes that a change is wrong.
 */
export function reviewContext(index, changed, { readText = () => null } = {}) {
  const known = new Set(index.files.map((f) => f.path));
  const contextDocs = index.files.map((f) => f.path).filter(isContextDoc);

  const seeds = [];
  const unknown = [];
  for (const c of changed) {
    const p = String(c).split("\\").join("/").replace(/^\.\//, "");
    (known.has(p) ? seeds : unknown).push(p);
  }

  // Briefs that govern at least one changed file, nearest first, each carrying what it covers.
  const briefHits = new Map();
  for (const p of seeds) {
    for (const b of governingBriefs(contextDocs, p)) {
      if (!briefHits.has(b)) briefHits.set(b, []);
      briefHits.get(b).push(p);
    }
  }
  const briefs = [...briefHits.entries()]
    .map(([path, covers]) => ({ path, covers: covers.sort(), dir: dirOf(path), scope: dirOf(path) || "(repo root)" }))
    // Sort on the DIRECTORY, not the display label — "(repo root)" is eleven characters and sorted
    // the root brief ahead of every leaf, which is the exact opposite of "nearest scope first".
    .sort((a, b) => b.dir.length - a.dir.length || a.path.localeCompare(b.path))
    // A shim (`CLAUDE.md` holding only `@AGENTS.md`) is the same document under another name.
    // Listing all three makes the root look like three separate authorities.
    .filter((b) => {
      const text = readText(b.path);
      const isShim = text !== null && text.trim().split("\n").filter(Boolean).length <= 1 && /^@\S+\.md$/m.test(text.trim());
      return !isShim;
    });

  // A document is at risk of being stale when it NAMES a file the change touched. Naming is the
  // strongest signal available without reading the diff: a document that never mentions the file
  // cannot have described it wrongly.
  const stale = [];

  // A basename is evidence only when it identifies ONE file in this repo. `coverage.mjs` occurs
  // once, so a document naming it is talking about that file. `AGENTS.md` occurs in every package,
  // so matching on it flagged twenty documents the moment the root brief was edited — the same
  // coincidence problem as a short name, but length cannot see it. The index already knows.
  const basenameCount = new Map();
  for (const f of index.files) {
    const b = f.path.split("/").pop();
    basenameCount.set(b, (basenameCount.get(b) || 0) + 1);
  }
  const distinctive = (base) => base.length > 6 && basenameCount.get(base) === 1;

  for (const doc of contextDocs) {
    if (seeds.includes(doc)) continue; // the document itself changed — the author is looking at it
    const text = readText(doc);
    if (!text) continue;
    const lines = text.split("\n");
    const mentions = [];
    for (let i = 0; i < lines.length; i++) {
      for (const p of seeds) {
        // Full path first: unambiguous. Basename only when it is distinctive enough to be worth a
        // look — a document saying "index.js" in a repo with nine of them is noise, not a signal.
        const base = p.split("/").pop();
        // A path containing a directory is unambiguous. A root-level file's "path" IS its bare name,
        // so it gets the same distinctiveness test — otherwise editing the root `AGENTS.md` flags
        // every document that merely says the words "AGENTS.md", which in this repo is most of them.
        const hit = p.includes("/")
          ? lines[i].includes(p) || (distinctive(base) && lines[i].includes(base))
          : distinctive(base) && lines[i].includes(base);
        if (hit) mentions.push({ line: i + 1, names: p, text: lines[i].trim().slice(0, 120) });
      }
    }
    if (mentions.length) stale.push({ path: doc, mentions: mentions.slice(0, 12), total: mentions.length });
  }
  stale.sort((a, b) => b.total - a.total || a.path.localeCompare(b.path));

  // Glossary terms the change is likely to be about. Defined once in CONTEXT.md by construction
  // (that is the file's whole job), so a changed file whose path carries a defined term is working
  // in that part of the domain.
  const glossaryPath = contextDocs.find((d) => /(^|\/)CONTEXT\.md$/i.test(d));
  const glossary = [];
  if (glossaryPath) {
    const text = readText(glossaryPath) || "";
    for (const m of text.matchAll(/^#{2,4}\s+(.+?)\s*$/gm)) {
      const term = m[1].replace(/[`*_]/g, "").trim();
      if (!term || term.length > 40) continue;
      const needle = term.toLowerCase().replace(/\s+/g, "-");
      if (seeds.some((p) => p.toLowerCase().includes(needle))) glossary.push(term);
    }
  }

  return {
    changed: seeds,
    unknown,
    briefs,
    glossary: [...new Set(glossary)].sort(),
    adrs: contextDocs.filter((d) => /docs\/adr\//i.test(d) && stale.some((s) => s.path === d)),
    stale,
    hasContextLayer: contextDocs.length > 0,
  };
}

// A citation is a path the document points at. When it stops resolving, the document is provably
// stale — and unlike the `stale` pass above, this needs no diff: the file the document names is
// gone, so no change can ever touch it and seed the check. That is the exact shape of the failure
// this module's header cites (`mcp/lib/scrub.js`), and the shape the diff-driven pass cannot see.
const CITATION_IN_CODE = /`([A-Za-z0-9_.\/-]+)`/g;
const CITATION_IN_LINK = /\]\(([^)\s]+)\)/g;

/** Paths that are absent by design rather than by drift. */
function isExcludedCitation(cited) {
  return cited.startsWith(".cortex/") || /^[a-z]+:\/\//i.test(cited);
}

// A slash is not enough. Run against this repo's own documents, "contains a slash" returned 157
// findings and almost none were drift: forty ritual names (`/cortex-audit`), JSON-RPC methods
// (`tools/call`), repo slugs (`marinvch/Cortex`), and bare directory names. Two rules cut it back,
// and both are about what a *claim on a file* looks like:
//
//   - it never starts with "/" — a repo-relative path cannot, and that alone removes every ritual
//     name and every absolute system path
//   - its last segment carries an extension — `tools/call` and `node_modules/` name a method and a
//     directory, not a file, and a document naming a directory is far weaker evidence anyway
function looksLikePath(cited) {
  if (!cited.includes("/") || cited.startsWith("/") || cited.startsWith("#")) return false;
  return /\.[A-Za-z0-9]{1,6}$/.test(cited);
}

/** Resolve `../` and `./` against the directory a citation was written in. */
function normalizeFrom(home, cited) {
  const out = [];
  for (const part of `${home ? `${home}/` : ""}${cited}`.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// A document may name a dead path on purpose. Two ways, both found on this repo: an ADR is a
// historical record by definition, and any prose can state an absence ("...is deleted"), where the
// sentence is correct BECAUSE the file is gone. Both are reported and neither ever gates — a check
// that fails a build over accurate prose gets switched off, and then nothing is checked at all.
const ABSENCE_MARKERS = /\b(deleted|removed|retired|no longer|used to)\b/i;

function citationClass(doc, line) {
  if (/(^|\/)docs\/adr\//i.test(doc)) return "historical";
  if (ABSENCE_MARKERS.test(line)) return "historical";
  return "suspected";
}

export function citationDrift(index, { readText = () => null, findRename = () => null } = {}) {
  const known = new Set(index.files.map((f) => f.path));
  const dirs = new Set();
  for (const f of index.files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const resolves = (p) => {
    const clean = p.replace(/\/$/, "");
    return known.has(clean) || dirs.has(clean);
  };

  const contextDocs = index.files
    .map((f) => f.path)
    .filter(isContextDoc)
    .filter((p) => !p.startsWith("templates/"));

  const findings = [];
  for (const doc of contextDocs) {
    const text = readText(doc);
    if (text === null) continue;
    const home = dirOf(doc);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const seen = new Set();
      for (const re of [CITATION_IN_CODE, CITATION_IN_LINK]) {
        for (const m of lines[i].matchAll(re)) {
          const cited = m[1].replace(/^\.\//, "");
          if (seen.has(cited)) continue;
          seen.add(cited);
          if (!looksLikePath(cited) || isExcludedCitation(cited)) continue;
          // Doc-relative first (with `../` honoured), then repo-root.
          if (resolves(normalizeFrom(home, cited)) || resolves(cited)) continue;
          const base = citationClass(doc, lines[i]);
          // Only a brief or a glossary makes a present-tense claim. Git may know where the file
          // went, but an ADR saying so is still recording history, so it is never promoted.
          const moved = base === "suspected" ? findRename(cited) : null;
          const proven = moved && resolves(moved) ? moved : null;
          findings.push({
            doc,
            line: i + 1,
            cited,
            text: lines[i].trim().slice(0, 120),
            class: proven ? "provable" : base,
            suggestion: proven,
          });
        }
      }
    }
  }

  findings.sort((a, b) => a.doc.localeCompare(b.doc) || a.line - b.line || a.cited.localeCompare(b.cited));
  const counts = { provable: 0, suspected: 0, historical: 0 };
  for (const f of findings) counts[f.class]++;
  return { hasContextLayer: contextDocs.length > 0, findings, counts };
}
