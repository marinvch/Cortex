# Citation Drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that a context document has gone stale by testing whether the paths it cites still resolve, without needing a diff or a model.

**Architecture:** A new pure function `citationDrift()` in `index/lib/review.mjs` extracts path-shaped citations from every context document, resolves each doc-relative then root-relative against the index, and classifies what fails to resolve into `provable` / `suspected` / `historical`. `index/cortex-review.mjs` gains a `--citations` scope that runs it. Git rename lookup is injected, so the core stays deterministic and testable from literals.

**Tech Stack:** Node 20+, ESM, `node:test`, no runtime dependencies (ADR 0004).

**Spec:** `docs/superpowers/specs/2026-08-22-citation-drift-design.md`

## Global Constraints

- **`index/` must never modify a target repository**, except under `.cortex/` (`index/AGENTS.md`). `--fix` therefore **emits a unified diff on stdout and writes nothing** — a tightening of the spec's "working-tree diff", forced by this invariant. `cortex-review.mjs`'s header promise "writes nothing, not even under .cortex/" stays true.
- **The index is deterministic** — no clock, no randomness, no network. Git history is append-only, so rename lookup is allowed.
- **No runtime dependencies** (ADR 0004). Regex and `node:` builtins only.
- **Never hand-edit a version.** Run `node tools/cortex-version.mjs --set <x.y.z>`.
- Commits in this repo need `SKIP_SIMPLE_GIT_HOOKS=1`.
- Tests: `node --test index/test/*.test.mjs`. Full sweep also runs `core/test/*.test.js`, `mcp/test/*.test.js`, `bash tools/test/run.sh`.

---

### Task 1: Extract and resolve citations

**Files:**
- Modify: `index/lib/review.mjs` (add export beside `reviewContext`; reuse the existing `isContextDoc` at line 22)
- Test: `index/test/review.test.mjs` (append)

**Interfaces:**
- Consumes: `isContextDoc(path)`, already private in this module.
- Produces: `citationDrift(index, { readText, findRename }) → { hasContextLayer, findings, counts }`.
  A finding is `{ doc, line, cited, text, class, suggestion }`. `class` is `"provable" | "suspected" | "historical"`; `suggestion` is a path string or `null`. `counts` is `{ provable, suspected, historical }`. Findings sort by `doc`, then `line`, then `cited`.
  This task produces every finding as `"suspected"` with `suggestion: null`; Tasks 2 and 3 add the other classes.

- [ ] **Step 1: Write the failing test**

Append to `index/test/review.test.mjs`:

```js
import { citationDrift } from "../lib/review.mjs";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test index/test/review.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../lib/review.mjs' does not provide an export named 'citationDrift'`

- [ ] **Step 3: Write minimal implementation**

Append to `index/lib/review.mjs`:

```js
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

function looksLikePath(cited) {
  return cited.includes("/") && !cited.startsWith("#");
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
          if (resolves(cited) || (home && resolves(`${home}/${cited}`))) continue;
          findings.push({
            doc,
            line: i + 1,
            cited,
            text: lines[i].trim().slice(0, 120),
            class: "suspected",
            suggestion: null,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test index/test/review.test.mjs`
Expected: PASS, all tests, no warnings.

- [ ] **Step 5: Commit**

```bash
git add index/lib/review.mjs index/test/review.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "Find citations in context docs that no longer resolve"
```

---

### Task 2: Classify historical citations

**Files:**
- Modify: `index/lib/review.mjs` (inside `citationDrift`)
- Test: `index/test/review.test.mjs` (append)

**Interfaces:**
- Consumes: `citationDrift` from Task 1.
- Produces: findings may now carry `class: "historical"`. No signature change.

- [ ] **Step 1: Write the failing test**

