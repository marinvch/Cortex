import { resolve, sep } from "node:path";
import { realpathSync } from "node:fs";

// The root has two names. `CORTEX_ROOT` is the one to set; `AI_OS_ROOT` is what every install made
// before #552 carries in its MCP registration, and it is read for as long as those exist — no
// warning and no removal date, because a registration is a line in a user's config that nothing in
// this repo can rewrite.
export const ROOT_VAR = "CORTEX_ROOT";
export const LEGACY_ROOT_VAR = "AI_OS_ROOT";

const named = (v) => String(v ?? "").trim();

/**
 * Which root the environment names, and by which variable. The ONE place the two names are put in
 * order; `tools/_cortex-lib.sh` holds the shell counterpart, `cortex_root`. A second reader that
 * ordered them for itself would open a different brain from the same environment.
 *
 * - `CORTEX_ROOT` wins when both are set.
 * - An empty or blank value is an unset one, so an empty `CORTEX_ROOT` does not shadow a set
 *   `AI_OS_ROOT`.
 * - `ignored` is the `AI_OS_ROOT` that lost, and only when it names a different path. The caller
 *   says so once; this function prints nothing.
 * - Neither set returns `root: null`. Nothing is guessed here or by any caller (docs/adr/0008).
 *
 * It answers from the strings alone and never touches the disk: whether the root exists is the
 * caller's question (`mcp/lib/brain.js`), and a set root that is wrong is reported, never replaced
 * by the other name's.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{ root: string|null, variable: "CORTEX_ROOT"|"AI_OS_ROOT"|null, ignored: string|null }}
 */
export function rootFromEnv(env) {
  const root = named(env?.[ROOT_VAR]);
  const legacy = named(env?.[LEGACY_ROOT_VAR]);
  if (root) return { root, variable: ROOT_VAR, ignored: legacy && legacy !== root ? legacy : null };
  if (legacy) return { root: legacy, variable: LEGACY_ROOT_VAR, ignored: null };
  return { root: null, variable: null, ignored: null };
}

export class OutsideRootError extends Error {
  constructor(relPath) {
    super(`path escapes the Cortex root: ${relPath}`);
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
