import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveInRepo } from './paths.mjs';
import { detect } from './detect.mjs';
import { renderAgentsMd, refreshAgentsMd, SHIMS } from './render.mjs';
import { initMemory } from './memory.mjs';
import { installMetaSkills } from './skills.mjs';
import { writePluginManifest } from './plugins.mjs';
import { buildMap, MAP_REL } from './map.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_REL = '.claude/hooks/cortex-reflect.mjs';

/**
 * Orchestrate the install. Every path goes through resolveInRepo, so the installer
 * physically cannot write outside the repo it was invoked in (R2).
 */
export function install(repoRoot, { refresh = false, dryRun = false, withPlugins = false, noMap = false } = {}) {
  const facts = detect(repoRoot);
  const plan = [];

  const write = (rel, content, note) => {
    plan.push({ rel, note });
    if (dryRun) return;
    const abs = resolveInRepo(repoRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (existsSync(abs)) copyFileSync(abs, `${abs}.bak`);
    writeFileSync(abs, content);
  };

  // ── AGENTS.md — canonical ────────────────────────────────────────────────
  const agentsAbs = resolveInRepo(repoRoot, 'AGENTS.md');
  if (existsSync(agentsAbs)) {
    const existing = readFileSync(agentsAbs, 'utf8');
    const { content, refreshed } = refreshAgentsMd(existing, facts);
    if (refreshed) {
      write('AGENTS.md', content, 'refreshed generated block; human prose preserved');
    } else {
      plan.push({
        rel: 'AGENTS.md',
        note: 'SKIPPED — no cortex markers found; not overwriting a file you own',
        skipped: true,
      });
    }
  } else if (refresh) {
    plan.push({ rel: 'AGENTS.md', note: 'SKIPPED — --refresh but no AGENTS.md exists', skipped: true });
  } else {
    write('AGENTS.md', renderAgentsMd(facts), 'created');
  }

  // ── shims ────────────────────────────────────────────────────────────────
  for (const [rel, content] of Object.entries(SHIMS)) {
    const abs = resolveInRepo(repoRoot, rel);
    if (existsSync(abs) && readFileSync(abs, 'utf8').trim() === content.trim()) {
      plan.push({ rel, note: 'unchanged', skipped: true });
      continue;
    }
    write(rel, content, existsSync(abs) ? 'updated (old → .bak)' : 'created');
  }

  // ── memory ───────────────────────────────────────────────────────────────
  if (dryRun) {
    plan.push({ rel: '.cortex/memory/', note: 'would seed gotchas.md + decisions.md' });
  } else {
    for (const rel of initMemory(repoRoot)) plan.push({ rel, note: 'created' });
  }

  // ── config ───────────────────────────────────────────────────────────────
  const configRel = '.cortex/config.json';
  if (!existsSync(resolveInRepo(repoRoot, configRel))) {
    write(
      configRel,
      JSON.stringify({ version: 1, name: facts.name, guard: { enabled: true } }, null, 2) + '\n',
      'created',
    );
  }

  // ── meta-skills ──────────────────────────────────────────────────────────
  installMetaSkills(repoRoot, plan, dryRun);

  // ── plugin recommendations ───────────────────────────────────────────────
  writePluginManifest(repoRoot, plan, { dryRun, withPlugins });

  // ── structural map ───────────────────────────────────────────────────────
  // Never fail the install over the map. A repo with an unreadable file still deserves a brain.
  if (!noMap) {
    try {
      const { markdown, stats } = buildMap(repoRoot);
      write(MAP_REL, markdown, `mapped ${stats.scanned} files${stats.capped ? ' (capped)' : ''}`);
    } catch (err) {
      plan.push({ rel: MAP_REL, note: `SKIPPED — map generation failed: ${err.message}`, skipped: true });
    }
  }

  // ── vendored lib ─────────────────────────────────────────────────────────
  vendorLib(repoRoot, plan, dryRun);

  // ── reflect hook (Claude Code) ───────────────────────────────────────────
  installHook(repoRoot, plan, dryRun);

  return { facts, plan };
}

/**
 * Copy the guard, the map generator and their dependencies into `.cortex/lib/`.
 *
 * The hook runs inside the target repo long after `npx` has gone, and teammates who
 * pull the repo never run the installer at all. Vendoring means both travel with
 * the code and their versions are committed alongside it, instead of depending on whoever
 * last ran the installer.
 */
const VENDORED = ['guard.mjs', 'paths.mjs', 'memory.mjs', 'map.mjs'];

function vendorLib(repoRoot, plan, dryRun) {
  for (const name of VENDORED) {
    const rel = `.cortex/lib/${name}`;
    plan.push({ rel, note: 'vendored' });
    if (dryRun) continue;
    const abs = resolveInRepo(repoRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    copyFileSync(join(PKG_ROOT, 'src', name), abs);
  }
}

/**
 * Copy the SessionEnd hook in and register it, merging into any settings.json that
 * already exists. A teammate's hooks are theirs; we add one entry and touch nothing else.
 */
function installHook(repoRoot, plan, dryRun) {
  const hookAbs = resolveInRepo(repoRoot, HOOK_REL);
  if (!dryRun) {
    mkdirSync(dirname(hookAbs), { recursive: true });
    copyFileSync(join(PKG_ROOT, 'templates', 'cortex-reflect.mjs'), hookAbs);
  }
  plan.push({ rel: HOOK_REL, note: 'session reflection hook' });

  const settingsRel = '.claude/settings.json';
  const settingsAbs = resolveInRepo(repoRoot, settingsRel);
  let settings = {};
  if (existsSync(settingsAbs)) {
    try {
      settings = JSON.parse(readFileSync(settingsAbs, 'utf8'));
    } catch {
      plan.push({ rel: settingsRel, note: 'SKIPPED — existing settings.json is not valid JSON', skipped: true });
      return;
    }
  }

  const command = `node "$CLAUDE_PROJECT_DIR/${HOOK_REL}"`;
  settings.hooks ??= {};
  settings.hooks.SessionEnd ??= [];

  const already = JSON.stringify(settings.hooks.SessionEnd).includes(HOOK_REL);
  if (already) {
    plan.push({ rel: settingsRel, note: 'hook already registered', skipped: true });
    return;
  }

  settings.hooks.SessionEnd.push({ hooks: [{ type: 'command', command }] });
  plan.push({ rel: settingsRel, note: 'registered SessionEnd hook (merged)' });
  if (!dryRun) {
    if (existsSync(settingsAbs)) copyFileSync(settingsAbs, `${settingsAbs}.bak`);
    mkdirSync(dirname(settingsAbs), { recursive: true });
    writeFileSync(settingsAbs, JSON.stringify(settings, null, 2) + '\n');
  }
}
