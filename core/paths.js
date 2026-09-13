import { resolve, sep } from "node:path";
import { realpathSync } from "node:fs";

export class OutsideRootError extends Error {
  constructor(relPath) {
    super(`path escapes AI_OS_ROOT: ${relPath}`);
    this.name = "OutsideRootError";
    this.code = "outside_root";
  }
}

// Longest-existing-ancestor realpath so we can validate paths that don't exist yet.
function realpathOfNearestExisting(absPath) {
  let cur = absPath;
  // Walk up until realpathSync succeeds (a create target may not exist yet).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return realpathSync(cur);
    } catch (e) {
      // Only "it isn't there" earns a walk up. ENOENT is the create target that does not
      // exist yet; ENOTDIR is a file used as a directory (root/afile.txt/child) and says
      // the same thing about the child. Every other error — EACCES, ELOOP, EPERM,
      // ENAMETOOLONG, a poisoned argument — means we could not answer the question, and a
      // bare catch answered it anyway: it walked up to an ancestor that *does* resolve
      // inside the root, so resolveInRoot returned success and the guard passed. A guard
      // that fails open on a path it cannot read is worse than no guard. Rethrow instead,
      // so the caller sees the real error rather than a false pass.
      if (e?.code !== "ENOENT" && e?.code !== "ENOTDIR") throw e;
      const parent = resolve(cur, "..");
      if (parent === cur) return cur; // filesystem root
      cur = parent;
    }
  }
}

export function resolveInRoot(root, relPath) {
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, relPath);
  const guard = realpathOfNearestExisting(candidate);
  const withSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (guard !== realRoot && !guard.startsWith(withSep)) {
    throw new OutsideRootError(relPath);
  }
  return candidate;
}
