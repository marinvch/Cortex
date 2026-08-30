#!/usr/bin/env node
// cortex-preflight.mjs — where am I, and what am I allowed to write here.
//
//   node tools/cortex-preflight.mjs                    # root, profile, index freshness
//   node tools/cortex-preflight.mjs notes/foo.md       # ...and is that path gitignored
//   node tools/cortex-preflight.mjs --json             # for a ritual to walk
//
// Nearly every ritual opens by re-deriving the same three facts before it may touch anything: which
// root it is standing in, which world this install serves (so it knows what the firewall refuses),
// and whether the index it is about to read is older than the code it describes. Each one restated
// that in prose, and prose copies drift — AGENTS.md still described the mode/audience seam as two
// questions long after `profile` made it three.
//
// So this asks once, in code, and the rituals point at it. The profile half is not re-derived here:
// it comes from core/profile.js, which reads only CORTEX_PROFILE and is the single place that rule
// lives. A fourth copy of "which world is this" is exactly the failure docs/changing-cortex.md
// warns about.
//
// It writes nothing, ever. A preflight that modified the thing it was checking would be the last
// place anyone would look for a surprise write.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProfile, UnknownProfileError } from "../core/profile.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const paths = args.filter((a) => !a.startsWith("--"));
const cwd = process.cwd();

/** Run git, returning trimmed stdout — or null when git fails or is absent. */
function git(...argv) {
  try {
    return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// --- root ---------------------------------------------------------------------------------------

// The git toplevel, not cwd. A ritual invoked from a subdirectory that resolves paths against cwd
// writes into the wrong half of the repo, and the mistake is silent — the file lands somewhere
// plausible. Outside a repo, cwd is the honest answer and the caller is told which one it got.
const toplevel = git("rev-parse", "--show-toplevel");
const root = toplevel ? resolve(toplevel) : cwd;
const inGit = Boolean(toplevel);

// Is this Cortex's own source, a Cortex-managed target repo, or neither? The rituals split on this:
// /optimize-context targets other repos, /cortex-audit targets this vault, and running either in the
// wrong one produces confident nonsense.
const kind = existsSync(join(root, "skills")) && existsSync(join(root, "references"))
  ? "cortex-source"
  : existsSync(join(root, ".cortex"))
    ? "cortex-installed"
    : "uninstalled";

// --- profile ------------------------------------------------------------------------------------

let profile;
try {
  profile = resolveProfile({ env: process.env });
} catch (err) {
  if (err instanceof UnknownProfileError) {
    console.error(`cortex: ${err.message}`);
    process.exit(2);
  }
  throw err;
}

// --- index freshness ----------------------------------------------------------------------------

// "Re-run the index first if it is stale" is advice six rituals give and none can act on, because
// none of them defines stale. It is defined here: the index is stale when a tracked source file has
// been modified since the index was written. A picture of a repo that no longer exists is worse than
// no picture — the reader trusts it.
//
// mtime, not git history, because an uncommitted edit is exactly the case a pre-write check must
// catch. The known cost: a `git checkout` or a fresh clone rewrites mtimes and reads as stale when
// nothing changed. That error points at re-running a deterministic index — cheap and correct — while
// the opposite error hands someone a confident map of code that moved. Prefer the cheap one.
function indexState() {
  const dir = join(root, ".cortex", "index");
  if (!existsSync(dir)) return { present: false };

  let newest = 0;
  for (const name of readdirSync(dir)) {
    try {
      newest = Math.max(newest, statSync(join(dir, name)).mtimeMs);
    } catch { /* a file that vanished mid-walk is not a freshness signal */ }
  }
  if (!newest) return { present: false };

  const ageDays = Math.floor((Date.now() - newest) / 86_400_000);
  if (!inGit) return { present: true, ageDays, stale: null, staleReason: "not a git repo — cannot tell" };

  // Only tracked files count. A node_modules refresh or a build artifact is not a reason to re-index,
  // and treating it as one trains the reader to ignore the warning.
  const tracked = git("ls-files") || "";
  const changed = [];
  for (const rel of tracked.split("\n").filter(Boolean)) {
    if (rel.startsWith(".cortex/")) continue;
    try {
      if (statSync(join(root, rel)).mtimeMs > newest) changed.push(rel);
    } catch { /* deleted-but-tracked; the index cannot be stale because of a file that is gone */ }
    if (changed.length >= 5) break;
  }
  return {
    present: true,
    ageDays,
    stale: changed.length > 0,
    changedSince: changed,
  };
}

const index = indexState();

// --- the privacy check --------------------------------------------------------------------------

// `git check-ignore -v` is what AGENTS.md demands before archiving personal content — "archiving is
// not sanitizing" — and what /capture and /cortex-audit each spell out separately. One call, one
// answer, and the reason is carried with it so a caller can quote which rule matched.
function ignoreState(p) {
  const abs = resolve(cwd, p);
  const rel = relative(root, abs).split("\\").join("/");
  if (!inGit) return { path: rel || p, ignored: null, why: "not a git repo — gitignore does not apply" };
  try {
    const out = execFileSync("git", ["check-ignore", "-v", "--no-index", abs], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { path: rel, ignored: true, why: out.split("\n")[0] };
  } catch {
    return { path: rel, ignored: false, why: "no .gitignore rule matches — this path would be committed" };
  }
}

const checked = paths.map(ignoreState);

// --- report ---------------------------------------------------------------------------------------

if (asJson) {
  console.log(JSON.stringify({ root, inGit, kind, profile, index, paths: checked }, null, 2));
  process.exit(0);
}

const KINDS = {
  "cortex-source": "Cortex's own source — /cortex-audit and the contributor invariants apply here",
  "cortex-installed": "a repo with Cortex installed — /cortex-next names the step it is on",
  uninstalled: "no .cortex/ — /cortex-install is the entry point",
};

console.log(`\nroot      ${root}${inGit ? "" : "   (not a git repo — cwd)"}`);
console.log(`kind      ${kind} — ${KINDS[kind]}`);
console.log(`profile   ${profile.profile} (${profile.source})`);
console.log(`          refuses: ${profile.policy.refuses} · outward sync: ${profile.policy.outwardSync ? "allowed" : "sealed"}`);
console.log(`          ${profile.policy.summary}`);

if (!index.present) {
  console.log(`index     none — run \`node index/cortex-index.mjs .\` before reading one`);
} else if (index.stale) {
  console.log(`index     ${index.ageDays}d old and STALE — ${index.changedSince.length}+ tracked files newer:`);
  for (const f of index.changedSince) console.log(`            ${f}`);
  console.log(`          re-run \`node index/cortex-index.mjs .\` first`);
} else {
  console.log(`index     ${index.ageDays}d old, current${index.staleReason ? ` (${index.staleReason})` : ""}`);
}

for (const c of checked) {
  const mark = c.ignored === null ? "?" : c.ignored ? "ignored" : "COMMITTED";
  console.log(`\npath      ${c.path} — ${mark}`);
  console.log(`          ${c.why}`);
}

// A path that would be committed is the one case worth a non-zero exit: a ritual asked "is it safe
// to write personal content here" and the answer is no. Callers that only wanted the report pass no
// paths and always get 0.
if (checked.some((c) => c.ignored === false)) process.exit(1);
