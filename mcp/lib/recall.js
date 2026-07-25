import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { makeIgnoreFilter } from "./cortexignore.js";

export function listMarkdown(root) {
  // `.cortexignore` decides what is knowledge — same contract the bash generators honour.
  const { skipDir, skipFile } = makeIgnoreFilter(root);
  const out = [];
  const walk = (dir, relDir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (skipDir(rel)) continue;
        walk(join(dir, e.name), rel);
      } else if (e.isFile() && e.name.endsWith(".md") && !skipFile(rel)) {
        out.push(join(dir, e.name));
      }
    }
  };
  walk(root, "");
  return out;
}

function tokenize(s) {
  return s.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function matchesProject(path, project) {
  if (!project) return true;
  const p = project.toLowerCase();
  const parts = path.toLowerCase().split(sep);
  const pIdx = parts.indexOf("projects");
  if (pIdx >= 0 && parts[pIdx + 1] && parts[pIdx + 1].replace(/\.md$/, "") === p) return true;
  return parts.some((seg) => seg.replace(/\.md$/, "") === p);
}

export function recall(root, { query, project, limit = 8 }) {
  const terms = tokenize(query);
  const hits = [];
  for (const path of listMarkdown(root)) {
    if (!matchesProject(path, project)) continue;
    let text;
    try { text = readFileSync(path, "utf8"); } catch { continue; }
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
    hits.push({ path, score, snippet, mtime: statSync(path).mtimeMs });
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return hits.slice(0, limit).map(({ path, score, snippet }) => ({ path, score, snippet }));
}
