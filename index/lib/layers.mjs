// Layer inference from directory structure. No LLM: directory layout is the strongest available
// signal for how a team already thinks about its own code, and it costs nothing to read.

function kebab(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
}

// A file's layer key is its top-level directory, except that a few conventional wrappers carry no
// meaning on their own and the level below them is what people actually name.
const TRANSPARENT = new Set(["src", "lib", "app", "packages", "apps", "internal", "pkg"]);

/** Directories that hold agent tooling rather than product code — never a scoped-brief candidate. */
export const TOOLING_DIRS = new Set([".claude", ".cortex"]);

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
 *
 * `tested` is the set of production paths a test was found for — `codeCoverage` in
 * `lib/findings.mjs`, the answer the report's untested title and the viewer both print. Pass it.
 * Without it an area only counts the tests sitting inside it, and a Maven or Gradle repo keeps
 * every test in `src/test/`, beside the `src/main/` area it exercises: spring-petclinic's `src/main`
 * was offered a brief because it had "no tests in this area" while the same report found tests for
 * 20 of its 30 files (#460). An area is untested when it holds no test AND no test was found for
 * any of its code, wherever that test lives.
 */
export function briefCandidates(files, { minFiles = 5, tested = null } = {}) {
  const byDir = new Map();
  for (const f of files) {
    // A scoped brief is context an agent loads before touching an area. Nobody touches vendored
    // code, so ranking it here wasted the top three slots on a real repo — a plugin cache, a
    // generated server and another tool's instruction files, with the actual application fourth.
    // Declared in .gitattributes; a repo that declares nothing is unaffected.
    if (f.vendored) continue;
    const parts = f.path.split("/");
    if (parts.length < 2) continue;
    // The agent tooling's own folders are not an area of the product. `.claude/` holds the skills,
    // hooks and subagents Cortex itself writes; proposing a brief for it asks an agent to be
    // briefed on its own briefing. The viewer suggested exactly that on a real repo.
    if (TOOLING_DIRS.has(parts[0])) continue;
    const dir = TRANSPARENT.has(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    if (!byDir.has(dir)) byDir.set(dir, { dir, files: 0, code: 0, tests: 0, tested: 0, lines: 0, hot: 0 });
    const d = byDir.get(dir);
    d.files++;
    d.lines += f.lines || 0;
    if (f.category === "code") d.code++;
    if (f.isTest) d.tests++;
    else if (f.category === "code" && tested?.has(f.path)) d.tested++;
    if (f.commits) d.hot += f.commits;
  }

  const out = [];
  for (const d of byDir.values()) {
    if (d.code < minFiles) continue;
    const untested = d.tests === 0 && d.tested === 0;
    const reasons = [];
    if (d.code >= 15) reasons.push(`${d.code} code files — large enough to need its own context`);
    else reasons.push(`${d.code} code files`);
    if (untested) reasons.push("no tests in this area — invariants live only in prose");
    if (d.hot > 0) reasons.push(`${d.hot} recent commits — actively changing`);
    if (d.lines > 3000) reasons.push(`${d.lines} lines`);
    out.push({
      dir: d.dir,
      score: d.code * 2 + d.hot * 3 + (untested ? 10 : 0) + Math.floor(d.lines / 500),
      files: d.files,
      codeFiles: d.code,
      tests: d.tests,
      // Production files in this area a test was found for, wherever the test lives. 0 when the
      // caller passed no coverage — read `tests` and this together, never this alone.
      tested: d.tested,
      lines: d.lines,
      commits: d.hot,
      reasons,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.dir.localeCompare(b.dir));
}
