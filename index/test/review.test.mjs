import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewContext, citationDrift } from "../lib/review.mjs";

/** An index carrying only paths — reviewContext reads nothing else off a file. */
function ix(paths) {
  return { files: paths.map((path) => ({ path, category: "code", lang: "javascript", isTest: false })) };
}
const reader = (docs) => (p) => (p in docs ? docs[p] : null);

test("the nearest brief comes first, and the root still applies", () => {
  // Both matter. A review consulting only the leaf misses the repo-wide invariants; one consulting
  // only the root misses the rules written for exactly this directory.
  const r = reviewContext(ix(["AGENTS.md", "src/lib/AGENTS.md", "src/lib/db.js"]), ["src/lib/db.js"], {
    readText: reader({ "AGENTS.md": "root rules", "src/lib/AGENTS.md": "lib rules" }),
  });
  assert.deepEqual(r.briefs.map((b) => b.path), ["src/lib/AGENTS.md", "AGENTS.md"]);
});

test("a brief below the changed file does not govern it", () => {
  const r = reviewContext(ix(["AGENTS.md", "src/deep/AGENTS.md", "src/db.js"]), ["src/db.js"], {
    readText: reader({ "AGENTS.md": "root", "src/deep/AGENTS.md": "deep" }),
  });
  assert.deepEqual(r.briefs.map((b) => b.path), ["AGENTS.md"]);
});

test("the root brief sorts last, not first", () => {
  // The display label is "(repo root)" — eleven characters. Sorting on it instead of the directory
  // put the root ahead of every leaf, the exact opposite of "nearest scope first".
  const r = reviewContext(ix(["AGENTS.md", "a/AGENTS.md", "a/x.js"]), ["a/x.js"], {
    readText: reader({ "AGENTS.md": "root", "a/AGENTS.md": "leaf" }),
  });
  assert.equal(r.briefs[0].path, "a/AGENTS.md");
  assert.equal(r.briefs.at(-1).path, "AGENTS.md");
});

test("a shim is not a third authority", () => {
  // CLAUDE.md and GEMINI.md hold one line: @AGENTS.md. Listing all three makes the root look like
  // three separate documents to read.
  const r = reviewContext(ix(["AGENTS.md", "CLAUDE.md", "GEMINI.md", "x.js"]), ["x.js"], {
    readText: reader({ "AGENTS.md": "the real rules", "CLAUDE.md": "@AGENTS.md\n", "GEMINI.md": "@AGENTS.md\n" }),
  });
  assert.deepEqual(r.briefs.map((b) => b.path), ["AGENTS.md"]);
});

test("a document naming a changed file is flagged, with the line", () => {
  // The drift half. This is the finding the author cannot see for themselves: the code in front of
  // them looks right and the sentence describing it lives somewhere else.
  const docs = {
    "AGENTS.md": "intro\n- coverage uses two signals, see index/lib/coverage.mjs\nmore\n",
  };
  const r = reviewContext(ix(["AGENTS.md", "index/lib/coverage.mjs"]), ["index/lib/coverage.mjs"], {
    readText: reader(docs),
  });
  assert.equal(r.stale.length, 1);
  assert.equal(r.stale[0].path, "AGENTS.md");
  assert.equal(r.stale[0].mentions[0].line, 2);
  assert.match(r.stale[0].mentions[0].text, /two signals/);
});

test("a document that never names the file is not flagged", () => {
  const r = reviewContext(ix(["AGENTS.md", "src/db.js"]), ["src/db.js"], {
    readText: reader({ "AGENTS.md": "nothing relevant here at all\n" }),
  });
  assert.deepEqual(r.stale, []);
});

test("a short basename does not match on its own", () => {
  // "db.js" appears in half the repos on earth. A drift list full of coincidences is one nobody
  // reads, which costs the entries that are real.
  const r = reviewContext(ix(["AGENTS.md", "src/db.js"]), ["src/db.js"], {
    readText: reader({ "AGENTS.md": "we talk about db.js a lot\n" }),
  });
  assert.deepEqual(r.stale, [], "too short to be evidence on its own");

  const long = reviewContext(ix(["AGENTS.md", "src/coverage.mjs"]), ["src/coverage.mjs"], {
    readText: reader({ "AGENTS.md": "see coverage.mjs\n" }),
  });
  assert.equal(long.stale.length, 1, "a distinctive basename is worth a look");
});