Every case below is a real false positive found by probing this repository on 2026-08-22.

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test index/test/review.test.mjs`
Expected: FAIL — `Expected values to be strictly equal: 'suspected' !== 'historical'`

- [ ] **Step 3: Write minimal implementation**

Add above `citationDrift`:

```js
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
```

Replace `class: "suspected",` in the finding literal with:

```js
            class: citationClass(doc, lines[i]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test index/test/review.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index/lib/review.mjs index/test/review.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "An ADR and a stated absence are history, not drift"
```

---

### Task 3: Promote to provable when git proves the destination

**Files:**
- Modify: `index/lib/review.mjs` (inside `citationDrift`)
- Test: `index/test/review.test.mjs` (append)

**Interfaces:**
- Consumes: `citationDrift` from Task 2.
- Produces: `findRename` is now called as `findRename(citedPath) → newPath | null`. A finding whose `findRename` returns a path that exists in the index becomes `class: "provable"` with `suggestion` set to that path. The CLI supplies the git-backed implementation in Task 4; the core never shells out, which is what keeps it a pure function.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test index/test/review.test.mjs`
Expected: FAIL — `'suspected' !== 'provable'`

- [ ] **Step 3: Write minimal implementation**

Replace the finding literal's `class`/`suggestion` construction with:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test index/test/review.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index/lib/review.mjs index/test/review.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "A rename git recorded is proof, not a guess"
```

---

### Task 4: The `--citations` scope on the CLI

**Files:**
- Modify: `index/cortex-review.mjs:19-31` (`parseArgs`), `:54-70` (input gathering), `:80` (dispatch), and the header comment at `:1-12`
- Test: `index/test/cli.test.mjs` (append)

**Interfaces:**
- Consumes: `citationDrift` from Task 3.
- Produces: `node index/cortex-review.mjs --citations [--since <ref>] [--json]`. Exit `0` when no `provable` finding exists, `1` when one does, `2` for usage errors and a missing index (matching the existing convention at `:43`).

- [ ] **Step 1: Write the failing test**

Append to `index/test/cli.test.mjs`. Note `run()` throws on a non-zero exit, so the gate case is asserted through the thrown error.

```js
function gitFixtureWithMovedFile() {
  const root = mkdtempSync(join(tmpdir(), "cortex-cit-"));
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "mcp", "lib"), { recursive: true });
  writeFileSync(join(root, "mcp", "lib", "scrub.js"), "export const scrub = 1;\n");
  writeFileSync(join(root, "AGENTS.md"), "# Brief\n\nThe secret gate is `mcp/lib/scrub.js`.\n");
  g("init", "-q");
  g("add", "-A");
  g("commit", "-qm", "init");
  mkdirSync(join(root, "core"), { recursive: true });
  g("mv", "mcp/lib/scrub.js", "core/scrub.js");
  g("commit", "-qm", "move scrub to core");
  return root;
}

test("cortex-review --citations proves a moved file left a document wrong", () => {
  const root = gitFixtureWithMovedFile();
  run("cortex-index.mjs", ["."], root);

  let out = "", code = 0;
  try {
    out = run("cortex-review.mjs", ["--citations"], root);
  } catch (e) {
    out = String(e.stdout ?? "");
    code = e.status;
  }

  assert.equal(code, 1, "a provable finding must fail the gate");
  assert.match(out, /mcp\/lib\/scrub\.js/);
  assert.match(out, /core\/scrub\.js/, "and it must name where the file went");
});

test("cortex-review --citations --json reports counts by class", () => {
  const root = gitFixtureWithMovedFile();
  run("cortex-index.mjs", ["."], root);
  let out = "";
  try {
    out = run("cortex-review.mjs", ["--citations", "--json"], root);
  } catch (e) {
    out = String(e.stdout ?? "");
  }
  const r = JSON.parse(out);
  assert.equal(r.counts.provable, 1);
  assert.equal(r.findings[0].suggestion, "core/scrub.js");
});

