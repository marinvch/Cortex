import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  utimesSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { install } from '../src/install.mjs';

/**
 * SPEC D5 — `.cortex/lib/` is a raw byte copy with no version stamp, so a repo that
 * installed at v0.1.0 runs that guard forever and nothing can tell. `.manifest.json`
 * ({cortexVersion, files:{name:sha256}}) is what makes a vendored copy identifiable,
 * repairable, and — the part that motivated the feature — safe to have edited.
 *
 * `templates/cortex-reflect.mjs:18` tells users "edit `.cortex/lib/` to change the guard".
 * Every test below exists because some part of that instruction is a lie without a manifest.
 *
 * These drive `install()` and the filesystem rather than importing manifest internals: the
 * guarantees belong to the installed repo, not to whichever module happens to compute them.
 */

const LIB = '.cortex/lib';
const MANIFEST_REL = `${LIB}/.manifest.json`;

/** The four files SPEC D5 names. The suite also checks the manifest against whatever is
 *  actually on disk, so adding a fifth vendored file does not need this list edited — but
 *  losing one of these four is a regression the spec cares about by name. */
const VENDORED = ['guard.mjs', 'paths.mjs', 'memory.mjs', 'map.mjs'];

const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const NEXT_PKG = {
  name: 'acme-storefront',
  description: 'Customer-facing storefront',
  scripts: { dev: 'next dev', build: 'next build', test: 'vitest' },
  dependencies: { next: '14.1.4', react: '18.2.0' },
  devDependencies: { vitest: '1.4.0' },
};

/**
 * Run `fn` against a throwaway repo and delete it afterwards, pass or fail.
 *
 * The older suites mkdtemp without ever removing, which is how the tmp dir accumulated
 * hundreds of `cortex-install-*` leftovers. Everything here cleans up in a finally.
 */
function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'cortex-manifest-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify(NEXT_PKG, null, 2));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/index.ts'), 'export function boot() {}\n');
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Read the manifest as bytes AND as parsed JSON — several tests need both. */
function readManifest(root) {
  const abs = join(root, MANIFEST_REL);
  assert.ok(existsSync(abs), `expected ${MANIFEST_REL} to exist after install`);
  const bytes = readFileSync(abs);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    assert.fail(`${MANIFEST_REL} is not valid JSON: ${err.message}`);
  }
  return { bytes, manifest: parsed, abs };
}

/**
 * The spec writes `files:{name:sha256}`. Accept a bare hex digest or a `sha256:`-prefixed
 * one — the guarantee under test is that the digest matches the bytes, not its encoding.
 */
const digestOf = (recorded) => String(recorded).replace(/^sha256:/, '');

/** Every `.bak` sitting in `.cortex/lib/`, sorted. */
const baksIn = (root) =>
  existsSync(join(root, LIB)) ? readdirSync(join(root, LIB)).filter((n) => n.endsWith('.bak')).sort() : [];

/** Non-manifest, non-backup files the installer vendored. */
const vendoredOnDisk = (root) =>
  readdirSync(join(root, LIB))
    .filter((n) => n.endsWith('.mjs') && !n.endsWith('.bak'))
    .sort();

// ── the manifest itself ────────────────────────────────────────────────────

test('install writes a lib manifest naming every file it vendored', () =>
  withRepo((root) => {
    install(root);
    const { manifest } = readManifest(root);

    assert.equal(typeof manifest.cortexVersion, 'string', 'manifest must carry a cortexVersion');
    assert.ok(manifest.files && typeof manifest.files === 'object', 'manifest must carry a files map');

    for (const name of VENDORED) {
      assert.ok(name in manifest.files, `SPEC D5 names ${name}; manifest does not record it`);
    }

    // A vendored file with no manifest entry is invisible to edit-detection and to version
    // reporting — exactly the hole D5 closes. Adding one must not be possible silently.
    assert.deepEqual(
      Object.keys(manifest.files).sort(),
      vendoredOnDisk(root),
      'manifest file set must match what is actually vendored in .cortex/lib/',
    );
  }));