test("a changed document is not reported as stale against itself", () => {
  // The author is already looking at it.
  const r = reviewContext(ix(["AGENTS.md", "src/coverage.mjs"]), ["AGENTS.md", "src/coverage.mjs"], {
    readText: reader({ "AGENTS.md": "see coverage.mjs\n" }),
  });
  assert.deepEqual(r.stale.map((s) => s.path), []);
});

test("ADRs count as governing context", () => {
  const r = reviewContext(
    ix(["docs/adr/0004-no-runtime-dependencies.md", "mcp/server.js"]),
    ["mcp/server.js"],
    { readText: reader({ "docs/adr/0004-no-runtime-dependencies.md": "mcp/server.js must not import\n" }) },
  );
  assert.deepEqual(r.adrs, ["docs/adr/0004-no-runtime-dependencies.md"]);
});

test("a repo with no context layer says so rather than reviewing against nothing", () => {
  // The honest answer, and an actionable one. Improvising a review from general principles is how a
  // tool that claims to check documented rules starts inventing them.
  const r = reviewContext(ix(["src/a.js", "src/b.js"]), ["src/a.js"], { readText: () => null });
  assert.equal(r.hasContextLayer, false);
  assert.deepEqual(r.briefs, []);
});

test("unknown paths are reported, never dropped", () => {
  const r = reviewContext(ix(["AGENTS.md", "src/a.js"]), ["src/a.js", "typo.js"], {
    readText: reader({ "AGENTS.md": "rules" }),
  });
  assert.deepEqual(r.unknown, ["typo.js"]);
  assert.deepEqual(r.changed, ["src/a.js"]);
});

test("glossary terms are matched from CONTEXT.md headings", () => {
  const r = reviewContext(ix(["CONTEXT.md", "src/findings.mjs"]), ["src/findings.mjs"], {
    readText: reader({ "CONTEXT.md": "# Terms\n\n## Findings\n\nWhat a report holds.\n\n## Vault\n\nElsewhere.\n" }),
  });
  assert.deepEqual(r.glossary, ["Findings"]);
});

test("output is stable across runs", () => {
  const args = [
    ix(["AGENTS.md", "a/AGENTS.md", "a/coverage.mjs"]),
    ["a/coverage.mjs"],
    { readText: reader({ "AGENTS.md": "see coverage.mjs", "a/AGENTS.md": "see coverage.mjs" }) },
  ];
  assert.equal(JSON.stringify(reviewContext(...args)), JSON.stringify(reviewContext(...args)));
});

test("a basename shared by many files is not evidence", () => {
  // `AGENTS.md` occurs in every package, so matching on it flagged twenty documents the moment the
  // root brief was edited. Length cannot see this — the index can. `coverage.mjs` occurs once, so a
  // document naming it is talking about that file.
  const files = ["AGENTS.md", "a/AGENTS.md", "b/AGENTS.md", "a/coverage.mjs", "docs/adr/0001-x.md"];
  const docs = {
    "docs/adr/0001-x.md": "we write an AGENTS.md into each package\nand a/coverage.mjs does the counting\n",
  };

  const common = reviewContext(ix(files), ["AGENTS.md"], { readText: reader(docs) });
  assert.deepEqual(common.stale, [], "editing the root brief does not flag every doc that says AGENTS.md");

  const unique = reviewContext(ix(files), ["a/coverage.mjs"], { readText: reader(docs) });
  assert.equal(unique.stale.length, 1, "a one-of-a-kind basename still counts");
  assert.equal(unique.stale[0].mentions[0].line, 2);
});

test("a citation resolves against its own document's directory first", () => {
  // mcp/AGENTS.md saying `lib/resolve.js` means mcp/lib/resolve.js. Resolving only against the
  // repo root reported 20 false positives on this repo — the flood that gets a checker switched off.
  const r = citationDrift(ix(["mcp/AGENTS.md", "mcp/lib/resolve.js"]), {
    readText: reader({ "mcp/AGENTS.md": "the door is `lib/resolve.js`\n" }),
  });
  assert.deepEqual(r.findings, []);
});

