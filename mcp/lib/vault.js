// The Vault — the only door onto a vault root.
//
// Before this module, path safety was something five modules had to remember. `core/paths.js` held
// a correct guard and `getProjectContext` called it, while `cortexignore`, `projects` and `recall`
// each joined onto the root themselves. That is a lock on one door in a building with three, and
// the way you find out which door was left open is a disclosure bug.
//
// So the guard stops being a function callers remember to call and becomes the only way in. Every
// operation here takes a ROOT-RELATIVE path and resolves it through `resolveInRoot`; nothing else
// under `mcp/` may join onto a vault root. `mcp/test/vault-is-the-only-door.test.js` enforces that,
// because a rule a test keeps is cheaper than a rule everyone has to.
//
// What this module deliberately does NOT do:
//
//   - **Scrubbing.** Secret refusal is policy and lives in `core/scrub.js` with its callers. Folding
//     it in would make every write pay for it and would hide a refusal behind a path operation.
//   - **Naming.** `slug.js` decides what a project is called; that is a different question.
//   - **Remote sync.** `gitsync.js` is the team mode's dependency, not the vault's.
//
// It lives in `mcp/lib/` rather than `core/` on purpose: `core/` is the kernel BOTH leaves share,
// and `index/` has no use for vault semantics — it asks git what belongs to a repo (ADR 0003) and
// deliberately does not read `.cortexignore`. See docs/adr/0007.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { resolveInRoot } from "../../core/paths.js";
import {
  ALWAYS_SKIP_DIRS,
  FALLBACK_SKIP_DIRS,
  FALLBACK_SKIP_FILES,
  parseCortexignore,
} from "./cortexignore.js";

const IGNORE_FILE = ".cortexignore";

// Built once per vault. `.cortexignore` is itself a vault path, so it is read through the same door
// as everything else rather than by a second, unguarded readFileSync.
function ignoreFilter(read, exists) {
  const parsed = exists(IGNORE_FILE) ? parseCortexignore(read(IGNORE_FILE)) : null;
  const skipNames = new Set(parsed ? ALWAYS_SKIP_DIRS : FALLBACK_SKIP_DIRS);
  if (!parsed) {
    const skipFileNames = new Set(FALLBACK_SKIP_FILES);
    return {
      skipDir: (rel) => skipNames.has(rel.split("/").pop()),
      skipFile: (rel) => skipFileNames.has(rel.split("/").pop()),
    };
  }
  return {
    // Pruning a directory is equivalent to filtering every path beneath it, and much cheaper.
    skipDir: (rel) => skipNames.has(rel.split("/").pop()) || parsed.dirs.some((re) => re.test(`${rel}/`)),
    skipFile: (rel) => parsed.files.some((re) => re.test(rel)),
  };
}

/**
 * Open a vault at `root`. Every returned operation takes a root-relative path and throws
 * `OutsideRootError` for one that escapes.
 */
export function openVault(root) {
  const abs = (rel) => resolveInRoot(root, rel);
  const read = (rel) => readFileSync(abs(rel), "utf8");
  // Resolves BEFORE testing existence, so an escaping path is refused rather than answered. A
  // truthful "false" would still confirm something about a path outside the root, and would teach
  // callers that exists() is safe on untrusted input.
  const exists = (rel) => existsSync(abs(rel));

  let filter = null;
  const getFilter = () => (filter ??= ignoreFilter(read, exists));

  function walk(relDir, ext, out) {
    let entries;
    try {
      entries = readdirSync(abs(relDir || "."), { withFileTypes: true });
    } catch {
      return out; // a missing scope is an empty list, not an error
    }
    const { skipDir, skipFile } = getFilter();
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (skipDir(rel)) continue;
        walk(rel, ext, out);
      } else if (e.isFile()) {
        if (ext && !e.name.endsWith(ext)) continue;
        if (skipFile(rel)) continue;
        out.push(rel);
      }
    }
    return out;
  }

  return {
    root,
    abs,
    read,
    exists,

    /** Root-relative POSIX paths under `scope`, `.cortexignore` applied. Recursive. */
    list(scope = "", { ext = null } = {}) {
      // Only trailing separators are trimmed. Normalising a LEADING ".." away would neutralise an
      // escape instead of refusing it — quietly listing the root when the caller asked for its
      // parent. The guard's job is to say no, not to guess what was meant.
      const raw = String(scope).replace(/[\\/]+$/, "");
      const rel = raw === "" || raw === "." ? "" : raw;
      abs(rel || "."); // resolve the scope itself, so `list("..")` throws rather than walks
      return walk(rel, ext, []);
    },

    write(rel, text) {
      const p = abs(rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    },

    append(rel, text) {
      const p = abs(rel);
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, text);
    },
  };
}
