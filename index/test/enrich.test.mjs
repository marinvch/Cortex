import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBatches, isEnrichable, batchStats } from "../lib/batch.mjs";
import { validateBatch, mergeEnrichment, applyEnrichment, isStale } from "../lib/enrich.mjs";

function idx(files, layers, edges = [], commit = "abc123") {
  return { commit, files, layers, edges };
}

const FILES = [
  { path: "src/a.js", lang: "javascript", category: "code", lines: 100, isTest: false, isEntry: true, imports: ["src/b.js"], inbound: 0 },
  { path: "src/b.js", lang: "javascript", category: "code", lines: 80, isTest: false, isEntry: false, imports: [], inbound: 1 },
  { path: "docs/x.md", lang: "markdown", category: "docs", lines: 40, isTest: false, isEntry: false, imports: [], inbound: 0 },
  { path: "tiny.txt", lang: "text", category: "docs", lines: 1, isTest: false, isEntry: false, imports: [], inbound: 0 },
];
const LAYERS = [
  { id: "layer:src", name: "src", paths: ["src/a.js", "src/b.js"] },
  { id: "layer:docs", name: "docs", paths: ["docs/x.md"] },
  { id: "layer:root", name: "root", paths: ["tiny.txt"] },
];

test("skips files not worth a summary", () => {
  assert.equal(isEnrichable({ lines: 1, category: "docs" }), false, "near-empty files carry no meaning");
  assert.equal(isEnrichable({ lines: 50, category: "other" }), false);
  assert.equal(isEnrichable({ lines: 50, category: "code" }), true);
});

test("batches are grouped by layer and stay within budget", () => {
  const batches = computeBatches(idx(FILES, LAYERS), { maxLines: 120, maxFiles: 10 });
  for (const b of batches) {
    const lines = b.files.reduce((a, f) => a + f.lines, 0);
    // A single oversized file is allowed through alone; the budget bounds accumulation.
    assert.ok(lines <= 120 || b.files.length === 1, `batch ${b.batchIndex} over budget at ${lines}`);
    const layers = new Set(b.files.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "root")));
    assert.equal(layers.size, 1, "a batch must not span layers");
  }
  assert.equal(batchStats(batches).files, 3, "the 1-line file is excluded");
});

test("batching is deterministic", () => {
  const a = computeBatches(idx(FILES, LAYERS));
  const b = computeBatches(idx(FILES, LAYERS));
  assert.deepEqual(a, b);
});

test("neighbours name what a batch touches without including it", () => {
  const files = [
    { path: "src/a.js", category: "code", lines: 10, imports: ["lib/z.js"], inbound: 0, isTest: false, isEntry: false, lang: "javascript" },
  ];
  const layers = [{ id: "layer:src", name: "src", paths: ["src/a.js"] }];
  const edges = [{ from: "other/c.js", to: "src/a.js", type: "imports" }];
  const [batch] = computeBatches(idx(files, layers, edges));
  assert.deepEqual(batch.neighbours, ["lib/z.js", "other/c.js"]);
  assert.ok(!batch.files.some((f) => f.path === "lib/z.js"));
});

// --- validation: everything below exists because a model wrote the input ---------------------

const BATCH = { batchIndex: 1, layer: "src", files: [{ path: "src/a.js" }, { path: "src/b.js" }] };

