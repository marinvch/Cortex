import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveInRepo } from './paths.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Meta-skills: the repo's ability to extend itself.
 *
 * Plain markdown, because that is all a capability needs to be — a skill that creates
 * skills is itself just a skill. No generator code, no dependencies, and it works the
 * moment it is written.
 *
 * One skill, not four. The skill namespace belongs to the team whose repo this is, and
 * four permanent slots to branch on a question we can just ask is a poor rent to charge
 * them. All four capabilities — skill, subagent, hook, MCP server — live inside it.
 */
const CAPABILITY = 'cortex-capability';

export const META_SKILLS = [CAPABILITY];

/**
 * The meta-skills Cortex used to install, before all four collapsed into `cortex-capability`.
 *
 * A repo that installed before that change still carries them, and they describe a shape
 * Cortex no longer ships. Left in place they compete with the new skill in the same
 * namespace and an agent reads whichever it matches first, so a re-run retires them.
 */
export const SUPERSEDED_SKILLS = ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp'];

export function installMetaSkills(repoRoot, plan, dryRun) {
  for (const name of META_SKILLS) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    plan.push({ rel, note: 'meta-skill' });
    if (dryRun) continue;
    const abs = resolveInRepo(repoRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    copyFileSync(join(PKG_ROOT, 'templates', 'skills', name, 'SKILL.md'), abs);
  }
  retireSupersededSkills(repoRoot, plan, dryRun);
}

/**
 * Retire a superseded meta-skill by moving its SKILL.md aside.
 *
 * Only the SKILL.md goes. The directory stays: `.claude/skills/` is the team's namespace
 * in a way `.cortex/lib/` is not, and a team may have put something of their own beside
 * ours. Removing the SKILL.md is enough to stop it competing.
 *
 * The `.bak` is unconditional. We never recorded hashes for these files — the gap that
 * `.cortex/lib/.manifest.json` closes for the vendored modules — so we cannot tell an
 * edited SKILL.md from a pristine one, and R7 says we do not destroy human edits.
 *
 * A file already moved aside leaves no SKILL.md behind, so a second run reports nothing.
 */
function retireSupersededSkills(repoRoot, plan, dryRun) {
  for (const name of SUPERSEDED_SKILLS) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    const abs = resolveInRepo(repoRoot, rel);
    if (!existsSync(abs)) continue;

    plan.push({ rel, note: `superseded by ${CAPABILITY} — SKILL.md moved to .bak` });
    if (dryRun) continue;
    copyFileSync(abs, `${abs}.bak`);
    unlinkSync(abs);
  }
}
