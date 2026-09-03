import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The argument layer of `bin/cortex-init.mjs`, exercised as a process.
 *
 * Every other suite calls `install()` directly, which is why D6 survived from the first
 * commit until it was found by hand: `--dryrun` — one keystroke from the flag whose entire
 * purpose is to write nothing — parsed as "unknown", printed a warning, performed a full
 * install and exited 0. No test could see it, because no test ever ran the binary.
 *
 * So these spawn it. And the load-bearing assertion in every failure case is not the exit
 * code but the *filesystem*: an exit 2 with the brain written anyway is the same bug wearing
 * a better hat. `pristine()` is what actually pins the contract.
 *
 * Assertions match short phrases rather than whole sentences. The wording of these messages
 * is meant to be edited; the behaviour is not.
 *
 * `node:child_process` is fine here — `scripts/assert-no-egress.mjs` scans `src/`, `bin/`
 * and `templates/`, never `test/`.
 */

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cortex-init.mjs');

/** Every temp dir this file creates, removed at exit. The suites leak nothing; keep it that way. */
const TEMP_DIRS = [];

process.on('exit', () => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort: a leaked temp dir must never fail a green run.
    }
  }
});

/** A throwaway repo that looks real enough for detection to have something to say. */
function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-cli-'));
  TEMP_DIRS.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'cli-fixture' }));
  return dir;
}

/**
 * Run the binary. `cwd` is where the process starts, so a run with no `--cwd` targets it —
 * which is what lets a failure case prove nothing was written by checking that directory.
 */
