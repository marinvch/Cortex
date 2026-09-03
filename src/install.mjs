import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveInRepo } from './paths.mjs';
import { detect } from './detect.mjs';
import { renderAgentsMd, refreshAgentsMd, SHIMS } from './render.mjs';
import { initMemory } from './memory.mjs';
import { installMetaSkills } from './skills.mjs';
import { buildMap, MAP_REL } from './map.mjs';
import { MANIFEST_REL, readManifest, readPackageVersion, serializeManifest, sha256 } from './manifest.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_REL = '.claude/hooks/cortex-reflect.mjs';

const serializeConfig = (value) => JSON.stringify(value, null, 2) + '\n';

/**
 * True only when `abs` already holds exactly `content`.
 *
 * Bytes, never a decoded string: reading as utf8 maps invalid sequences to U+FFFD, so two
 * files that differ on disk can decode to the same string and compare equal. A target we
 * cannot read — missing, a directory in the way, no permission — returns false and the
 * caller writes. Skipping happens only on proven equality; anything else is a real write.
 */
function holds(abs, content) {
  try {
    return readFileSync(abs).equals(Buffer.from(content));
  } catch {
    return false;
  }
}

/**
 * sha256 of a file, or null when it cannot be read as one. Null never equals a recorded
 * hash, so a file we could not read is never treated as vouched for and never deleted.
 */
function hashOnDisk(abs) {
  try {
    return sha256(readFileSync(abs));
  } catch {
    return null;
  }
}

/**
 * Orchestrate the install. Every path goes through resolveInRepo, so the installer
 * physically cannot write outside the repo it was invoked in (R2).
 */
