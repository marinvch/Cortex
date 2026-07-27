import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveInRepo } from './paths.mjs';

/**
 * Plugins are DECLARED, never installed.
 *
 * cortex-init runs inside other people's repositories, frequently corporate ones.
 * Silently writing `enabledPlugins` would provision third-party code into a developer's
 * environment on their behalf. So the default is a manifest plus a printed command, and
 * enabling requires an explicit --with-plugins.
 *
 * `network` is a required field: anything that leaves the machine must say so here, because
 * the whole reason Cortex is safe to run at a company is that it makes no network calls.
 */
export const MARKETPLACE = 'claude-plugins-official';

export const RECOMMENDED = [
  {
    name: 'superpowers',
    marketplace: MARKETPLACE,
    default: true,
    network: false,
    why: 'Deep generic workflow — brainstorming, planning, TDD, systematic debugging. Ships to 11 agent platforms, so a mixed-tool team is equipped evenly.',
  },
  {
    name: 'code-simplifier',
    marketplace: MARKETPLACE,
    default: true,
    network: false,
    why: 'Simplifies recently modified code without changing behaviour. Pure skills, no network.',
  },
  {
    name: 'context7',
    marketplace: MARKETPLACE,
    default: false,
    network: true,
    why: 'Up-to-date library documentation. Sends library queries to Upstash over the network — the one capability Cortex cannot own, and never enabled by default.',
  },
];

const MANIFEST_REL = '.cortex/plugins.json';
const SETTINGS_REL = '.claude/settings.json';

function writeJson(repoRoot, rel, value) {
  const abs = resolveInRepo(repoRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(value, null, 2) + '\n');
}

export function writePluginManifest(repoRoot, plan, { dryRun = false, withPlugins = false } = {}) {
  plan.push({ rel: MANIFEST_REL, note: 'recommended capabilities (declared, not installed)' });
  if (!dryRun) {
    writeJson(repoRoot, MANIFEST_REL, { version: 1, marketplace: MARKETPLACE, recommended: RECOMMENDED });
  }

  if (!withPlugins) {
    plan.push({
      rel: SETTINGS_REL,
      note: 'not enabling plugins — re-run with --with-plugins to opt in',
      skipped: true,
    });
    return;
  }

  const enable = RECOMMENDED.filter((p) => p.default && !p.network);
  plan.push({ rel: SETTINGS_REL, note: `enabled ${enable.map((p) => p.name).join(', ')}` });
  if (dryRun) return;

  const abs = resolveInRepo(repoRoot, SETTINGS_REL);
  let settings = {};
  if (existsSync(abs)) {
    try {
      settings = JSON.parse(readFileSync(abs, 'utf8'));
    } catch {
      plan.push({ rel: SETTINGS_REL, note: 'SKIPPED — existing settings.json is not valid JSON', skipped: true });
      return;
    }
  }
  settings.enabledPlugins ??= {};
  for (const p of enable) settings.enabledPlugins[`${p.name}@${p.marketplace}`] = true;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(settings, null, 2) + '\n');
}
