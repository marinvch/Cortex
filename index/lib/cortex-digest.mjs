// cortex-digest.mjs — one hash over the Cortex code a stamped workflow runs.
//
// `cortex-review.yml` clones Cortex inside a team's CI and runs `index/cortex-index.mjs` and
// `index/cortex-review.mjs` against their private code. It cloned by release tag, and a tag is a
// name: whoever can push to the source can point it at other code after the workflow was reviewed.
// So the stamp act records this digest of the code it is stamping from, and the workflow refuses to
// run a clone whose code hashes differently (docs/adr/0028).
//
// A commit SHA would be the usual pin, and it is not available here: an installed plugin is a copy
// without `.git`, and the release tag is made after the merge, so the plugin cannot carry its own
// commit. The digest is computed from the files themselves, so it needs no git, no network and no
// clock — the same answer on the machine that stamps and on the runner that verifies.
//
// What it covers, and the CI step must agree byte for byte (index/test/cortex-digest.test.mjs runs
// the step's own script against this module):
//
//   - every file under `core/` and `index/`, except any path with a `test` directory in it — the
//     code those two commands import, and nothing they never load;
//   - `VERSION`, which `index/` reads.
//
// Each file's text has CRLF folded to LF first, so a Windows checkout with `core.autocrlf` and a
// Linux runner agree. The digest is sha256 over one line per file, `<sha256 of text>  <path>\n`,
// sorted by path in code-unit order. Files are read as UTF-8; there is no binary file in either tree.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** This checkout's root — the plugin root in an install, the repo root in a clone. */
export const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The trees the digest walks, and the one file beside them. */
export const DIGEST_DIRS = Object.freeze(["core", "index"]);
export const DIGEST_FILES = Object.freeze(["VERSION"]);

const sha = (s) => createHash("sha256").update(s).digest("hex");

function walk(root, rel, out) {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "test") walk(root, p, out);
    } else if (e.isFile()) out.push(p);
  }
}

/** The files the digest covers, as sorted posix paths relative to `root`. */
export function digestFiles(root = PLUGIN_ROOT) {
  const out = [];
  for (const d of DIGEST_DIRS) walk(root, d, out);
  for (const f of DIGEST_FILES) if (existsSync(join(root, f))) out.push(f);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** sha256 hex over the Cortex code at `root`. Deterministic: no git, no network, no clock. */
export function cortexDigest(root = PLUGIN_ROOT) {
  const lines = digestFiles(root).map((p) => `${sha(readFileSync(join(root, ...p.split("/")), "utf8").replace(/\r\n/g, "\n"))}  ${p}\n`);
  return sha(lines.join(""));
}