export function install(repoRoot, { refresh = false, dryRun = false, noMap = false } = {}) {
  const facts = detect(repoRoot);
  const plan = [];

  // A write that would change nothing is skipped outright. Without that, a second run
  // backs every file up to `.bak` before rewriting it byte-identically, littering someone
  // else's repo and making the idempotency the README promises false (R7).
  const write = (rel, content, note) => {
    const abs = resolveInRepo(repoRoot, rel);
    if (holds(abs, content)) {
      plan.push({ rel, note: 'unchanged', skipped: true });
      return;
    }
    plan.push({ rel, note });
    if (dryRun) return;
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
    plan.push({ rel: '.cortex/memory/', note: 'would seed gotchas.md and stamp merge=union' });
  } else {
    for (const step of initMemory(repoRoot)) plan.push(step);
  }

  // ── config ───────────────────────────────────────────────────────────────
  // Whether to build the map lives here, not in a flag. A flag governs one run on one
  // machine; the next teammate's run brings the map back, so it was never an opt-out.
  // config.json is committed, so the decision travels with the repo. `--no-map` sets it.
  const configRel = '.cortex/config.json';
  const configAbs = resolveInRepo(repoRoot, configRel);
  let config = null;
  let configUsable = true;
  if (existsSync(configAbs)) {
    try {
      config = JSON.parse(readFileSync(configAbs, 'utf8'));
    } catch {
      configUsable = false;
      plan.push({ rel: configRel, note: 'SKIPPED — existing config.json is not valid JSON', skipped: true });
    }
  }

  const mapEnabled = noMap ? false : config?.map !== false;

  if (configUsable && config === null) {
    write(
      configRel,
      serializeConfig({ version: 1, name: facts.name, guard: { enabled: true }, map: mapEnabled }),
      'created',
    );
  } else if (configUsable && config.map !== mapEnabled) {
    // Either --no-map just flipped it, or this config predates the key and gets it backfilled.
    write(
      configRel,
      serializeConfig({ ...config, map: mapEnabled }),
      noMap ? 'map disabled — recorded so it survives the next run' : 'recorded "map": true',
    );
  }

  // ── meta-skills ──────────────────────────────────────────────────────────
  installMetaSkills(repoRoot, plan, dryRun);

  // ── structural map ───────────────────────────────────────────────────────
  // Never fail the install over the map. A repo with an unreadable file still deserves a brain.
  if (mapEnabled) {
    try {
      const { markdown, stats } = buildMap(repoRoot);
      write(MAP_REL, markdown, `mapped ${stats.scanned} files${stats.capped ? ' (capped)' : ''}`);
    } catch (err) {
      plan.push({ rel: MAP_REL, note: `SKIPPED — map generation failed: ${err.message}`, skipped: true });
    }
  } else {
    plan.push({ rel: MAP_REL, note: 'SKIPPED — "map": false in .cortex/config.json', skipped: true });
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
 *
 * `.manifest.json` beside them records the version and a hash per file, which is what lets a
 * re-run report an upgrade, skip a copy that would change nothing, and back up a file the
 * team edited rather than silently overwriting it (D5).
 */
const LIB_REL = '.cortex/lib';
const VENDORED = ['guard.mjs', 'paths.mjs', 'memory.mjs', 'map.mjs'];

/**
 * The only names the sweep will act on: a plain `.mjs` filename, no separators.
 *
 * Shape does this guarding, not provenance. `.manifest.json` is committed, so it arrives
 * through merges and human edits — its keys are input, not a trusted delete list. Without
 * this, a key of `../../src/index.ts` names a path that is still inside the repo and so
 * still passes `resolveInRepo`, and a hand-edited manifest could delete anything in the
 * project. It also keeps `.manifest.json` and the `.bak` files holding preserved user edits
 * out of the sweep by construction rather than by a special case.
 */
const SWEEPABLE = /^[^/\\]+\.mjs$/;

function vendorLib(repoRoot, plan, dryRun) {
  const version = readPackageVersion(PKG_ROOT);
  const previousManifest = readManifest(repoRoot);
  const files = {};
  let anyExisting = false;

  for (const name of VENDORED) {
    const rel = `${LIB_REL}/${name}`;
    const src = join(PKG_ROOT, 'src', name);
    const sourceHash = sha256(readFileSync(src));
    files[name] = sourceHash;

    const abs = resolveInRepo(repoRoot, rel);
    const currentHash = hashOnDisk(abs);
    if (currentHash) anyExisting = true;

    if (currentHash === sourceHash) {
      plan.push({ rel, note: 'unchanged', skipped: true });
      continue;
    }

    // A copy whose hash still matches the manifest is an older Cortex and ours to replace.
    // Anything else is either a local edit or a pre-manifest install we cannot vouch for,
    // so it gets a .bak first — the same bargain write() makes for the files we own.
    const vouched =
      currentHash !== null && previousManifest !== null && previousManifest.files[name] === currentHash;
    plan.push({
      rel,
      note: currentHash === null ? 'vendored' : vouched ? 'vendored — replaced older copy' : 'vendored — local copy differs, old → .bak',
    });
    if (dryRun) continue;
    mkdirSync(dirname(abs), { recursive: true });
    if (currentHash !== null && !vouched) copyFileSync(abs, `${abs}.bak`);
    copyFileSync(src, abs);
  }

  sweepLib(repoRoot, plan, dryRun, previousManifest);

  // The version change is the whole point: it is how a maintainer tells which repos
  // received a guard fix. A pre-manifest install cannot report one, and says so.
  const previous = previousManifest ? previousManifest.cortexVersion : null;
  const note =
    previous === version
      ? `cortex ${version}`
      : previous
        ? `updated ${previous} → ${version}`
        : anyExisting
          ? `cortex ${version} — previous version unknown`
          : `cortex ${version}`;

  // Staleness is the serialised bytes differing, not a flag tracked across the branches
  // above. That covers every case with no bookkeeping: a version bump, a changed copy, a
  // key pruned because the sweep removed the file it named, or a manifest someone edited.
  // A hand-maintained flag is exactly how a removed orphan stays listed in the manifest
  // that vouches for it, which then re-deletes it if the file is ever restored from git.
  const abs = resolveInRepo(repoRoot, MANIFEST_REL);
  const body = serializeManifest({ cortexVersion: version, files });
  if (holds(abs, body)) {
    plan.push({ rel: MANIFEST_REL, note, skipped: true });
    return;
  }
  // Explicitly false, not absent: this row is the record of whether the manifest was
  // actually rewritten, so it answers that in both directions rather than by omission.
  plan.push({ rel: MANIFEST_REL, note, skipped: false });
  if (dryRun) return;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/**
 * Deal with copies in `.cortex/lib/` that the current Cortex no longer ships.
 *
 * Only the manifest written by the version BEFORE a file was dropped still lists it, so this
 * has to exist before the first drop rather than after it (D10). Candidates therefore come
 * from `previousManifest.files` minus the current `VENDORED` — never from a directory listing
 * filtered against the manifest this run is about to write, which by construction lists only
 * `VENDORED` and would make the sweep a silent no-op that still looked like it worked.
 *
 * The second pass reads the directory and cannot delete. Keeping the two apart by source,
 * rather than by a flag, means the code path able to remove a file never sees one we did not
 * write — so "never delete what we cannot vouch for" is not a rule anyone has to remember.
 */
function sweepLib(repoRoot, plan, dryRun, previousManifest) {
  const recorded = previousManifest ? previousManifest.files : {};

  for (const name of Object.keys(recorded).sort()) {
    if (!SWEEPABLE.test(name) || VENDORED.includes(name)) continue;
    const rel = `${LIB_REL}/${name}`;
    const abs = resolveInRepo(repoRoot, rel);
    if (!existsSync(abs)) continue;

    if (hashOnDisk(abs) !== recorded[name]) {
      plan.push({ rel, note: 'kept — no longer vendored, but it differs from the copy we recorded', skipped: true });
      continue;
    }

    // Reached only on an exact hash match, which is what makes an unbacked delete safe: the
    // bytes are identical to a file we published to npm, so the content is recoverable from
    // any prior package version. That holds whether or not the team committed `.cortex/lib/`
    // — we instruct that but cannot enforce it, so the safety must not rest on it.
    //
    // The match proves the bytes are ours. It does NOT prove nothing imports them — a
    // hand-written hook or project skill still can, and will break. Accepted: the same run
    // rewrites our own hook, and the alternative is orphans outliving the only manifest that
    // could ever vouch for them.
    plan.push({ rel, note: 'removed — no longer vendored, matched the recorded copy' });
    if (!dryRun) unlinkSync(abs);
  }

  let entries;
  try {
    entries = readdirSync(resolveInRepo(repoRoot, LIB_REL), { withFileTypes: true });
  } catch {
    return;
  }
  const present = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  for (const name of present) {
    if (!SWEEPABLE.test(name) || VENDORED.includes(name)) continue;
    if (Object.prototype.hasOwnProperty.call(recorded, name)) continue;
    plan.push({
      rel: `${LIB_REL}/${name}`,
      note: 'kept — cortex never wrote this file, so it is not ours to remove',
      skipped: true,
    });
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