test("cortex-review --citations exits zero on a repo whose citations all resolve", () => {
  const root = fixture();
  writeFileSync(join(root, "AGENTS.md"), "# Brief\n\nEntry point is `src/index.js`.\n");
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-review.mjs", ["--citations"], root);
  assert.match(out, /No unresolved citations/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test index/test/cli.test.mjs`
Expected: FAIL — the CLI exits 2 with "nothing to review. Pass file paths, or --staged, or --since <ref>."

- [ ] **Step 3: Write minimal implementation**

In `parseArgs`, add `citations: false` to the `args` literal and this branch:

```js
    else if (a === "--citations") args.citations = true;
```

Import `citationDrift` alongside `reviewContext` at `:17`. Then, immediately after the `index` is parsed at `:72` and `readText` is defined at `:73-79`, insert the whole `--citations` path before the existing `reviewContext` call, and move the "nothing to review" guard at `:67-70` to run only when `!args.citations`:

```js
if (args.citations) {
  // Where a deleted path went, from git's own rename record. Deterministic: history is append-only.
  const findRename = (cited) => {
    const out = git(["log", "-M", "--diff-filter=R", "--name-status", "--format=", "--", cited]);
    if (!out) return null;
    for (const line of out.split("\n")) {
      const m = line.match(/^R\d*\t(.+)\t(.+)$/);
      if (m && m[1] === cited) return m[2];
    }
    return null;
  };
  const r = citationDrift(index, { readText, findRename });

  // --since narrows to citations this range could have broken: only docs or paths it touched.
  if (args.since) {
    const out = git(["diff", "--name-only", `${args.since}...HEAD`]) ?? git(["diff", "--name-only", args.since]) ?? "";
    const touched = new Set(out.split("\n").filter(Boolean));
    r.findings = r.findings.filter((f) => touched.has(f.doc) || touched.has(f.cited) || touched.has(f.suggestion));
    r.counts = { provable: 0, suspected: 0, historical: 0 };
    for (const f of r.findings) r.counts[f.class]++;
  }

  if (args.json) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.counts.provable ? 1 : 0);
  }
  if (!r.hasContextLayer) {
    console.log(`\nThis repo has no context layer — no AGENTS.md, CONTEXT.md or ADRs.`);
    console.log(`There is nothing whose citations could be checked. Run /cortex-install to add one.`);
    process.exit(0);
  }
  if (!r.findings.length) {
    console.log(`\nNo unresolved citations. Every path these documents name still exists.`);
    console.log(`That is not proof they are RIGHT — a claim made in prose, naming no path, is`);
    console.log(`invisible here. This checks pointers, not sentences.`);
    process.exit(0);
  }
  for (const cls of ["provable", "suspected", "historical"]) {
    const group = r.findings.filter((f) => f.class === cls);
    if (!group.length) continue;
    console.log(`\n${cls} (${group.length}):\n`);
    for (const f of group) {
      console.log(`  ${f.doc}:${f.line}  cites ${f.cited}`);
      console.log(`      ${f.text}`);
      if (f.suggestion) console.log(`      git says it moved to: ${f.suggestion}`);
    }
  }
  console.log(`\nOnly "provable" fails this check — git recorded where those files went.`);
  console.log(`"suspected" needs a human; "historical" is an ADR or a stated absence and is correct.`);
  process.exit(r.counts.provable ? 1 : 0);
}
```

Finally, extend the header comment at `:5-7` with the new usage line, keeping the "writes nothing" promise intact:

```js
//   node index/cortex-review.mjs --citations
//   node index/cortex-review.mjs --citations --since HEAD~20
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test index/test/cli.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index/cortex-review.mjs index/test/cli.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "cortex-review --citations: the whole layer, or what a range broke"
```

---

### Task 5: `--fix` emits a patch and writes nothing

**Files:**
- Modify: `index/cortex-review.mjs` (inside the `--citations` block from Task 4)
- Test: `index/test/cli.test.mjs` (append)

**Interfaces:**
- Consumes: the `--citations` block and `r.findings` from Task 4.
- Produces: `--citations --fix` prints a unified diff on stdout covering `provable` findings only, and exits `0`. It writes no file — `index/AGENTS.md`'s invariant forbids modifying a target repo outside `.cortex/`, so the human (or the ritual) applies it with `git apply`.

- [ ] **Step 1: Write the failing test**

```js
test("--citations --fix emits an appliable patch and changes nothing on disk", () => {
  const root = gitFixtureWithMovedFile();
  run("cortex-index.mjs", ["."], root);
  const before = readFileSync(join(root, "AGENTS.md"), "utf8");

  const patch = run("cortex-review.mjs", ["--citations", "--fix"], root);

  assert.match(patch, /^--- a\/AGENTS\.md$/m);
  assert.match(patch, /^-.*mcp\/lib\/scrub\.js/m);
  assert.match(patch, /^\+.*core\/scrub\.js/m);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), before, "index/ never writes to a target repo");

  writeFileSync(join(root, "p.diff"), patch);
  execFileSync("git", ["apply", "p.diff"], { cwd: root, stdio: "ignore" });
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /core\/scrub\.js/, "the patch must actually apply");
});

