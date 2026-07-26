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
    --cwd <path>  target a different repo (default: current directory)
    -h, --help    show this

  Writes only inside the target repo. Makes no network requests.
`;

function parseArgs(argv) {
  const opts = { dryRun: false, refresh: false, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--cwd') opts.cwd = argv[++i];
    else if (a.startsWith('--cwd=')) opts.cwd = a.slice(6);
    else if (a === '-h' || a === '--help') opts.help = true;
    else console.error(`  (ignoring unknown argument: ${a})`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

try {
  const { facts, plan } = install(opts.cwd, { refresh: opts.refresh, dryRun: opts.dryRun });

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