function cli(args, { cwd } = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(res.error, undefined, `spawn failed: ${res.error?.message}`);
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Nothing Cortex owns exists here. The real contract behind every "exit 2" below. */
function pristine(dir) {
  return !existsSync(join(dir, 'AGENTS.md')) && !existsSync(join(dir, '.cortex'));
}

// ── bad invocations refuse, and refuse without writing ──────────────────────

/**
 * The table is the point: each of these used to be a full install at exit 0, and the
 * `pristine` column is the assertion that would have caught it.
 */
const REFUSED = [
  ['a typo one edit from --dry-run', ['--dryrun'], /unknown option/i],
  ['an unknown flag with no near match', ['--zzzzz'], /unknown option/i],
  ['a bare non-flag argument', ['install'], /unexpected argument/i],
  ['--cwd with no value', ['--cwd'], /--cwd needs a path/i],
  ['--cwd= with an empty value', ['--cwd='], /--cwd needs a path/i],
];

for (const [label, args, expected] of REFUSED) {
  test(`refuses ${label} and writes nothing`, () => {
    const repo = tmpRepo();
    const { status, stderr } = cli(args, { cwd: repo });

    assert.equal(status, 2, `expected exit 2 for ${args.join(' ')}`);
    assert.match(stderr, expected);
    assert.ok(pristine(repo), `${args.join(' ')} must not write into the target repo`);
  });
}

test('a suggestion is advice, never an action', () => {
  // `--dryrun` resolving itself to `--dry-run` would be the original defect in a friendlier
  // coat: the tool would act on a flag the user did not type.
  const repo = tmpRepo();
  const { status, stdout } = cli(['--dryrun'], { cwd: repo });

  assert.equal(status, 2);
  assert.doesNotMatch(stdout, /DRY RUN/, 'must refuse, not perform the run it guessed at');
  assert.ok(pristine(repo));
});

test('names the closest flag when there is one, and does not invent one when there is not', () => {
  const repo = tmpRepo();
  assert.match(cli(['--dryrun'], { cwd: repo }).stderr, /--dry-run/, 'a near miss is worth naming');
  assert.doesNotMatch(
    cli(['--zzzzz'], { cwd: repo }).stderr,
    /did you mean/i,
    'a wild guess is worse than none',
  );
});

test('an unexpected argument is told apart from an unknown option', () => {
  // `install` is not a mistyped flag — it is someone expecting a subcommand. Saying
  // "unknown option" there sends them looking for a flag that never existed.
  const repo = tmpRepo();
  const { stderr } = cli(['install'], { cwd: repo });
  assert.match(stderr, /unexpected argument/i);
  assert.match(stderr, /--cwd/, 'points at the flag that does what they wanted');
});

test('reports every bad argument, not just the first', () => {
  const repo = tmpRepo();
  const { status, stderr } = cli(['--dryrun', '--refressh'], { cwd: repo });

  assert.equal(status, 2);
  assert.match(stderr, /--dryrun/, 'first bad argument reported');
  assert.match(stderr, /--refressh/, 'second bad argument reported too');
  assert.ok(pristine(repo));
});

// ── help ordering ──────────────────────────────────────────────────────────

test('--help alone exits 0 and writes nothing', () => {
  const repo = tmpRepo();
  const { status, stdout } = cli(['--help'], { cwd: repo });

  assert.equal(status, 0);
  assert.match(stdout, /--dry-run/, 'the flag list is the point of --help');
  assert.ok(pristine(repo));
});

test('-h is the same as --help', () => {
  const repo = tmpRepo();
  assert.equal(cli(['-h'], { cwd: repo }).status, 0);
  assert.ok(pristine(repo));
});

test('a bad argument beats --help, so a typo is never swallowed by the help text', () => {
  // Deliberate ordering. If help won, `cortex-init --help --dryrun` would print the flag
  // list and exit 0, and the user would never learn that `--dryrun` is not a flag.
  const repo = tmpRepo();
  const { status, stderr } = cli(['--help', '--dryrun'], { cwd: repo });

  assert.equal(status, 2, 'errors are reported before help, not after');
  assert.match(stderr, /--dryrun/);
  assert.ok(pristine(repo));
});

// ── the good paths still work ──────────────────────────────────────────────

test('a plain run installs the brain', () => {
  const repo = tmpRepo();
  const { status } = cli([], { cwd: repo });

  assert.equal(status, 0);
  assert.ok(existsSync(join(repo, 'AGENTS.md')));
  assert.ok(existsSync(join(repo, '.cortex')));
});

test('--dry-run exits 0, prints a plan, and writes nothing', () => {
  const repo = tmpRepo();
  const { status, stdout } = cli(['--dry-run'], { cwd: repo });

  assert.equal(status, 0);
  assert.match(stdout, /AGENTS\.md/, 'a plan the user can read');
  assert.ok(pristine(repo), 'the whole point of the flag');
});

test('--cwd <path> targets that repo and leaves the working directory alone', () => {
  const target = tmpRepo();
  const elsewhere = tmpRepo();
  const { status } = cli(['--cwd', target], { cwd: elsewhere });

  assert.equal(status, 0);
  assert.ok(existsSync(join(target, 'AGENTS.md')), 'wrote into the named repo');
  assert.ok(pristine(elsewhere), 'did not write into the directory it was run from');
});

test('--cwd=<path> is the same as --cwd <path>', () => {
  const target = tmpRepo();
  const elsewhere = tmpRepo();
  const { status } = cli([`--cwd=${target}`], { cwd: elsewhere });

  assert.equal(status, 0);
  assert.ok(existsSync(join(target, 'AGENTS.md')));
  assert.ok(pristine(elsewhere));
});

test('--no-map installs the brain without a map', () => {
  const repo = tmpRepo();
  const { status } = cli(['--no-map'], { cwd: repo });

  assert.equal(status, 0);
  assert.ok(existsSync(join(repo, 'AGENTS.md')));
  assert.equal(existsSync(join(repo, '.cortex/map.md')), false);
});

test('--refresh without an AGENTS.md says so instead of failing', () => {
  const repo = tmpRepo();
  const { status } = cli(['--refresh'], { cwd: repo });

  assert.equal(status, 0);
  assert.equal(existsSync(join(repo, 'AGENTS.md')), false, 'refresh does not create the brain');
});

test('a second run is a no-op — nothing new, no backups', () => {
  const repo = tmpRepo();
  cli([], { cwd: repo });
  const { status, stdout } = cli([], { cwd: repo });

  assert.equal(status, 0);
  assert.doesNotMatch(stdout, /✓/, 'every row should be a skip on an unchanged repo');
  assert.equal(existsSync(join(repo, 'AGENTS.md.bak')), false, 'no backup of an unchanged file');
});

test('a target outside any repo is refused before anything is written', () => {
  // OutsideRepoError shares the exit-2 contract: a bad invocation, caught before a write.
  const elsewhere = tmpRepo();
  const { status } = cli(['--cwd', join(elsewhere, 'does-not-exist')], { cwd: elsewhere });

  assert.notEqual(status, 0, 'a target that cannot be resolved must not report success');
  assert.ok(pristine(elsewhere));
});
