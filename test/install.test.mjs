import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { install } from '../src/install.mjs';
import { detect } from '../src/detect.mjs';
import { isStale } from '../src/map.mjs';

/** Every temp dir this file creates, removed at exit — the suite used to leave hundreds behind. */
const TEMP_DIRS = [];

process.on('exit', () => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a leftover temp dir is not worth failing a run over
    }
  }
});

function fixture({ pkg, files = {}, dirs = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cortex-install-'));
  TEMP_DIRS.push(root);
  if (pkg) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const readJson = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const NEXT_PKG = {
  name: 'acme-storefront',
  description: 'Customer-facing storefront',
  scripts: { dev: 'next dev', build: 'next build', test: 'vitest', lint: 'eslint .' },
  dependencies: { next: '14.1.4', react: '18.2.0' },
  devDependencies: { vitest: '1.4.0', eslint: '8.57.0' },
};

test('detects the stack from real files rather than guessing', () => {
  const root = fixture({
    pkg: NEXT_PKG,
    files: { 'tsconfig.json': '{"compilerOptions":{"strict":true}}', 'pnpm-lock.yaml': '' },
    dirs: ['src', 'app', '.github/workflows'],
  });
  const f = detect(root);
  assert.equal(f.framework, 'Next.js');
  assert.equal(f.packageManager, 'pnpm');
  assert.equal(f.testRunner, 'Vitest');
  assert.equal(f.tsStrict, true);
  assert.equal(f.ci, 'GitHub Actions');
  assert.deepEqual(f.languages, ['TypeScript']);
  assert.deepEqual(f.directories, ['src', 'app']);
});

test('leaves fields null rather than inventing them', () => {
  const root = fixture();
  const f = detect(root);
  assert.equal(f.framework, null);
  assert.equal(f.testRunner, null);
  assert.equal(f.packageManager, null);
});

test('a fresh install writes the brain, the shims, memory and the vendored guard', () => {
  const root = fixture({ pkg: NEXT_PKG, dirs: ['src'] });
  install(root);

  for (const rel of [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
    '.cursor/rules/project.mdc',
    '.cortex/config.json',
    '.cortex/memory/gotchas.md',
    '.cortex/lib/guard.mjs',
    '.cortex/lib/memory.mjs',
    '.cortex/lib/paths.mjs',
    '.claude/hooks/cortex-reflect.mjs',
    '.claude/settings.json',
  ]) {
    assert.ok(existsSync(join(root, rel)), `expected ${rel} to exist`);
  }
});

test('shims point at AGENTS.md and never carry their own copy of the content', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);
  const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  assert.equal(claude.trim(), '@AGENTS.md');
  for (const rel of ['GEMINI.md', '.github/copilot-instructions.md']) {
    const body = readFileSync(join(root, rel), 'utf8');
    assert.match(body, /AGENTS\.md/);
    assert.ok(body.length < 200, `${rel} should be a pointer, not a copy`);
  }
});

test('dry run writes nothing at all', () => {
  const root = fixture({ pkg: NEXT_PKG });
  const { plan } = install(root, { dryRun: true });
  assert.ok(plan.length > 0);
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);
  assert.equal(existsSync(join(root, '.cortex')), false);
  // .gitattributes lives at the repo root, outside .cortex/, so it needs asserting by name —
  // a dry run that stamps a merge rule into someone's repo is still a write.
  assert.equal(existsSync(join(root, '.gitattributes')), false);
});