test("--fix declines to touch anything it cannot prove", () => {
  const root = fixture();
  writeFileSync(join(root, "AGENTS.md"), "# Brief\n\nSee `never/existed.js`.\n");
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-review.mjs", ["--citations", "--fix"], root);
  assert.match(out, /nothing to fix/i);
  assert.doesNotMatch(out, /never\/existed\.js.*\n\+/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test index/test/cli.test.mjs`
Expected: FAIL — `--fix` is not a recognised flag, so the command prints the normal report and the patch assertions fail.

- [ ] **Step 3: Write minimal implementation**

Add `fix: false` to the `args` literal and `else if (a === "--fix") args.fix = true;` to `parseArgs`. Then, inside the `--citations` block, immediately after the `--since` narrowing and before the `--json` branch:

```js
  if (args.fix) {
    // A patch, not a write. index/ may not modify a target repo outside .cortex/ — so the heal is
    // proposed in the one form a human can read, reject, and apply in a single command.
    const provable = r.findings.filter((f) => f.class === "provable");
    if (!provable.length) {
      console.log(`\nNothing to fix — no citation has a destination git can prove.`);
      process.exit(0);
    }
    const byDoc = new Map();
    for (const f of provable) {
      if (!byDoc.has(f.doc)) byDoc.set(f.doc, []);
      byDoc.get(f.doc).push(f);
    }
    let patch = "";
    for (const [doc, group] of [...byDoc].sort((a, b) => a[0].localeCompare(b[0]))) {
      const lines = (readText(doc) ?? "").split("\n");
      patch += `--- a/${doc}\n+++ b/${doc}\n`;
      for (const f of group.sort((a, b) => a.line - b.line)) {
        const old = lines[f.line - 1];
        // Replace only the cited token, never the surrounding prose.
        const next = old.split(f.cited).join(f.suggestion);
        patch += `@@ -${f.line},1 +${f.line},1 @@\n-${old}\n+${next}\n`;
      }
    }
    process.stdout.write(patch);
    process.exit(0);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test index/test/cli.test.mjs`
Expected: PASS. If `git apply` rejects the patch, the hunk header line counts are wrong — fix the generator, not the test.

- [ ] **Step 5: Commit**

```bash
git add index/cortex-review.mjs index/test/cli.test.mjs
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "--fix proposes a patch; it never writes to a target repo"
```

---

### Task 6: Wire it into the ritual and the docs

**Files:**
- Modify: `skills/cortex-review/SKILL.md` (the evidence-pass block near line 30, and the two-axes section)
- Modify: `index/AGENTS.md` (Gotchas)
- Modify: `CHANGELOG.md`
- Test: `node --test core/test/*.test.js` (`plugin.test.js` asserts every ritual's frontmatter)

**Interfaces:**
- Consumes: the CLI surface from Tasks 4 and 5.
- Produces: no code interface. `capability: judgment` on the ritual is unchanged — the new CLI half is mechanical and runs in CI without a model.

- [ ] **Step 1: Run the check against this repo and record the real output**

Run: `node index/cortex-index.mjs . && node index/cortex-review.mjs --citations`
Expected: a findings list. The probe on 2026-08-22 found 7 unresolved citations here, most `historical`. Use the actual output as the example in the skill — never an invented one.

- [ ] **Step 2: Add the scope to the skill**

In `skills/cortex-review/SKILL.md`, add to the evidence-pass block:

```bash
node index/cortex-review.mjs --citations       # the whole layer, no diff needed
node index/cortex-review.mjs --citations --since HEAD~20 --json
```

And under **Drift**, add the sentence explaining why this exists at all:

> The diff-driven pass can only flag a document that names a file the change touched — so it is
> structurally blind to the `mcp/lib/scrub.js` failure above. Once the path is gone, no diff can
> touch it. `--citations` asks the question without a diff, and classes each answer by how much is
> proven: `provable` (git recorded where the file went), `suspected` (a human decides), `historical`
> (an ADR or a stated absence, correct as written).

- [ ] **Step 3: Add the gotcha to `index/AGENTS.md`**

```markdown
- **A citation is checkable; a claim is not.** `citationDrift` resolves the paths a context document
  names — doc-relative first, then root — and that one ordering rule cut a naive probe of this repo
  from 27 findings to 7. It deliberately does not chase prose: `index/AGENTS.md` saying "Coverage
  uses two signals" while the code used three is real drift and invisible here, because the path was
  never wrong. Do not extend the CLI to guess at sentences — a deterministic tool claiming to find
  *all* drift is worse than one that states where it stops.
```

- [ ] **Step 4: Run the full suite**

Run: `node --test index/test/*.test.mjs core/test/*.test.js mcp/test/*.test.js && bash tools/test/run.sh`
Expected: all pass, 0 failures.

- [ ] **Step 5: Stamp the version and write the changelog**

Run: `node tools/cortex-version.mjs --set 2.23.0` (a new capability, so minor). Write the `## [2.23.0]` entry by hand — the tool will not, and `--check` fails until it exists. Lead with the structural blind spot and the 27→7 number; both are the argument.

Run: `node tools/cortex-version.mjs --check`
Expected: `every version site agrees on 2.23.0`

- [ ] **Step 6: Commit**

```bash
git add -A
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "Cortex 2.23.0 — prove a document stale by the paths it cites"
```
