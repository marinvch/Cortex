// symbol-calls.js — who calls a function, what it calls, and what a file defines, read from
// `index.symbols` (G5 of docs/specs/2026-10-25-code-graph-design.md).
//
// Both `index/cortex-impact.mjs --symbol` and the `graph` tool's `callers`, `callees` and `defines`
// read this module, so "a caller" has one definition. `mcp/` may not import `index/`, which is why
// it lives in `core/`.
//
// ## What a caller is
//
// A call in `index.symbols.calls` whose `to` names the symbol. Each one carries the confidence the
// indexer gave it (`index/lib/symbols.mjs`'s header has the rules):
//
// - `extracted` — the floor. These calls reach this symbol.
// - `inferred` — listed apart. One candidate, found without a binding that names it.
// - `ambiguous` — listed apart, with how many candidates the call had. It may reach another one.
//
// A call that resolved to nothing is not in the index, so every list here is a floor: a dynamic
// call, a call through a value whose type Cortex cannot know, or a file with no parser is missing.
//
// Pure: it reads the object it is handed and never the disk.

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `path#name` → `[path, name]`; an id with no `#` is a file, with an empty name. */
export function splitSymbolId(id) {
  const i = id.indexOf("#");
  return i < 0 ? [id, ""] : [id.slice(0, i), id.slice(i + 1)];
}

/** Whether `index.symbols` is there to answer from. */
export function hasSymbols(index) {
  return Boolean(index?.symbols && Array.isArray(index.symbols.definitions) && Array.isArray(index.symbols.calls));
}

/** The definitions in one file, in line order. */
export function definitionsIn(symbols, path) {
  return symbols.definitions
    .filter((d) => splitSymbolId(d.id)[0] === path)
    .sort((a, b) => a.line - b.line || byCodeUnit(a.id, b.id));
}

/** The definition with this id, or null. */
export function findDefinition(symbols, id) {
  return symbols.definitions.find((d) => d.id === id) ?? null;
}

/**
 * Ids a person may have meant, for an id that is not a definition: the same name in other files
 * first, then the definitions of the file named. At most five.
 */
export function nearSymbols(symbols, id) {
  const [path, name] = splitSymbolId(id);
  // Case is ignored: `resolveInroot` for `resolveInRoot` is the commonest miss.
  const fold = (s) => s.toLowerCase();
  const leaf = fold(name.split(".").pop());
  const sameName = symbols.definitions
    .filter((d) => {
      const n = fold(splitSymbolId(d.id)[1]);
      return leaf && (n === fold(name) || n.split(".").pop() === leaf);
    })
    .map((d) => d.id);
  const sameFile = definitionsIn(symbols, path).map((d) => d.id);
  return [...new Set([...sameName.sort(byCodeUnit), ...sameFile])].filter((x) => x !== id).slice(0, 5);
}

/**
 * The calls that reach `id`, split by confidence. Each item is `{ from, line, name, kind? }`, and an
 * ambiguous one also carries `candidates`, the number of definitions the call may reach.
 */
export function callersOf(symbols, id) {
  const out = { extracted: [], inferred: [], ambiguous: [] };
  for (const c of symbols.calls) {
    if (!c.to.includes(id)) continue;
    const item = { from: c.from, line: c.line, name: c.name, ...(c.kind ? { kind: c.kind } : {}) };
    if (c.confidence === "ambiguous") out.ambiguous.push({ ...item, candidates: c.to.length });
    else (out[c.confidence] ?? out.inferred).push(item);
  }
  const order = (a, b) => byCodeUnit(a.from, b.from) || a.line - b.line;
  for (const k of Object.keys(out)) out[k].sort(order);
  return out;
}

/** The calls made from inside `id`, in line order: `{ line, name, kind?, to, confidence }`. */
export function calleesOf(symbols, id) {
  return symbols.calls
    .filter((c) => c.from === id)
    .map((c) => ({ line: c.line, name: c.name, ...(c.kind ? { kind: c.kind } : {}), to: c.to, confidence: c.confidence }))
    .sort((a, b) => a.line - b.line || byCodeUnit(a.name, b.name));
}

/** The files the given calls sit in, sorted and once each. */
export function callerFiles(calls) {
  return [...new Set(calls.map((c) => splitSymbolId(c.from)[0]))].sort(byCodeUnit);
}
