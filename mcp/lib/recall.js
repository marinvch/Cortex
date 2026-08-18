// Lexical recall over a vault. This module owns SCORING — which note answers a query, and why.
// It deliberately owns no filesystem access: walking the tree and applying `.cortexignore` is the
// Vault's job (docs/adr/0007). Before that split, recall seeded its own recursive walk from the
// root and joined onto a local `dir`, which bypassed the path guard without ever writing
// `join(root, …)` — the kind of hole a syntactic check cannot see.

import { openVault } from "./vault.js";

/** Absolute paths to every markdown file the vault considers knowledge. */
export function listMarkdown(root) {
  const vault = openVault(root);
  return vault.list("", { ext: ".md" }).map((rel) => vault.abs(rel));
}

function tokenize(s) {
  return s.toLowerCase().match(/[a-z0-9]+/g) || [];
}

// `rel` is a root-relative POSIX path, so it splits on "/" regardless of host. Splitting on the
// platform separator here was a real bug class: on Windows a path built from POSIX segments has no
// backslashes to split on, so every project filter silently matched nothing. Same reasoning as
// mode.js — a separator is a fact about the string, not about the machine.
function matchesProject(rel, project) {
  if (!project) return true;
  const p = project.toLowerCase();
  const parts = rel.toLowerCase().split("/");
  const pIdx = parts.indexOf("projects");
  if (pIdx >= 0 && parts[pIdx + 1] && parts[pIdx + 1].replace(/\.md$/, "") === p) return true;
  return parts.some((seg) => seg.replace(/\.md$/, "") === p);
}

export function recall(root, { query, project, limit = 8 }) {
  const vault = openVault(root);
  const terms = tokenize(query);
  const hits = [];
  for (const rel of vault.list("", { ext: ".md" })) {
    if (!matchesProject(rel, project)) continue;
    let text;
    try { text = vault.read(rel); } catch { continue; }
    const lower = text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      let idx = 0;
      while ((idx = lower.indexOf(t, idx)) !== -1) { score++; idx += t.length; }
    }
    if (score === 0) continue;
    // snippet around first matching term
    const first = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, first - 60);
    const snippet = text.slice(start, start + 200).replace(/\s+/g, " ").trim();
    hits.push({ rel, score, snippet, mtime: vault.mtimeMs(rel) });
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  // Callers get absolute paths, as they always have. `list` is root-relative because that is the
  // safe internal currency; the conversion back is explicit and happens exactly here.
  return hits.slice(0, limit).map(({ rel, score, snippet }) => ({ path: vault.abs(rel), score, snippet }));
}