test('every hash in the manifest matches the bytes actually on disk', () =>
  withRepo((root) => {
    install(root);
    const { manifest } = readManifest(root);

    for (const [name, recorded] of Object.entries(manifest.files)) {
      const abs = join(root, LIB, name);
      assert.ok(existsSync(abs), `manifest records ${name} but no such file was vendored`);
      // Computed here, not trusted: a manifest that records whatever it just wrote without
      // hashing the bytes would pass a self-consistency check and still be wrong.
      assert.equal(
        digestOf(recorded),
        sha256(readFileSync(abs)),
        `recorded hash for ${name} does not match its bytes`,
      );
    }
  }));

test('the recorded cortexVersion is the running package version, not a literal', () =>
  withRepo((root) => {
    install(root);
    const { manifest } = readManifest(root);
    // Read from package.json so this test survives every release without an edit.
    assert.equal(manifest.cortexVersion, PKG_VERSION);
  }));

test('the vendored copies stay byte-identical to src/, so diff still works as an audit', () =>
  withRepo((root) => {
    install(root);
    // D5 rejected stamping a version comment into each copy precisely to keep this true.
    for (const name of VENDORED) {
      const vendored = readFileSync(join(root, LIB, name));
      const source = readFileSync(new URL(`../src/${name}`, import.meta.url));
      assert.deepEqual(vendored, source, `${name} must be a byte copy of src/${name}`);
    }
  }));

// ── the bug that motivated the feature ─────────────────────────────────────

test('a hand-edited vendored file is backed up, and the backup holds the user edit', () =>
  withRepo((root) => {
    install(root);

    // What templates/cortex-reflect.mjs:18 tells users to do: edit the vendored guard.
    const guardAbs = join(root, LIB, 'guard.mjs');
    const pristine = readFileSync(guardAbs, 'utf8');
    const edited = `${pristine}\n// TEAM RULE: never allow writes containing our internal ticket ids.\nexport const TEAM_MARKER = 'do-not-lose-me';\n`;
    writeFileSync(guardAbs, edited);

    install(root);

    const bakAbs = `${guardAbs}.bak`;
    assert.ok(existsSync(bakAbs), 'an edited vendored file must be backed up before it is overwritten');

    const bak = readFileSync(bakAbs, 'utf8');
    // Assert on content, not existence: a .bak written *after* the overwrite would exist and
    // still have destroyed the edit, which is the failure mode worth catching.
    assert.equal(bak, edited, 'the .bak must contain the user edit');
    assert.ok(bak.includes('do-not-lose-me'), 'the user edit is gone from the backup');
    assert.notEqual(bak, pristine, 'the .bak is the freshly-written content, not the edit');

    // and the live file is repaired back to the shipped version
    assert.equal(readFileSync(guardAbs, 'utf8'), pristine, 'the vendored file must be restored to src/');
  }));

test('an edited file is re-hashed, so the manifest describes the repaired copy', () =>
  withRepo((root) => {
    install(root);
    const guardAbs = join(root, LIB, 'guard.mjs');
    writeFileSync(guardAbs, `${readFileSync(guardAbs, 'utf8')}\n// local edit\n`);

    install(root);
    const { manifest } = readManifest(root);
    assert.equal(digestOf(manifest.files['guard.mjs']), sha256(readFileSync(guardAbs)));
  }));

// ── no-op runs ─────────────────────────────────────────────────────────────

test('a second identical run rewrites nothing and creates no new .bak', () =>
  withRepo((root) => {
    install(root);
    const baksAfterFirst = baksIn(root);

    // mtime, pinned to a known past value, is the only reliable "was this file rewritten"
    // signal: two installs in the same millisecond could otherwise look identical.
    const past = new Date('2020-01-01T00:00:00Z');
    const before = {};
    for (const name of [...vendoredOnDisk(root), '.manifest.json']) {
      const abs = join(root, LIB, name);
      utimesSync(abs, past, past);
      before[name] = readFileSync(abs);
    }

    const { plan } = install(root);

    for (const name of Object.keys(before)) {
      const abs = join(root, LIB, name);
      assert.equal(
        statSync(abs).mtimeMs,
        past.getTime(),
        `${name} was rewritten on an identical re-run; matching version + hash must skip`,
      );
      assert.deepEqual(readFileSync(abs), before[name], `${name} changed on an identical re-run`);
    }

    assert.deepEqual(
      baksIn(root),
      baksAfterFirst,
      'an identical re-run must not churn .bak files in .cortex/lib/',
    );

    const libRows = plan.filter((s) => s.rel && s.rel.startsWith(`${LIB}/`) && !s.rel.endsWith('.manifest.json'));
    assert.ok(libRows.length > 0, 'the plan must still report the vendored files');
    assert.ok(
      libRows.every((s) => s.skipped),
      `an unchanged vendored file must be reported skipped; got ${JSON.stringify(libRows)}`,
    );
  }));