test("a citation that resolves against the repo root is fine too", () => {
  const r = citationDrift(ix(["mcp/AGENTS.md", "core/paths.js"]), {
    readText: reader({ "mcp/AGENTS.md": "the guard lives in `core/paths.js`\n" }),
  });
  assert.deepEqual(r.findings, []);
});

test("a citation that resolves nowhere is reported with its line and text", () => {
  const r = citationDrift(ix(["AGENTS.md", "core/scrub.js"]), {
    readText: reader({ "AGENTS.md": "intro\nscrub lives in `mcp/lib/scrub.js`\n" }),
  });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].doc, "AGENTS.md");
  assert.equal(r.findings[0].line, 2);
  assert.equal(r.findings[0].cited, "mcp/lib/scrub.js");
  assert.match(r.findings[0].text, /scrub lives in/);
});

test("a citation naming a directory resolves", () => {
  const r = citationDrift(ix(["AGENTS.md", "docs/adr/0001-x.md"]), {
    readText: reader({ "AGENTS.md": "decisions live in `docs/adr/`\n" }),
  });
  assert.deepEqual(r.findings, []);
});

test("markdown link targets are citations too; URLs are not", () => {
  const r = citationDrift(ix(["AGENTS.md"]), {
    readText: reader({
      "AGENTS.md": "see [ADR 15](docs/adr/0015-gone.md) and [home](https://example.com/a.md)\n",
    }),
  });
  assert.deepEqual(r.findings.map((f) => f.cited), ["docs/adr/0015-gone.md"]);
});

test("generated and fictional paths are not drift", () => {
  // .cortex/ is generated and gitignored by construction; templates/ ships deliberate examples.
  const r = citationDrift(ix(["AGENTS.md", "templates/CONTEXT.md"]), {
    readText: reader({
      "AGENTS.md": "the index is `.cortex/index/index.json`\n",
      "templates/CONTEXT.md": "an order is `src/billing/order.ts`\n",
    }),
  });
  assert.deepEqual(r.findings, []);
});

test("a repo with no context layer says so instead of reporting nothing", () => {
  const r = citationDrift(ix(["src/a.js"]), { readText: reader({}) });
  assert.equal(r.hasContextLayer, false);
});

test("an ADR citing a retired file is history, not drift", () => {
  // docs/adr/0011 names skills/cortex-doctor/SKILL.md, a skill that was deliberately retired.
  // An ADR records what was; gating on one would fail pull requests over correct prose.
  const r = citationDrift(ix(["docs/adr/0011-x.md"]), {
    readText: reader({ "docs/adr/0011-x.md": "`skills/cortex-doctor/SKILL.md` scanned six categories\n" }),
  });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].class, "historical");
});

test("prose describing a file's absence is correct because the path is gone", () => {
  // docs/adr/0004: "...and `mcp/package-lock.json` is deleted."
  const r = citationDrift(ix(["AGENTS.md"]), {
    readText: reader({ "AGENTS.md": "the manifest declares nothing and `mcp/package-lock.json` is deleted\n" }),
  });
  assert.equal(r.findings[0].class, "historical");
});

test("the absence markers are a closed, tested list", () => {
  for (const marker of ["deleted", "removed", "retired", "no longer", "used to"]) {
    const r = citationDrift(ix(["AGENTS.md"]), {
      readText: reader({ "AGENTS.md": `\`old/gone.js\` was ${marker} last year\n` }),
    });
    assert.equal(r.findings[0].class, "historical", `"${marker}" should downgrade`);
  }
});

test("the two classes nothing can separate mechanically land in suspected, and never gate", () => {
  // The spec names four false-positive classes. Two are detectable — an ADR, and a stated absence.
  // The other two are not: a path can illustrate another ecosystem's convention (`bin/cli.js` in
  // index/AGENTS.md), and a path can be absent from the index because git ignores it by design
  // (`decisions/log.md` in the root brief). Neither is separable from real drift by regex. They are
  // caught here as `suspected`, which reports and never fails the check — that is the whole reason
  // the gate is narrowed to `provable`.
  const r = citationDrift(ix(["AGENTS.md"]), {
    readText: reader({ "AGENTS.md": "npm puts a CLI at `bin/cli.js`\ndecisions live in `decisions/log.md`\n" }),
  });
  assert.deepEqual(r.findings.map((f) => f.class), ["suspected", "suspected"]);
  assert.equal(r.counts.provable, 0, "an unprovable finding must never reach the gate");
});

