import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listFiles, MAX_INDEXED_BYTES } from "./walk.mjs";
import { repoText } from "./repo-text.mjs";
import { detectLanguage, categoryOf, isTestPath, isEntryPath } from "./langs.mjs";
import { extractImports } from "./imports.mjs";
import { importResolver } from "./resolvers.mjs";
import { inferAreas } from "./layers.mjs";
import { detectStack } from "./stack.mjs";
import { depthOf } from "./depth.mjs";
import { vendoredPaths, vendoredStats } from "./vendored.mjs";
import { INDEX_VERSION } from "./format.mjs";

// The index format version. It is defined in format.mjs so a consumer can check what it is reading
// without importing the builder, and re-exported here because this is where callers look for it.
export { INDEX_VERSION } from "./format.mjs";

function git(root, args) {
  try {
    // execFileSync with an argument array — never a shell string, so repo paths can't inject.
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * Commit counts per file, and the window they were counted over.
 *
 * The window is recent by design — churn matters because it is *current*. But a repo whose whole
 * history predates it scored 0 everywhere, and nothing said so: `/cortex-brief`'s "ranked by size,
 * churn and absence of tests" quietly degraded to ranking by size, `/cortex-impact` lost its
 * tiebreak, and the viewer's hot spots emptied. A real repo with 11 commits hit this — no error, no
 * warning, just a signal that had silently become a constant.
 *
 * So: if the window finds nothing and the repo does have history, count all of it and say which
 * window was used. A stated wider window is honest; a silent zero is not. Absent git entirely,
 * every file scores 0 and `window` is null — the caller can tell "no churn" from "no git", which
 * is the same distinction UNRESOLVED_LANGUAGES exists to preserve for imports.
 *
 * Returns `{ counts, window }`. The window is not decoration: it is printed, so a reader knows
 * whether "12 commits" means twelve this quarter or twelve ever.
 */
export function hotspots(root, { since = "3 months ago" } = {}) {
  let window = since;
  let out = git(root, ["log", `--since=${since}`, "--name-only", "--pretty=format:"]);
  if (out !== null && !out.trim()) {
    const all = git(root, ["log", "--name-only", "--pretty=format:"]);
    if (all && all.trim()) {
      out = all;
      window = "all history";
    }
  }
  const counts = new Map();
  if (!out) return { counts, window: out === null ? null : window };
  for (const line of out.split("\n")) {
    const p = line.trim();
    if (!p) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  return { counts, window };
}

/**
 * Build the deterministic index. No LLM, no network: the same tree always produces the same
 * output, which is what makes it safe to re-run in CI and cheap to run on every install.
 */
export function buildIndex(root, opts = {}) {
  const { files: raw, skipped } = listFiles(root, opts);
  const { counts: commits, window: churnWindow } = hotspots(root, opts);
  const head = (git(root, ["rev-parse", "HEAD"]) || "").trim() || null;

  const files = raw.map((f) => {
    const lang = detectLanguage(f.path);
    return {
      path: f.path,
      lang,
      category: categoryOf(lang),
      lines: f.lines,
      bytes: f.bytes,
      isTest: isTestPath(f.path),
      isEntry: isEntryPath(f.path),
      commits: commits.get(f.path) || 0,
      // Declared in .gitattributes, never inferred from a directory name. A vendored file stays in
      // the index — git-truth is the point — but every consumer that ranks or costs by size can now
      // tell somebody else's code from this team's. Filled in just below, in one git call.
      vendored: false,
      imports: [],
    };
  });

  // Every read of the repo's text from here down — the import scan and the stack manifests — goes
  // through one source with one cap. The cap is the walker's own ceiling, so the builder can never
  // read less than the file list it is building from without saying so.
  const text = repoText(root, { index: { files }, cap: opts.maxBytes ?? MAX_INDEXED_BYTES });

  // One `git check-attr` for the whole tree. Per-file calls cost more than the rest of the index.
  const marked = vendoredPaths(root, files.map((f) => f.path));
  for (const f of files) f.vendored = marked.has(f.path);

  // Every language's resolution context, prepared once, behind one seam — see lib/resolvers.mjs.
  // What a language needs precomputed (go.mod's module path, Rust's crate roots, composer.json's
  // PSR-4 prefixes, the tsconfig alias tables) and how it turns one specifier into files are both
  // that language's business, not the builder's. Reading is injected for the same reason it is in
  // repo-text.mjs: it keeps every one of those derivations a pure function of its inputs.
  //
  // Raw reads, not `text.read`: these are the repo's declared manifests, which may sit outside the
  // indexed set entirely — an untracked `go.mod` still names the module every import is measured
  // against.
  const readText = (rel) => {
    try {
      return readFileSync(join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const resolver = importResolver(files, root, readText);

  const edges = [];

  for (const f of files) {
    if (f.category !== "code" && f.category !== "script") continue;
    // One reading rule for the whole product, in lib/repo-text.mjs. A file that cannot be read
    // costs its edges — and since an edge is missing rather than wrong, everything downstream
    // (orphans, impact, depth, the viewer) reads it as a file nothing points at. The source
    // records which file and why, so that loss is countable rather than invisible.
    const body = text.read(f.path);
    if (body === null) continue;
    const seen = new Set();
    for (const spec of extractImports(body, f.lang)) {
      for (const target of resolver.resolve(spec, f)) {
        if (!target || target === f.path || seen.has(target)) continue;
        seen.add(target);
        f.imports.push(target);
        edges.push({ from: f.path, to: target, type: "imports" });
      }
    }
    f.imports.sort();
  }

  // Inbound counts let the findings pass distinguish a genuine orphan from a busy hub.
  const inbound = new Map();
  for (const e of edges) inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
  for (const f of files) f.inbound = inbound.get(f.path) || 0;

  // Needs the finished edge list, so it runs after the import pass rather than beside `areas`.
  const depth = depthOf({ files, edges });
  for (const f of files) {
    const d = depth.byPath.get(f.path);
    if (typeof d === "number") f.depth = d;
  }

  const languages = {};
  const categories = {};
  for (const f of files) {
    languages[f.lang] = (languages[f.lang] || 0) + 1;
    categories[f.category] = (categories[f.category] || 0) + 1;
  }

  return {
    version: INDEX_VERSION,
    root,
    commit: head,
    stats: {
      files: files.length,
      lines: files.reduce((a, f) => a + (f.lines || 0), 0),
      edges: edges.length,
      tests: files.filter((f) => f.isTest).length,
      languages,
      categories,
      // Readable files a directory *name* cost the index, one row per directory. Every other
      // number here describes what was found; this is the only one that describes what was not,
      // and it belongs beside them so a reader cannot see the count without seeing the gap.
      skipped,
      // Which window the `commits` numbers were counted over: the recent one, "all history" when
      // the repo is younger than it, or null when there is no git at all. Every consumer prints a
      // sentence about churn, and without this they all print the same sentence whether the number
      // means twelve commits this quarter or twelve ever.
      churnWindow,
      // What was declared as somebody else's. Reported beside the totals for the same reason
      // `skipped` is: a reader who sees "13,532 lines" must be able to see that 11,600 of them are
      // vendored, or they will read a number about another team's code as a number about theirs.
      vendored: vendoredStats(files),
    },
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    // Directory groupings. Named `areas` because that is what they are — the CLI and the
    // findings report had said so for releases while the field still claimed to be layering.
    areas: inferAreas(files),
    // Actual layering, from the import graph: depth 0 is the foundation, the highest depth is an
    // entry point. A floor, like every other number derived from regex-resolved imports.
    layers: depth.layers,
    cycles: depth.cyclic,
    // What the repo is built out of, so downstream can pick skills that fit it. Reading is
    // injected rather than done inside detectStack, which keeps that function a pure
    // transform of its inputs and testable from literals — the convention lib/repo-text.mjs
    // now applies to every scanner that reads a repo back.
    stack: detectStack(files, (rel) => text.read(rel)),
  };
}
