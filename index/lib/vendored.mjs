// vendored.mjs — which committed files are somebody else's code.
//
// `walk.mjs` asks git what exists and nothing else, and that is deliberate (see index/AGENTS.md).
// The gap it left was not the walk: it was that a legitimately committed vendored directory —
// plugin caches, a generated server, another tool's instruction files — was indistinguishable from
// hand-written source afterwards. On a real repo with ~1,900 lines of application TypeScript, the
// index reported 13,532 lines and ranked three vendored directories above the actual app as
// candidates for a scoped brief. `/cortex-enrich` then planned 13 of 21 batches over that material.
//
// The mechanism is DECLARED, not guessed — the same rule as go.mod, composer.json and tsconfig.
// `.gitattributes` already has the vocabulary, and it is the one GitHub itself uses:
//
//     .agents/**  linguist-vendored
//     .ai-os/**   linguist-generated
//
// A repo that has already marked its vendored trees gets this for free. One that has not can say so
// in the same file, in the same syntax its other tools already read — rather than learning a
// Cortex-specific format that only Cortex would honour.
//
// Nothing is EXCLUDED from the index by this. The index stays git-truth, because a file you cannot
// see is worse than one you can rank correctly. What changes is that consumers can now tell "code
// this team writes" from "code this team vendored", and say which they counted.
//
// One exception, and it lives in lib/walk.mjs: `vendor/`, vendored by Linguist's default, is left
// out of the index and counted, unless the repo declares it its own (`declaredOwn` below). Indexed
// and marked vendored instead, a committed Go tree tripled docker/cli's index and reached every
// consumer that does not ask `vendored` — the stack, the areas, "untested" (#529).

import { execFileSync } from "node:child_process";

const ATTRS = ["linguist-vendored", "linguist-generated"];

/**
 * `git check-attr` for every path at once, as `[path, attr, value]` rows. One call — per-file calls
 * cost more than the whole index on a large repo. Absent git or absent `.gitattributes`, no rows.
 */
function checkAttr(root, paths, attrs) {
  if (!paths.length) return [];
  let out;
  try {
    out = execFileSync("git", ["check-attr", "--stdin", ...attrs], {
      cwd: root,
      input: paths.join("\n"),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return []; // no git, or no attributes — nothing is declared, which is a real answer
  }
  const rows = [];
  // `<path>: <attr>: <value>`; a path may contain ": ", so split from the right on the known tail.
  for (const line of out.split("\n")) {
    if (!line) continue;
    const cut = line.lastIndexOf(": ");
    if (cut === -1) continue;
    const rest = line.slice(0, cut);
    const attrCut = rest.lastIndexOf(": ");
    if (attrCut === -1) continue;
    rows.push([rest.slice(0, attrCut), rest.slice(attrCut + 2), line.slice(cut + 2).trim()]);
  }
  return rows;
}

/** Which of `paths` are marked vendored or generated. A repo that declares nothing gets none. */
export function vendoredPaths(root, paths) {
  return new Set(checkAttr(root, paths, ATTRS).filter(([, , v]) => v === "set" || v === "true").map(([p]) => p));
}

/**
 * Which of `paths` the repo declares its own: `-linguist-vendored` or `linguist-vendored=false`.
 * `lib/walk.mjs` asks this of `vendor/`, the one directory it leaves out by Linguist's default (#529).
 */
export function declaredOwn(root, paths) {
  return new Set(checkAttr(root, paths, ["linguist-vendored"]).filter(([, , v]) => v === "unset" || v === "false").map(([p]) => p));
}

/**
 * Split a file list into the code a team writes and the code it vendored.
 *
 * Every consumer that ranks or costs by size must use this, and must say which side it counted:
 * a report that silently drops half a repo is the same failure as one that silently includes
 * somebody else's — the reader cannot tell either from a correct answer.
 */
export function partitionVendored(files) {
  const own = [];
  const vendored = [];
  for (const f of files) (f.vendored ? vendored : own).push(f);
  return { own, vendored };
}

/** Totals for the vendored half, for a report that has to name what it left out. */
export function vendoredStats(files) {
  const { vendored } = partitionVendored(files);
  const dirs = new Map();
  for (const f of vendored) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.indexOf("/")) : "(root)";
    const cur = dirs.get(dir) ?? { dir, files: 0, lines: 0 };
    cur.files += 1;
    cur.lines += f.lines ?? 0;
    dirs.set(dir, cur);
  }
  return {
    files: vendored.length,
    lines: vendored.reduce((a, f) => a + (f.lines ?? 0), 0),
    dirs: [...dirs.values()].sort((a, b) => b.lines - a.lines),
  };
}
