import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveInRepo } from './paths.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Meta-skills: the repo's ability to extend itself.
 *
 * They are plain markdown because that is all a capability needs to be — a skill that
 * creates skills is itself just a skill. No generator code, no dependencies, and they
 * work the moment they are written.
 */
export const META_SKILLS = ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp'];

export function installMetaSkills(repoRoot, plan, dryRun) {
  for (const name of META_SKILLS) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    plan.push({ rel, note: 'meta-skill' });
    if (dryRun) continue;
    const abs = resolveInRepo(repoRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    copyFileSync(join(PKG_ROOT, 'templates', 'skills', name, 'SKILL.md'), abs);
  }
}