test('the manifest is byte-stable across runs', () =>
  withRepo((root) => {
    install(root);
    const first = readManifest(root).bytes;
    install(root);
    // Key reordering here shows up as a diff in someone else's committed repo on every run.
    assert.deepEqual(readManifest(root).bytes, first, 'the manifest must not change on a no-op re-run');
  }));

test('two runs that both WRITE the manifest produce identical bytes', () =>
  withRepo((root) => {
    install(root);
    const first = readManifest(root).bytes;

    // The test above only proves the no-op path skips the write. This one forces the write
    // path twice: a serialiser that folded in a timestamp, or that emitted keys in hash-map
    // order, would sail through the skip check and still produce a spurious diff every time
    // an upgrade or an edit-repair actually rewrote the file.
    unlinkSync(join(root, MANIFEST_REL));
    install(root);
    const second = readManifest(root).bytes;
    assert.deepEqual(second, first, 'a rewritten manifest must serialise identically');

    // and once more via the repair path rather than the missing-file path
    const guardAbs = join(root, LIB, 'guard.mjs');
    writeFileSync(guardAbs, `${readFileSync(guardAbs, 'utf8')}\n// edit\n`);
    install(root);
    assert.deepEqual(readManifest(root).bytes, first, 'a manifest rewritten after a repair must match');
  }));

test('the manifest contains no CR bytes, because it is committed into other repos', () =>
  withRepo((root) => {
    install(root);
    const { bytes } = readManifest(root);
    // Byte-level on purpose: counting lines cannot distinguish LF from CRLF.
    const cr = bytes.indexOf(0x0d);
    assert.equal(
      cr,
      -1,
      `manifest contains CR (0x0D) at byte ${cr}; the repo normalises to LF and this file is committed`,
    );
  }));

// ── version reporting ──────────────────────────────────────────────────────

test('a differing cortexVersion is reported in the plan and then re-stamped', () =>
  withRepo((root) => {
    install(root);
    const { manifest, abs } = readManifest(root);

    // Simulate a repo that installed at an older cortex.
    const stale = { ...manifest, cortexVersion: '0.0.1' };
    writeFileSync(abs, JSON.stringify(stale, null, 2) + '\n');

    const { plan } = install(root);

    const reported = plan.filter((s) => s.note && s.note.includes('0.0.1') && s.note.includes(PKG_VERSION));
    assert.ok(
      reported.length > 0,
      `a version change must be reported; no plan note mentions 0.0.1 → ${PKG_VERSION}. plan: ${JSON.stringify(plan.filter((s) => s.rel && s.rel.startsWith('.cortex/lib')))}`,
    );

    assert.equal(readManifest(root).manifest.cortexVersion, PKG_VERSION, 'the manifest must be re-stamped');
  }));

test('an upgrade from a stale version leaves every copy matching the shipped source', () =>
  withRepo((root) => {
    install(root);
    const { manifest, abs } = readManifest(root);

    // A stale manifest recording hashes that are NOT the shipped bytes: the shape an actual
    // upgrade takes, where the repo carries an older guard than the one being installed.
    const stale = { cortexVersion: '0.0.1', files: Object.fromEntries(VENDORED.map((n) => [n, sha256(Buffer.from(`old ${n}`))])) };
    writeFileSync(abs, JSON.stringify(stale, null, 2) + '\n');
    for (const name of VENDORED) writeFileSync(join(root, LIB, name), `// cortex 0.0.1\nexport const OLD = true;\n`);

    install(root);

    for (const name of VENDORED) {
      assert.deepEqual(
        readFileSync(join(root, LIB, name)),
        readFileSync(new URL(`../src/${name}`, import.meta.url)),
        `${name} must be refreshed to the shipped source on an upgrade`,
      );
    }
    assert.equal(readManifest(root).manifest.cortexVersion, PKG_VERSION);
  }));

