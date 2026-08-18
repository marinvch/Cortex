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
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { resolveInRoot } from "../../core/paths.js";
import { makeIgnoreFilter } from "./cortexignore.js";

const IGNORE_FILE = ".cortexignore";

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

  // Built once per vault, lazily — `read`/`write`/`append` never need it. `.cortexignore` is itself
  // a vault path, so it goes through this module's own `read` rather than a second, unguarded
  // readFileSync. What the patterns MEAN stays in cortexignore.js; only the fetching is here.
  let filter = null;
  const getFilter = () => (filter ??= makeIgnoreFilter(exists(IGNORE_FILE) ? read(IGNORE_FILE) : null));

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

    /**
     * Type predicates. Both resolve first, so an escaping path is REFUSED rather than answered
     * false — the same reasoning as `exists`. `getProjectContext` takes a caller-supplied slug and
     * asks these two questions about it, which is precisely where the disclosure bug lived.
     */
    isFile(rel) {
      try {
        return statSync(abs(rel)).isFile();
      } catch (e) {
        if (e?.code === "outside_root") throw e;
        return false;
      }
    },

    isDirectory(rel) {
      try {
        return statSync(abs(rel)).isDirectory();
      } catch (e) {
        if (e?.code === "outside_root") throw e;
        return false;
      }
    },

    /** Modification time in ms, or 0 when unreadable. Recall uses it to break scoring ties. */
    mtimeMs(rel) {
      try {
        return statSync(abs(rel)).mtimeMs;
      } catch {
        return 0;
      }
    },

    /**
     * One level only: `{ name, rel, isFile, isDirectory }` for each child of `scope`.
     *
     * Separate from `list` because shallow and recursive are genuinely different questions, and
     * deriving one from the other changes meaning. `listProjects` wants the children of `projects/`
     * — a folder-form project is one entry, not the notes inside it — so a recursive walk would
     * make an empty project disappear and a project whose notes are all ignored disappear with it.
     */
    entries(scope = "", { ignore = true } = {}) {
      const raw = String(scope).replace(/[\\/]+$/, "");
      const rel = raw === "" || raw === "." ? "" : raw;
      let found;
      try {
        found = readdirSync(abs(rel || "."), { withFileTypes: true });
      } catch {
        return [];
      }
      const { skipDir, skipFile } = ignore ? getFilter() : { skipDir: () => false, skipFile: () => false };
      const out = [];
      for (const e of found) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (skipDir(childRel)) continue;
        } else if (skipFile(childRel)) continue;
        out.push({ name: e.name, rel: childRel, isFile: e.isFile(), isDirectory: e.isDirectory() });
      }
      return out;
    },

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
