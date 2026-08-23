// Layer inference from directory structure. No LLM: directory layout is the strongest available
// signal for how a team already thinks about its own code, and it costs nothing to read.

function kebab(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
}

// A file's layer key is its top-level directory, except that a few conventional wrappers carry no
// meaning on their own and the level below them is what people actually name.
const TRANSPARENT = new Set(["src", "lib", "app", "packages", "apps", "internal", "pkg"]);

export function layerKeyFor(path) {
  const parts = path.split("/");
  if (parts.length === 1) return "root";
  if (TRANSPARENT.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

/**
 * Group files into layers. Returns a deterministic, sorted array; every indexed file lands in
 * exactly one layer, so the caller can rely on total coverage.
 */
export function inferAreas(files) {
  const byKey = new Map();
  for (const f of files) {
    const key = layerKeyFor(f.path);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f.path);
  }

  const layers = [];
  for (const [key, paths] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    layers.push({
      id: `area:${kebab(key)}`,
      name: key,
      description: `Files under ${key === "root" ? "the repository root" : `${key}/`}`,
      paths: paths.sort(),
    });
  }
  return layers;
}

/**
 * Directories that are candidates for their own scoped AGENTS.md, ranked. This only PROPOSES —
 * the decision is the user's, so every candidate carries the reason it was surfaced.
 */
export function briefCandidates(files, { minFiles = 5 } = {}) {
  const byDir = new Map();
  for (const f of files) {
    // A scoped brief is context an agent loads before touching an area. Nobody touches vendored
    // code, so ranking it here wasted the top three slots on a real repo — a plugin cache, a
    // generated server and another tool's instruction files, with the actual application fourth.
    // Declared in .gitattributes; a repo that declares nothing is unaffected.
    if (f.vendored) continue;
    const parts = f.path.split("/");
    if (parts.length < 2) continue;
    const dir = TRANSPARENT.has(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    if (!byDir.has(dir)) byDir.set(dir, { dir, files: 0, code: 0, tests: 0, lines: 0, hot: 0 });
    const d = byDir.get(dir);
    d.files++;
    d.lines += f.lines || 0;
    if (f.category === "code") d.code++;
    if (f.isTest) d.tests++;
    if (f.commits) d.hot += f.commits;
  }

  const out = [];
  for (const d of byDir.values()) {
    if (d.code < minFiles) continue;
    const reasons = [];
    if (d.code >= 15) reasons.push(`${d.code} code files — large enough to need its own context`);
    else reasons.push(`${d.code} code files`);
    if (d.tests === 0) reasons.push("no tests in this area — invariants live only in prose");
    if (d.hot > 0) reasons.push(`${d.hot} recent commits — actively changing`);
    if (d.lines > 3000) reasons.push(`${d.lines} lines`);
    out.push({
      dir: d.dir,
      score: d.code * 2 + d.hot * 3 + (d.tests === 0 ? 10 : 0) + Math.floor(d.lines / 500),
      files: d.files,
      codeFiles: d.code,
      tests: d.tests,
      lines: d.lines,
      commits: d.hot,
      reasons,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.dir.localeCompare(b.dir));
}