test("accepts a well-formed result", () => {
  const { entries, issues } = validateBatch(BATCH, [
    { path: "src/a.js", summary: "Entry point.", role: "entrypoint", tags: ["Boot", "boot"] },
    { path: "src/b.js", summary: "Helper.", tags: [] },
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(issues, []);
  assert.deepEqual(entries[0].tags, ["boot"], "tags are lowercased and deduped");
});

test("DROPS a summary for a file that was not in the batch", () => {
  const { entries, issues } = validateBatch(BATCH, [
    { path: "src/a.js", summary: "Real." },
    { path: "src/imaginary.js", summary: "Confidently wrong." },
    { path: "src/b.js", summary: "Real." },
  ]);
  assert.equal(entries.length, 2);
  assert.ok(!entries.some((e) => e.path === "src/imaginary.js"));
  assert.ok(issues.some((i) => /imaginary/.test(i)));
});

test("reports files the batch failed to cover", () => {
  const { entries, issues } = validateBatch(BATCH, [{ path: "src/a.js", summary: "Only one." }]);
  assert.equal(entries.length, 1);
  assert.ok(issues.some((i) => /src\/b\.js.*not covered/.test(i)));
});

test("drops entries with no summary, and clears unknown roles", () => {
  const { entries, issues } = validateBatch(BATCH, [
    { path: "src/a.js", summary: "   " },
    { path: "src/b.js", summary: "Fine.", role: "wizard" },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, undefined);
  assert.ok(issues.some((i) => /no summary/.test(i)));
  assert.ok(issues.some((i) => /unknown role/.test(i)));
});

test("rejects a result that is not a list of entries", () => {
  const { entries, issues } = validateBatch(BATCH, { nope: true });
  assert.equal(entries.length, 0);
  assert.equal(issues.length, 1);
});

test("accepts the {files:[...]} envelope as well as a bare array", () => {
  const { entries } = validateBatch(BATCH, { files: [{ path: "src/a.js", summary: "x" }, { path: "src/b.js", summary: "y" }] });
  assert.equal(entries.length, 2);
});

test("truncates a runaway summary rather than storing it whole", () => {
  const { entries } = validateBatch(BATCH, [
    { path: "src/a.js", summary: "x".repeat(900) },
    { path: "src/b.js", summary: "ok" },
  ]);
  assert.ok(entries[0].summary.length <= 400);
  assert.ok(entries[0].summary.endsWith("…"));
});

// --- merge + apply ---------------------------------------------------------------------------

test("merge keys by path, reports coverage, and drops paths absent from the index", () => {
  const index = idx(FILES, LAYERS);
  const enrichment = mergeEnrichment(index, [
    { batch: BATCH, result: [{ path: "src/a.js", summary: "A." }, { path: "src/b.js", summary: "B." }] },
  ]);
  assert.equal(enrichment.coverage.enriched, 2);
  assert.equal(enrichment.coverage.indexed, 4);
  assert.equal(enrichment.files["src/a.js"].summary, "A.");
  assert.equal(enrichment.indexCommit, "abc123");
});

test("applying enrichment leaves unenriched files untouched", () => {
  const index = idx(FILES, LAYERS);
  const enrichment = mergeEnrichment(index, [
    { batch: BATCH, result: [{ path: "src/a.js", summary: "A." }, { path: "src/b.js", summary: "B." }] },
  ]);
  const applied = applyEnrichment(index, enrichment);
  const byPath = new Map(applied.files.map((f) => [f.path, f]));
  assert.equal(byPath.get("src/a.js").summary, "A.");
  assert.equal(byPath.get("docs/x.md").summary, undefined, "no summary is left as no summary");
  assert.equal(applied.files.length, index.files.length, "enrichment never adds or removes files");
});

test("staleness is detected by commit and by file count", () => {
  const index = idx(FILES, LAYERS);
  const fresh = mergeEnrichment(index, []);
  fresh.coverage.indexed = index.files.length;
  assert.equal(isStale(index, fresh), false);
  assert.equal(isStale(index, null), true);
  assert.equal(isStale({ ...index, commit: "different" }, fresh), true);
  assert.equal(isStale({ ...index, files: [...FILES, { path: "new.js" }] }, fresh), true);
});

// Batch indexes are POSITIONAL. Adding or removing a layer renumbers every batch after it, so the
// batch-N.json files already on disk end up describing a different batch than the one they were
// written for. Every entry then looks like "not in this batch" and is dropped — discarding the
// whole enrichment on any structural change, which is the opposite of the resumability the
// deterministic batching exists to provide.
//
// Found by dogfooding: deleting .vscode/ removed one layer, and the next merge reported 379 issues
// against 210 summaries, not one of which was wrong.
//
// The anti-hallucination guard has to survive intact. "Landed in a renumbered batch" and "names a
// file that does not exist" are different failures and must stay distinguishable.

test("a re-plan that renumbers batches does not discard valid enrichment", () => {
  const row = (p) => ({ path: p, summary: `about ${p}`, role: "core-logic", tags: ["x"] });

  // This file was written when these two paths were batch 1. After a re-plan, batch 1 holds
  // something else entirely — so under the positional check both entries are dropped.
  const writtenUnderOldLayout = [row("src/a.js"), row("src/b.js")];
  const renumbered = { batchIndex: 1, files: [{ path: "src/c.js" }] };
  const indexed = new Set(["src/a.js", "src/b.js", "src/c.js"]);

  const { entries, issues } = validateBatch(renumbered, writtenUnderOldLayout, indexed);

  assert.deepEqual(
    entries.map((e) => e.path).sort(),
    ["src/a.js", "src/b.js"],
    "summaries for real indexed files survive a renumbering",
  );
  assert.ok(
    issues.some((i) => i.includes("src/a.js") && !i.includes("dropped")),
    "the move is reported, not silently absorbed",
  );
});

test("a path absent from the index is still dropped, even during a re-plan", () => {
  const renumbered = { batchIndex: 1, files: [{ path: "src/c.js" }] };
  const rows = [
    { path: "src/a.js", summary: "real, just moved", role: "core-logic", tags: [] },
    { path: "src/invented.js", summary: "hallucinated", role: "core-logic", tags: [] },
  ];
  const indexed = new Set(["src/a.js", "src/c.js"]);

  const { entries, issues } = validateBatch(renumbered, rows, indexed);

  assert.deepEqual(entries.map((e) => e.path), ["src/a.js"]);
  assert.ok(
    issues.some((i) => i.includes("src/invented.js") && i.includes("dropped")),
    "an unknown path is still dropped, and said so",
  );
});

test("per-batch coverage is not reported when the layout has shifted", () => {
  // "'src/c.js' was not covered" is meaningless here: another renumbered batch file carries it.
  // Coverage is a property of the whole merge, not of one batch, once numbering can move.
  const renumbered = { batchIndex: 1, files: [{ path: "src/c.js" }] };
  const rows = [{ path: "src/a.js", summary: "moved here", role: "core-logic", tags: [] }];
  const indexed = new Set(["src/a.js", "src/c.js"]);

  const { issues } = validateBatch(renumbered, rows, indexed);
  assert.ok(!issues.some((i) => i.includes("was not covered")), "no spurious coverage complaint");
});

test("without an index, the strict positional check is unchanged", () => {
  // Callers that do not pass the index keep the original behaviour, so nothing else shifts.
  const batch = { batchIndex: 1, files: [{ path: "src/a.js" }] };
  const rows = [{ path: "src/other.js", summary: "s", role: "core-logic", tags: [] }];
  const { entries, issues } = validateBatch(batch, rows);
  assert.deepEqual(entries, []);
  assert.ok(issues.some((i) => i.includes("was not in this batch")));
  assert.ok(issues.some((i) => i.includes("was not covered")));
});