test('refresh updates stack facts but preserves every human word', () => {
  const root = fixture({ pkg: NEXT_PKG, files: { 'pnpm-lock.yaml': '' } });
  install(root);

  const p = join(root, 'AGENTS.md');
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replace(
      '- _Naming, file layout, import rules, component patterns._',
      '- HAND-WRITTEN: never call the payments API from a client component.',
    ),
  );

  // the project migrates pnpm -> yarn and vitest -> jest
  writeFileSync(join(root, 'yarn.lock'), '');
  writeFileSync(join(root, 'pnpm-lock.yaml'), '');
  const pkg = { ...NEXT_PKG, devDependencies: { jest: '29.7.0', eslint: '8.57.0' } };
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  writeFileSync(join(root, 'pnpm-lock.yaml'), '');

  install(root, { refresh: true });
  const after = readFileSync(p, 'utf8');

  assert.match(after, /HAND-WRITTEN: never call the payments API/);
  assert.match(after, /\*\*Tests:\*\* Jest/);
});

test('refuses to overwrite an AGENTS.md that has no cortex markers', () => {
  const root = fixture({ pkg: NEXT_PKG });
  const mine = '# My own brain\n\nHand-maintained, no markers.\n';
  writeFileSync(join(root, 'AGENTS.md'), mine);

  const { plan } = install(root);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), mine);
  assert.ok(plan.find((s) => s.rel === 'AGENTS.md' && s.skipped));
});

test('merges into an existing settings.json without clobbering other hooks', () => {
  const root = fixture({ pkg: NEXT_PKG });
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(
    join(root, '.claude/settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'mine.sh' }] }] } }),
  );

  install(root);
  const s = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.ok(s.hooks.PreToolUse, 'existing hook survived');
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'mine.sh');
  assert.ok(s.hooks.SessionEnd, 'cortex hook added');
});

test('is idempotent — a second run does not duplicate the hook registration', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);
  install(root);
  const s = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(s.hooks.SessionEnd.length, 1);
});

test('is idempotent — a second run creates no file at all, .bak included', () => {
  const root = fixture({ pkg: NEXT_PKG, files: { 'src/a.ts': 'export const x = 1;' } });

  const walk = (rel) =>
    readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(rel, e.name)) : [join(rel, e.name)],
    );

  install(root);
  const before = walk('.').sort();
  install(root);

  // The hook-count assertion above is the narrow reading of "idempotent". This is the
  // one SPEC states: a second run is a no-op. It was not true — every re-run dropped
  // AGENTS.md.bak and .cortex/map.md.bak into the consumer's repo because write() copied
  // to .bak whenever the target existed, identical bytes or not.
  assert.deepEqual(
    walk('.').sort().filter((f) => !before.includes(f)),
    [],
    'a second run must write nothing; .bak churn in a committed repo is a defect, not a safety net',
  );
});

// ── the skip must never be wrong in the dangerous direction ────────────────
// Skipping a write is only safe when the file really is the one we shipped. Every skip
// below is content-derived, so these pin the smallest difference each guard must still
// see — a guard that decides "unchanged" on a file it did not really compare leaves a
// corrupted copy in place forever while the plan reports everything is fine.

test('a single differing byte is enough to stop the installer reporting unchanged', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);

  for (const rel of ['.claude/hooks/cortex-reflect.mjs', '.cortex/lib/guard.mjs']) {
    const abs = join(root, rel);
    const original = readFileSync(abs);
    // Same length, same prefix, one byte apart: what a length or prefix check waves through.
    const corrupted = Buffer.from(original);
    corrupted[corrupted.length - 1] ^= 0x01;
    writeFileSync(abs, corrupted);

    const { plan } = install(root);
    const row = plan.find((s) => s.rel === rel);
    assert.ok(row, `${rel} must appear in the plan`);
    assert.notEqual(row.note, 'unchanged', `${rel} differs on disk but was reported unchanged`);
    assert.ok(existsSync(`${abs}.bak`), `${rel} was overwritten without a backup`);
    assert.deepEqual(readFileSync(`${abs}.bak`), corrupted, 'the backup must hold what was there before');
  }
});

test('the vendored guard is repaired back to the shipped source after corruption', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);

  const abs = join(root, '.cortex/lib/guard.mjs');
  writeFileSync(abs, Buffer.concat([readFileSync(abs), Buffer.from('\n// drifted\n')]));
  install(root);

  assert.deepEqual(
    readFileSync(abs),
    readFileSync(new URL('../src/guard.mjs', import.meta.url)),
    'a drifted guard must be restored; the guard is the one thing between memory and git',
  );
});

