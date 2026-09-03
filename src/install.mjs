import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveInRepo } from './paths.mjs';
import { detect } from './detect.mjs';
import { renderAgentsMd, refreshAgentsMd, factChanges, SHIMS } from './render.mjs';
import { initMemory } from './memory.mjs';
import { installMetaSkills } from './skills.mjs';
import { buildMap, MAP_REL } from './map.mjs';
import { MANIFEST_REL, readManifest, readPackageVersion, serializeManifest, sha256 } from './manifest.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_REL = '.claude/hooks/cortex-reflect.mjs';

const isArray = Array.isArray;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !isArray(v);

/**
 * Does this command actually *run* the hook?
 *
 * The old test was `JSON.stringify(SessionEnd).includes(HOOK_REL)`, so any entry naming the
 * path counted — including `echo 'we turned off .claude/hooks/cortex-reflect.mjs'`. The
 * installer then reported success, wrote nothing, and the harvester never ran, which costs
 * the repo the one thing that makes the brain accumulate (R5).
 *
 * So: `node` with nothing but quoting and a path prefix before the hook path. That still
 * matches our own `node "$CLAUDE_PROJECT_DIR/…"` and a wrapper like `bash -c "node …"`,
 * and no longer matches a mention inside a message or a pasted `.bak` path.
 *
 * The two failure directions are not symmetric, and this errs deliberately. A false
 * "already registered" means the brain silently never learns while the run reports success.
 * A false "not registered" appends another entry on every run, so the hook runs twice and
 * settings.json grows — noisy, but visible in the file and deduped by fingerprint in
 * `src/memory.mjs`. When in doubt, fail towards registering; hence flags are allowed
 * between `node` and the path, so a real invocation is not re-added on each run.
 */
const INVOKES_HOOK = new RegExp(
  `\\bnode\\b(?:\\s+-\\S+)*\\s+["']?\\S*?${HOOK_REL.replace(/[.]/g, '\\$&').replace(/\//g, '[/\\\\]')}`,
);

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
    return readFileSync(abs).equals(Buffer.isBuffer(content) ? content : Buffer.from(content));
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
 * Read `.cortex/config.json` as untrusted input, returning either a config we can act on
 * or the plan note explaining why we will not touch the file.
 *
 * It is committed, so on the next run its contents are input, not something we wrote (D11) —
 * the same rule `.claude/settings.json` follows in installHook. A shape we cannot use is
 * reported and skipped, never coerced; a shape that is merely incomplete gets sane defaults.
 *
 * Coercion here was not hypothetical. `{ ...config, map }` over an array or a string spread
 * it into `{"0": …}`, and over a number or a boolean produced a bare `{ map: true }` — every
 * key the team had written, gone, on a plan row that said "recorded". And the shape had to be
 * checked before the key rather than trusted through `?.`, because `config?.map` on an array
 * reads `Array.prototype.map`: a function, so `!== false` is true and `!== mapEnabled` is
 * also true, which is what drove the rewrite that destroyed the file.
 */
