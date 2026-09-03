import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveInRepo } from './paths.mjs';

/**
 * Provenance for the vendored copies in `.cortex/lib/`.
 *
 * The copies are byte-for-byte clones of `src/`, which is what makes
 * `diff src/guard.mjs .cortex/lib/guard.mjs` a real audit — and which leaves the files
 * themselves with no room to say which version of Cortex produced them. `.manifest.json`
 * carries that alongside instead: a version stamp, so a maintainer can tell which repos
 * received a guard fix, and a hash per file, so a re-run can tell a stale copy (ours to
 * replace) from one a human edited (theirs to keep) (D5).
 */
export const MANIFEST_REL = '.cortex/lib/.manifest.json';

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** The running installer's version, read from the shipped package — never from the target repo. */
export function readPackageVersion(pkgRoot) {
  return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version;
}

/**
 * The manifest already in the target repo, or null when there is none — a first install, or
 * one that predates the manifest. A manifest we cannot parse reads as absent: treating
 * provenance as unknown is safe, trusting a file we failed to read is not.
 */
export function readManifest(repoRoot) {
  const abs = resolveInRepo(repoRoot, MANIFEST_REL);
  if (!existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const files = parsed.files;
    return {
      cortexVersion: typeof parsed.cortexVersion === 'string' ? parsed.cortexVersion : null,
      files: files && typeof files === 'object' && !Array.isArray(files) ? files : {},
    };
  } catch {
    return null;
  }
}

/**
 * Stable key order and a trailing LF. This file is committed into other people's repos,
 * so a re-run that changes nothing must produce no diff at all.
 */
export function serializeManifest({ cortexVersion, files }) {
  const sorted = {};
  for (const name of Object.keys(files).sort()) sorted[name] = files[name];
  return JSON.stringify({ cortexVersion, files: sorted }, null, 2) + '\n';
}
