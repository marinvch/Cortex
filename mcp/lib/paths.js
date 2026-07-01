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
    } catch {
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