test('a SessionEnd entry that merely mentions the hook does not count as registering it', () => {
  const root = fixture({ pkg: NEXT_PKG });
  mkdirSync(join(root, '.claude'), { recursive: true });

  // The skip is a substring match over the serialised SessionEnd array, so any entry that
  // names the path suppresses registration — including one that deliberately does not run
  // it. The installer then reports "hook already registered" and the harvester never runs,
  // which silently costs the repo the only thing that makes the brain accumulate.
  writeFileSync(
    join(root, '.claude/settings.json'),
    JSON.stringify(
      {
        hooks: {
          SessionEnd: [
            { hooks: [{ type: 'command', command: "echo 'we turned off .claude/hooks/cortex-reflect.mjs for now'" }] },
          ],
        },
      },
      null,
      2,
    ),
  );

  install(root);

  const s = readJson(root, '.claude/settings.json');
  const commands = s.hooks.SessionEnd.flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? ''));
  assert.ok(
    commands.some((c) => c.startsWith('node ') && c.includes('.claude/hooks/cortex-reflect.mjs')),
    `no SessionEnd entry actually runs the hook; commands were ${JSON.stringify(commands)}`,
  );
});

test('install stamps the capability skill so the repo can extend itself', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);
  assert.ok(
    existsSync(join(root, '.claude/skills/cortex-capability/SKILL.md')),
    'the consolidated meta-skill must be installed',
  );

  // The four separate meta-skills folded into one (SPEC R8's capability layer is unchanged;
  // only its packaging is). A stale directory left behind would give the repo two competing
  // instruction sets for the same job.
  for (const gone of ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp']) {
    assert.equal(
      existsSync(join(root, '.claude/skills', gone)),
      false,
      `${gone} was consolidated into cortex-capability and must no longer be installed`,
    );
  }
});

test('writes a structural map and vendors the generator that maintains it', () => {
  const root = fixture({
    pkg: NEXT_PKG,
    files: { 'src/index.ts': "export function boot() {}\nimport './db';", 'src/db.ts': 'export const c = 1;' },
    dirs: ['src'],
  });
  install(root);
  assert.ok(existsSync(join(root, '.cortex/map.md')));
  assert.ok(existsSync(join(root, '.cortex/lib/map.mjs')), 'hook needs the generator after npx is gone');
  const map = readFileSync(join(root, '.cortex/map.md'), 'utf8');
  assert.match(map, /cortex:map hash=/);
  assert.match(map, /boot/);
});

// ── the map opt-out lives in config, not in a flag ──────────────────────────
// A flag governs one run on one machine. The next teammate to run the installer brought
// the map straight back, so `--no-map` was never an opt-out — it was a pause. The whole
// point of moving it into committed config is that the decision survives a re-run.

test('--no-map opts out, and records the decision in .cortex/config.json', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root, { noMap: true });

  assert.equal(existsSync(join(root, '.cortex/map.md')), false);
  assert.equal(readJson(root, '.cortex/config.json').map, false, 'config must record the opt-out');
});

test('the opt-out survives a plain re-run — the failure the flag had', () => {
  const root = fixture({ pkg: NEXT_PKG, files: { 'src/a.ts': 'export const x = 1;' } });
  install(root, { noMap: true });

  // A teammate clones and runs `npx cortex-init` with no flags at all.
  install(root);

  assert.equal(
    existsSync(join(root, '.cortex/map.md')),
    false,
    'a re-run without --no-map must respect "map": false in the committed config',
  );
  assert.equal(readJson(root, '.cortex/config.json').map, false, 'the setting must not be flipped back');
});

