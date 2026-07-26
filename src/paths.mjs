import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export class OutsideRepoError extends Error {
  constructor(relPath) {
    super(`refusing to write outside the repo: ${relPath}`);
    this.name = 'OutsideRepoError';
    this.code = 'outside_repo';
  }
}

/**
 * Realpath the nearest existing ancestor, so we can validate a target that
 * does not exist yet without losing symlink resolution.
 */
function realpathOfNearestExisting(absPath) {
  let cur = absPath;
  for (;;) {
    try {
      return realpathSync(cur);
    } catch {
      const parent = resolve(cur, '..');
      if (parent === cur) return cur;
      cur = parent;
    }
  }
}

/**
 * Resolve `relPath` inside `repoRoot`, or throw. This is the only way the
 * installer is allowed to turn a path into something it writes to (R2).
 */
export function resolveInRepo(repoRoot, relPath) {
  const realRoot = realpathSync(repoRoot);
  const candidate = resolve(realRoot, relPath);
  const guard = realpathOfNearestExisting(candidate);
  const withSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (guard !== realRoot && !guard.startsWith(withSep)) {
    throw new OutsideRepoError(relPath);
  }
  return candidate;
}