test('a manifest recording an older copy is replaced without a .bak; only real edits are kept', () =>
  withRepo((root) => {
    install(root);
    const { manifest, abs } = readManifest(root);

    // Simulate "this repo has cortex 0.0.1's guard, and the 0.0.1 manifest agrees" — the copy
    // is ours, not the team's, so replacing it costs nothing and a .bak would be junk.
    const oldGuard = '// cortex 0.0.1 guard\nexport const scan = () => [];\n';
    writeFileSync(join(root, LIB, 'guard.mjs'), oldGuard);
    writeFileSync(
      abs,
      JSON.stringify(
        { cortexVersion: '0.0.1', files: { ...manifest.files, 'guard.mjs': sha256(Buffer.from(oldGuard)) } },
        null,
        2,
      ) + '\n',
    );

    install(root);

    assert.deepEqual(baksIn(root), [], 'a copy the manifest vouches for is ours to replace, with no backup');
    assert.deepEqual(
      readFileSync(join(root, LIB, 'guard.mjs')),
      readFileSync(new URL('../src/guard.mjs', import.meta.url)),
    );
  }));

test('an unparseable manifest is treated as unknown provenance, not a crash', () =>
  withRepo((root) => {
    install(root);
    writeFileSync(join(root, MANIFEST_REL), '{ truncated mid-write');

    // A half-written manifest (interrupted install, bad merge) must not take the installer
    // down, and must not be trusted either.
    assert.doesNotThrow(() => install(root));
    const { manifest } = readManifest(root);
    assert.equal(manifest.cortexVersion, PKG_VERSION, 'the damaged manifest must be rewritten');
    for (const [name, recorded] of Object.entries(manifest.files)) {
      assert.equal(digestOf(recorded), sha256(readFileSync(join(root, LIB, name))));
    }
  }));

// ── migration: an already-installed repo with no manifest ──────────────────

test('a pre-manifest install gains a manifest without clobbering a local edit', () =>
  withRepo((root) => {
    install(root);
    // Exactly the state of every repo installed before D5 shipped.
    unlinkSync(join(root, MANIFEST_REL));
    for (const b of baksIn(root)) unlinkSync(join(root, LIB, b));

    const guardAbs = join(root, LIB, 'guard.mjs');
    const pristine = readFileSync(guardAbs, 'utf8');
    const edited = `${pristine}\n// TEAM RULE: keep this.\n`;
    writeFileSync(guardAbs, edited);

    install(root);

    const { manifest } = readManifest(root);
    assert.equal(manifest.cortexVersion, PKG_VERSION, 'migration must stamp the current version');

    assert.ok(
      existsSync(`${guardAbs}.bak`),
      'with no manifest the installer cannot know a file is unedited, so it must back up before overwriting',
    );
    assert.equal(readFileSync(`${guardAbs}.bak`, 'utf8'), edited, 'the pre-manifest edit must survive in the .bak');
    assert.equal(readFileSync(guardAbs, 'utf8'), pristine);
  }));

test('migration does not back up vendored files the user never touched', () =>
  withRepo((root) => {
    install(root);
    unlinkSync(join(root, MANIFEST_REL));
    for (const b of baksIn(root)) unlinkSync(join(root, LIB, b));

    install(root);

    // Hashing against the shipped source tells the installer these are untouched, so there
    // is nothing to preserve. Backing them up anyway drops four junk files into every
    // already-installed repo on upgrade — the .bak churn this feature is meant to stop.
    assert.deepEqual(
      baksIn(root),
      [],
      'untouched copies match src/ byte for byte; a .bak for them is pure churn',
    );
  }));

// ── dry run ────────────────────────────────────────────────────────────────

test('dry run writes no manifest', () =>
  withRepo((root) => {
    const { plan } = install(root, { dryRun: true });
    assert.equal(existsSync(join(root, MANIFEST_REL)), false, 'dry run must not write the manifest');
    assert.ok(plan.length > 0);
  }));

test('dry run against an installed repo neither rewrites nor backs up the manifest', () =>
  withRepo((root) => {
    install(root);
    const before = readManifest(root).bytes;
    const baksBefore = baksIn(root);

    install(root, { dryRun: true });

    assert.deepEqual(readManifest(root).bytes, before, 'dry run rewrote the manifest');
    assert.deepEqual(baksIn(root), baksBefore, 'dry run created a backup');
  }));
