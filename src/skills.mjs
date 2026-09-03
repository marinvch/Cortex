import { existsSync, mkdirSync, readFileSync, copyFileSync, unlinkSync } from 'node:fs';
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

/**
 * True only when both paths exist and hold exactly the same bytes.
 *
 * Bytes, not a decoded string: `readFileSync(abs, 'utf8')` maps invalid sequences to
 * U+FFFD, so two files that differ on disk can decode equal and a team's edit would be
 * missed — the one case this comparison exists to catch.
 *
 * This is `holds()` from `src/install.mjs`, adapted to compare two files rather than a
 * file against a string already in memory. It is not imported: `install.mjs` imports this
 * module, so the dependency would be circular, and `holds` is private there besides.
 */
function sameBytes(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

export function installMetaSkills(repoRoot, plan, dryRun) {
  for (const name of META_SKILLS) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    const src = join(PKG_ROOT, 'templates', 'skills', name, 'SKILL.md');
    const abs = resolveInRepo(repoRoot, rel);

    // A team may have edited the meta-skill to fit their conventions. We cannot prove they
    // did not, so an overwrite always leaves a `.bak` — the same bargain the migration above
    // makes, and the one R7 requires of every file we did not write on this run.
    if (sameBytes(src, abs)) {
      plan.push({ rel, note: 'unchanged', skipped: true });
      continue;
    }

    const existing = existsSync(abs);
    plan.push({ rel, note: existing ? 'meta-skill — local copy differs, old → .bak' : 'meta-skill' });
    if (dryRun) continue;
    mkdirSync(dirname(abs), { recursive: true });
    if (existing) copyFileSync(abs, `${abs}.bak`);
    copyFileSync(src, abs);
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