test("downgrading never hides a finding", () => {
  const r = citationDrift(ix(["docs/adr/0011-x.md"]), {
    readText: reader({ "docs/adr/0011-x.md": "`a/b.js` is gone\n" }),
  });
  assert.equal(r.findings.length, 1, "historical still appears in the report");
  assert.equal(r.counts.historical, 1);
});

test("git proving where a file went makes the citation provable and suggests the fix", () => {
  // The scrub.js shape: AGENTS.md pointed at mcp/lib/scrub.js for months after it moved to core/.
  const r = citationDrift(ix(["AGENTS.md", "core/scrub.js"]), {
    readText: reader({ "AGENTS.md": "the secret gate is `mcp/lib/scrub.js`\n" }),
    findRename: (p) => (p === "mcp/lib/scrub.js" ? "core/scrub.js" : null),
  });
  assert.equal(r.findings[0].class, "provable");
  assert.equal(r.findings[0].suggestion, "core/scrub.js");
  assert.equal(r.counts.provable, 1);
});

test("a rename to a path that is also gone proves nothing", () => {
  const r = citationDrift(ix(["AGENTS.md"]), {
    readText: reader({ "AGENTS.md": "see `old/a.js`\n" }),
    findRename: () => "also/missing.js",
  });
  assert.equal(r.findings[0].class, "suspected");
  assert.equal(r.findings[0].suggestion, null);
});

test("history is never promoted, even when git can prove the move", () => {
  const r = citationDrift(ix(["docs/adr/0011-x.md", "core/scrub.js"]), {
    readText: reader({ "docs/adr/0011-x.md": "`mcp/lib/scrub.js` held the gate\n" }),
    findRename: () => "core/scrub.js",
  });
  assert.equal(r.findings[0].class, "historical", "an ADR describing the past is still the past");
});

// Everything below came from running the check against this repository and reading 157 findings,
// almost all false. Literal fixtures did not surface any of it — real prose is the only source.

test("a slash-command name is not a path", () => {
  // `/cortex-audit` and `/dream` contain a slash and nothing else path-like. AGENTS.md names 40 of
  // them, which alone produced most of the flood. A repo-relative citation never starts with "/".
  const r = citationDrift(ix(["AGENTS.md"]), {
    readText: reader({ "AGENTS.md": "run `/cortex-audit` weekly, then `/dream` at night\n" }),
  });
  assert.deepEqual(r.findings, []);
});

test("an absolute system path is not a repo citation either", () => {
  const r = citationDrift(ix(["docs/adr/0009-x.md"]), {
    readText: reader({ "docs/adr/0009-x.md": "carried into any backup of `/var/spool/cron`\n" }),
  });
  assert.deepEqual(r.findings, []);
});

test("a slash-separated name with no extension is not a citation", () => {
  // JSON-RPC methods (`tools/call`), repo slugs (`marinvch/Cortex`, `tj/n`), and bare directory
  // names (`node_modules/`, `scripts/`) all read as paths to a regex and are not claims about files.
  const r = citationDrift(ix(["AGENTS.md"]), {
    readText: reader({
      "AGENTS.md": "it speaks `tools/call` and `tools/list`\nsee `marinvch/Cortex` and `tj/n`\nnot `node_modules/`\n",
    }),
  });
  assert.deepEqual(r.findings, []);
});

test("a relative link climbing out of the document's directory resolves", () => {
  // mcp/AGENTS.md links [ADR 0004](../docs/adr/0004-....md). That file exists; reporting it as
  // drift is the checker being wrong about a document that is right.
  const r = citationDrift(ix(["mcp/AGENTS.md", "docs/adr/0004-no-runtime-dependencies.md"]), {
    readText: reader({
      "mcp/AGENTS.md": "[ADR 0004](../docs/adr/0004-no-runtime-dependencies.md)\n",
    }),
  });
  assert.deepEqual(r.findings, []);
});

test("a genuinely dangling relative link is still caught", () => {
  const r = citationDrift(ix(["mcp/AGENTS.md"]), {
    readText: reader({ "mcp/AGENTS.md": "[gone](../docs/adr/0099-never-written.md)\n" }),
  });
  assert.deepEqual(r.findings.map((f) => f.cited), ["../docs/adr/0099-never-written.md"]);
});
