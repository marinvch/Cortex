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
