// Deterministic batching for the enrichment pass.
//
// Enrichment is the one part of Cortex that costs tokens, so the shape of the work is decided
// here — in code, reproducibly — rather than by a model improvising. Given the same index, the
// same batches come out, which is what makes an interrupted enrichment resumable: re-batch, see
// which batch files already exist on disk, and do only the rest.

export const DEFAULT_MAX_LINES = 1500;
export const DEFAULT_MAX_FILES = 12;

/**
 * Files worth spending a summary on. Lockfiles, generated output and empty files carry no meaning
 * a reader could not get faster from the path itself.
 */
export function isEnrichable(f) {
  if (!f.lines || f.lines < 3) return false;
  if (f.category === "other") return false;
  return true;
}

/**
 * Group into batches that are cheap to reason about: same area, related by imports, bounded in
 * size. Cohesion matters more than perfect packing — a batch whose files import each other gets
 * better summaries than one assembled by size alone.
 */
export function computeBatches(index, { maxLines = DEFAULT_MAX_LINES, maxFiles = DEFAULT_MAX_FILES } = {}) {
  const enrichable = index.files.filter(isEnrichable);
  const byPath = new Map(enrichable.map((f) => [f.path, f]));

  // Layer assignment is already deterministic and already reflects directory structure.
  const layerOf = new Map();
  for (const layer of index.layers) {
    for (const p of layer.paths) layerOf.set(p, layer.name);
  }

  const groups = new Map();
  for (const f of enrichable) {
    const key = layerOf.get(f.path) ?? "root";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  const batches = [];
  for (const [layerName, files] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Within a layer, keep a file next to the things it imports so a batch reads as one story.
    const ordered = orderByCohesion(files);
    let current = [];
    let lines = 0;
    const flush = () => {
      if (!current.length) return;
      batches.push({ layer: layerName, files: current });
      current = [];
      lines = 0;
    };
    for (const f of ordered) {
      if (current.length >= maxFiles || (lines + f.lines > maxLines && current.length)) flush();
      current.push(f);
      lines += f.lines;
    }
    flush();
  }

  return batches.map((b, i) => {
    const paths = new Set(b.files.map((f) => f.path));
    // Neighbours give the model the shape of what a batch touches without paying to summarise it.
    const neighbours = new Set();
    for (const f of b.files) {
      for (const t of f.imports) if (!paths.has(t)) neighbours.add(t);
    }
    for (const e of index.edges) {
      if (!paths.has(e.from) && paths.has(e.to)) neighbours.add(e.from);
    }
    return {
      batchIndex: i + 1,
      layer: b.layer,
      files: b.files.map((f) => ({
        path: f.path,
        lang: f.lang,
        category: f.category,
        lines: f.lines,
        isTest: f.isTest,
        isEntry: f.isEntry,
        imports: f.imports,
        inbound: f.inbound,
      })),
      neighbours: [...neighbours].sort(),
    };
  });
}

/** Depth-first over the import graph within a group, so importers sit beside what they import. */
function orderByCohesion(files) {
  const inGroup = new Map(files.map((f) => [f.path, f]));
  const seen = new Set();
  const out = [];
  const visit = (f) => {
    if (seen.has(f.path)) return;
    seen.add(f.path);
    out.push(f);
    for (const t of f.imports) {
      const next = inGroup.get(t);
      if (next) visit(next);
    }
  };
  // Start from the most-depended-upon files so roots of the local graph come first, then anything
  // unvisited in path order. Sorting first keeps the whole walk deterministic.
  for (const f of [...files].sort((a, b) => b.inbound - a.inbound || a.path.localeCompare(b.path))) {
    visit(f);
  }
  return out;
}

export function batchStats(batches) {
  return {
    batches: batches.length,
    files: batches.reduce((a, b) => a + b.files.length, 0),
    lines: batches.reduce((a, b) => a + b.files.reduce((x, f) => x + f.lines, 0), 0),
  };
}