function readConfig(abs) {
  if (!existsSync(abs)) return { config: null, note: null };

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return { config: null, note: 'SKIPPED — existing config.json is not valid JSON' };
  }

  // `null`, an array, a string, a number, a boolean: all valid JSON, none of them something
  // we can merge a key into. A null document in particular used to be indistinguishable from
  // an absent file, so it was replaced wholesale by a freshly created config.
  if (!isPlainObject(parsed)) {
    return { config: null, note: 'SKIPPED — config.json has an unexpected shape at the document root' };
  }

  // Absent is incomplete and gets backfilled; present-but-not-a-boolean is unreadable. We
  // cannot tell whether `"false"` meant off or was a stray edit, and picking one silently
  // overwrites what they wrote.
  if ('map' in parsed && typeof parsed.map !== 'boolean') {
    return { config: null, note: 'SKIPPED — config.json has an unexpected shape at map' };
  }

  return { config: parsed, note: null };
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
    const moved = refreshed ? factChanges(existing, content) : [];
    if (!refreshed) {
      plan.push({
        rel: 'AGENTS.md',
        note: 'SKIPPED — no cortex markers found; not overwriting a file you own',
        skipped: true,
      });
    } else if (content === existing) {
      plan.push({ rel: 'AGENTS.md', note: 'unchanged', skipped: true });
    } else if (!refresh) {
      // The rewrite is gated behind the flag (D2). Re-detecting a repo and overwriting stack
      // facts a human has come to rely on, without being asked, is the silent rewrite this
      // tool exists to prevent — so a plain run reports the drift and changes nothing.
      plan.push({
        rel: 'AGENTS.md',
        note: `SKIPPED — ${moved.length ? `stack facts have moved (${moved.join('; ')})` : 'the generated block is out of date'}; re-run with --refresh to update`,
        skipped: true,
      });
    } else {
      // D2 chose in-place rewriting over a patch file because git is already the review
      // surface. That only holds if the run says what it did, so the facts that moved go on
      // the row rather than waiting to be discovered in a diff.
      write(
        'AGENTS.md',
        content,
        `refreshed generated block; human prose preserved${moved.length ? ` — ${moved.join('; ')}` : ''}`,
      );
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
  const { config, note: configNote } = readConfig(configAbs);

  // Safe as a `!== false` test only because readConfig has proved `map` is a boolean or
  // absent. On a raw parse it also passes for every array and every non-object document.
  // A config we skipped reads as no config at all — the installer's own default — so the
  // map still gets built; what we do not do is write to the file to say so.
  const mapEnabled = noMap ? false : config?.map !== false;

  if (configNote) {
    // The cost of not coercing, stated on the row: with the file untouched, `--no-map`
    // governs this run only, which is exactly what folding it into config was meant to fix.
    plan.push({
      rel: configRel,
      note: noMap ? `${configNote} (--no-map could not be recorded)` : configNote,
      skipped: true,
    });
  } else if (config === null) {
    write(
      configRel,
      // No `guard` key. Nothing has ever read one — `scan()` takes no such option — and a
      // boolean is the wrong shape for that decision anyway: memory is committed and
      // ungated, so a supported off switch would let one commit disable the product's
      // central safety claim for a whole team, in a file nobody reviews closely. A team with
      // genuine false positives edits the vendored `.cortex/lib/guard.mjs`, which vendoring
      // explicitly invites and which shows up in a PR diff where weakening the guard is
      // visible. Existing configs keep the key: removing it would mean rewriting a file the
      // user owns to delete something harmless.
      serializeConfig({ version: 1, name: facts.name, map: mapEnabled }),
      'created',
    );
  } else if (noMap && config.map !== false) {
    // Only a setting the user actually asked for is written back. An absent `map` already
    // means true, so backfilling it changed no behaviour while modifying a committed file in
    // every existing repo on its next upgrade — a diff to review and a `.bak` to clean up,
    // to record a default that was already in force. A config Cortex creates carries the key
    // because we are writing the file anyway; a config that already exists is read, not
    // rewritten. `--no-map` is the exception, because it is a real change the user requested.
    write(configRel, serializeConfig({ ...config, map: false }), 'map disabled — recorded so it survives the next run');
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
    // Normally the config is the reason, because --no-map records itself there. When the
    // config was skipped it cannot be, and the row has to say the flag governs this run
    // rather than claim a setting that is not in the file.
    plan.push({
      rel: MAP_REL,
      note: configNote
        ? 'SKIPPED — --no-map for this run; .cortex/config.json could not be updated'
        : 'SKIPPED — "map": false in .cortex/config.json',
      skipped: true,
    });
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
  const hookSrc = join(PKG_ROOT, 'templates', 'cortex-reflect.mjs');

  // The same bargain the vendored lib makes. This file used to be copied unconditionally,
  // which silently destroyed any edit to it — while the header of that very template tells
  // people to edit the guard it loads. Inviting edits on one side of the boundary and
  // erasing them on the other is the failure D5 exists to prevent, one directory over.
  if (holds(hookAbs, readFileSync(hookSrc))) {
    plan.push({ rel: HOOK_REL, note: 'unchanged', skipped: true });
  } else {
    const existed = existsSync(hookAbs);
    plan.push({
      rel: HOOK_REL,
      note: existed ? 'session reflection hook — local copy differs, old → .bak' : 'session reflection hook',
    });
    if (!dryRun) {
      mkdirSync(dirname(hookAbs), { recursive: true });
      if (existed) copyFileSync(hookAbs, `${hookAbs}.bak`);
      copyFileSync(hookSrc, hookAbs);
    }
  }

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

  // settings.json is committed in the target repo, so on the next run its contents are
  // input, not something we wrote (D11). Merge only into a shape we actually recognise;
  // coercing an unexpected one would destroy a teammate's file to make room for our entry.
  if (!isPlainObject(settings) || !isPlainObject(settings.hooks ?? {}) || !isArray(settings.hooks?.SessionEnd ?? [])) {
    plan.push({ rel: settingsRel, note: 'SKIPPED — settings.json has an unexpected shape at hooks.SessionEnd', skipped: true });
    return;
  }

  const command = `node "$CLAUDE_PROJECT_DIR/${HOOK_REL}"`;
  settings.hooks ??= {};
  settings.hooks.SessionEnd ??= [];

  const already = settings.hooks.SessionEnd.some(
    (entry) =>
      isArray(entry?.hooks) &&
      entry.hooks.some((h) => typeof h?.command === 'string' && INVOKES_HOOK.test(h.command)),
  );
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
