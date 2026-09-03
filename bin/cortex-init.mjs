#!/usr/bin/env node
import { install } from '../src/install.mjs';
import { OutsideRepoError } from '../src/paths.mjs';

const HELP = `
  cortex-init — install a codebase brain into this repo

  Usage
    npx @marinvch/cortex-init [options]

  Options
    --dry-run     print the plan, write nothing
    --refresh     re-scan and update only the generated block of AGENTS.md
    --no-map      record \`"map": false\` in .cortex/config.json and skip .cortex/map.md
    --cwd <path>  target a different repo (default: current directory)
    -h, --help    show this

  Writes only inside the target repo. Makes no network requests.
`;

const FLAGS = ['--dry-run', '--refresh', '--no-map', '--cwd', '--help', '-h'];

/** Levenshtein distance. Twenty lines beats a dependency, and this is the only caller. */
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * The closest real flag, or null. Naming it is help; acting on it would not be — `--dryrun`
 * is one edit from the flag whose entire purpose is to write nothing, so a guess that
 * resolved itself would be the same bug in a friendlier coat.
 */
function suggest(token) {
  const name = token.split('=')[0];
  if (name.length < 3) return null;
  let best = null;
  let bestScore = 3; // strictly closer than this, so at most two edits away
  for (const flag of FLAGS) {
    const d = distance(name, flag);
    if (d < bestScore) {
      bestScore = d;
      best = flag;
    }
  }
  return best;
}

/**
 * Parse, collecting every problem rather than throwing on the first — a run with two typos
 * should report two, not send the user round the loop twice.
 *
 * An unrecognised argument is an error, never a warning. It used to print to stderr and let
 * the install proceed with exit 0, which meant `--dryrun` wrote the full brain into someone's
 * repo and reported success: the one flag that exists in order not to write was a single
 * keystroke from doing the opposite (D6).
 */
function parseArgs(argv) {
  const opts = { dryRun: false, refresh: false, noMap: false, cwd: process.cwd(), errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--no-map') opts.noMap = true;
    else if (a === '--cwd' || a.startsWith('--cwd=')) {
      // A bare `--cwd` used to take `argv[++i]` — undefined — and fail deep inside
      // path resolution with an opaque TypeError, after the user had already been told
      // nothing about what they got wrong.
      const value = a === '--cwd' ? argv[++i] : a.slice(6);
      if (!value) opts.errors.push('--cwd needs a path, e.g. --cwd ../other-repo');
      else opts.cwd = value;
    } else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) {
      const hint = suggest(a);
      opts.errors.push(`unknown option: ${a}${hint ? ` (did you mean ${hint}?)` : ''}`);
    } else {
      opts.errors.push(`unexpected argument: ${a} (this CLI takes options only; to target another repo use --cwd <path>)`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// Reported before --help, so a typo is never swallowed by the run that was meant to explain
// the flags. Exit 2 is "the invocation was wrong and nothing was written" — the same
// contract as OutsideRepoError below, which is also a bad target caught before any write.
if (opts.errors.length) {
  console.error('');
  for (const message of opts.errors) console.error(`  cortex-init: ${message}`);
  console.error(`\n  Run \`cortex-init --help\` for the full list. Nothing was written.\n`);
  process.exit(2);
}

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

try {
  const { facts, plan } = install(opts.cwd, {
    refresh: opts.refresh,
    dryRun: opts.dryRun,
    noMap: opts.noMap,
  });

  const detected = [facts.framework, facts.languages[0], facts.packageManager]
    .filter(Boolean)
    .join(' · ');

  console.log('');
  console.log(`  cortex-init — ${facts.name}${detected ? ` (${detected})` : ''}`);
  console.log(opts.dryRun ? '  DRY RUN — nothing written\n' : '');

  for (const step of plan) {
    console.log(`  ${step.skipped ? '·' : '✓'} ${step.rel}${step.note ? `  — ${step.note}` : ''}`);
  }

  console.log('');
  if (!opts.dryRun) {
    console.log('  Next: fill in the Conventions and Glossary sections of AGENTS.md,');
    console.log('  then commit it so the whole team inherits the brain.');
    console.log('');
  }
} catch (err) {
  if (err instanceof OutsideRepoError) {
    console.error(`\n  cortex-init: ${err.message}\n`);
    process.exit(2);
  }
  console.error(`\n  cortex-init failed: ${err.message}\n`);
  process.exit(1);
}