test('config.json governs the map, so editing it by hand turns the map back on', () => {
  const root = fixture({ pkg: NEXT_PKG, files: { 'src/a.ts': 'export const x = 1;' } });
  install(root, { noMap: true });

  // The config is committed and human-editable; that is what makes it the control surface.
  const configAbs = join(root, '.cortex/config.json');
  writeFileSync(configAbs, JSON.stringify({ ...readJson(root, '.cortex/config.json'), map: true }, null, 2) + '\n');
  install(root);

  assert.ok(existsSync(join(root, '.cortex/map.md')), 'flipping the config back on must regenerate the map');
});

test('a config written before the map key existed is backfilled rather than ignored', () => {
  const root = fixture({ pkg: NEXT_PKG, files: { 'src/a.ts': 'export const x = 1;' } });
  install(root);

  // Exactly the state of a repo installed before the flag folded into config.
  const configAbs = join(root, '.cortex/config.json');
  const { map, ...withoutMap } = readJson(root, '.cortex/config.json');
  assert.equal(map, true, 'precondition: a fresh install records map: true');
  writeFileSync(configAbs, JSON.stringify(withoutMap, null, 2) + '\n');

  install(root);
  assert.equal(readJson(root, '.cortex/config.json').map, true, 'the missing key must be backfilled');
});

test('the plan says why the map was skipped instead of silently omitting it', () => {
  const root = fixture({ pkg: NEXT_PKG });
  const { plan } = install(root, { noMap: true });
  const row = plan.find((s) => s.rel === '.cortex/map.md');
  assert.ok(row, 'a skipped map must still appear in the plan; a missing row reads as a bug');
  assert.equal(row.skipped, true);
  assert.match(row.note, /config\.json/, `the note must point at the control surface, got: ${row.note}`);
});

// ── the plugins layer is gone ───────────────────────────────────────────────
// It was declared-not-installed, which meant its only artefact was a manifest nobody
// consumed and a flag that provisioned third-party code into someone else's environment.

test('a default install writes no plugin manifest', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);
  assert.equal(existsSync(join(root, '.cortex/plugins.json')), false, '.cortex/plugins.json is gone');
});

test('a default install never provisions a developer environment', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);

  // The old plugins suite asserted this inside an `if (existsSync(settings))` that never
  // fired, so the SPEC row was green while checking nothing. Read unconditionally: the
  // installer always writes settings.json to register the hook, so there is no branch here.
  const settings = readJson(root, '.claude/settings.json');
  assert.equal(settings.enabledPlugins, undefined, 'must not enable plugins on a developer’s behalf');
});

test('withPlugins is inert — the opt-in it belonged to no longer exists', () => {
  const root = fixture({ pkg: NEXT_PKG });
  // A stale caller (or a stale script) passing the old option must not resurrect the layer.
  install(root, { withPlugins: true });

  assert.equal(existsSync(join(root, '.cortex/plugins.json')), false);
  assert.equal(readJson(root, '.claude/settings.json').enabledPlugins, undefined);
});

test('the CLI no longer advertises --with-plugins', () => {
  const bin = fileURLToPath(new URL('../bin/cortex-init.mjs', import.meta.url));
  const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });

  assert.doesNotMatch(help, /--with-plugins/, 'the removed flag must be gone from the help text');
  assert.doesNotMatch(help, /plugin/i, 'no plugin vocabulary survives in the CLI surface');
  assert.match(help, /--no-map/, 'the flags that remain must still be documented');
});

test('a broken repo does not fail the install; the map degrades and says so', () => {
  const root = fixture({ pkg: NEXT_PKG });
  writeFileSync(join(root, 'package.json'), '{ this is not valid json');
  assert.doesNotThrow(() => install(root));
  assert.ok(existsSync(join(root, 'AGENTS.md')), 'install must still complete');
});

test('the map it writes is not already stale', () => {
  const root = fixture({ pkg: NEXT_PKG, files: { 'src/a.ts': 'export const x = 1;' }, dirs: ['src'] });
  install(root);
  assert.equal(isStale(root), false, 'a fresh install must not ship a map that needs regenerating');
});
