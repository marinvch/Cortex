import readline from 'node:readline';
import { getToolVersion } from '../updater.js';
import { parseArgs } from './args.js';
import { runCheckHygieneAction } from '../actions/check-hygiene.js';
import { runDoctorAction } from '../actions/doctor.js';
import { runCheckFreshnessAction } from '../actions/check-freshness.js';
import { runCompactMemoryAction } from '../actions/compact-memory.js';
import { runCheckDriftAction } from '../actions/check-drift.js';
import { runCheckBoundariesAction } from '../actions/check-boundaries.js';
import { runApply } from '../actions/apply.js';
import { runUninstall, formatUninstallReport } from '../uninstall.js';
import { runInitWizard } from '../actions/init.js';
import { indexRepo } from '../actions/index.js';
import { analyze } from '../analyze.js';
import { readAiOsConfig } from '../generators/context-docs.js';

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function printBanner(): void {
  const version = `v${getToolVersion()}`;
  const versionCell = `Cortex  ${version}`.padEnd(25, ' ');
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log(`  ║          ${versionCell}║`);
  console.log('  ║  Portable AI-Assistant Context    ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');
}

export async function main(): Promise<void> {
  const args = parseArgs();
  const { cwd, action } = args;

  // Suppress banner in JSON mode
  if (!args.json) {
    printBanner();
  }

  // ── Early-exit actions (no scan or generation needed) ────────────────────
  if (action === 'check-hygiene') {
    runCheckHygieneAction(cwd, args.json);
    return;
  }

  if (action === 'doctor') {
    runDoctorAction(cwd, args.json);
    return;
  }

  if (action === 'check-freshness') {
    runCheckFreshnessAction(cwd, args.json);
    return;
  }

  if (action === 'compact-memory') {
    runCompactMemoryAction(cwd);
    return;
  }

  if (action === 'check-drift') {
    await runCheckDriftAction(cwd, args.verbose);
    return;
  }

  if (action === 'check-boundaries') {
    runCheckBoundariesAction(cwd, args.json);
    return;
  }

  if (action === 'index') {
    await indexRepo({
      cwd,
      incremental: args.incremental,
      regenContext: args.regenerateContext,
      dryRun: args.dryRun,
      quiet: args.json,
      specDir: args.specDir,
    });
    return;
  }

  if (action === 'init') {
    const stack = analyze(cwd);
    const result = await runInitWizard(stack, cwd);
    if (!result.proceed) return;
    args.profile = result.profile;
    args.model = result.model;
    // Personal-OS linkage from the wizard (CLI --personal-brain-path still takes precedence)
    if (result.projectBoundary) args.projectBoundary = result.projectBoundary;
    if (result.personalBrainPath && !args.personalBrainPath) args.personalBrainPath = result.personalBrainPath;
    // Fall through to apply with selected profile + model
  }

  // For update/refresh: if project is still on copilot and no explicit --model flag,
  // offer migration to Claude Code (skip in JSON/dry-run mode and after --init)
  if (
    action !== 'init' &&
    !args.json &&
    !args.dryRun &&
    process.stdin.isTTY &&
    args.model === 'copilot' &&
    (args.mode === 'refresh-existing' || args.mode === 'update' || action === 'apply')
  ) {
    const existingCfg = readAiOsConfig(cwd);
    if (existingCfg && (!existingCfg.model || existingCfg.model === 'copilot')) {
      const answer = await promptUser('  🤖 Add Claude Code support to this project? [y/N]: ');
      if (answer.trim().toLowerCase() === 'y') {
        args.model = 'claude';
        console.log('  ✅ Claude Code selected — CLAUDE.md will be generated.\n');
      }
    }
  }

  if (action === 'uninstall') {
    const report = runUninstall(cwd, { dryRun: args.dryRun, verbose: args.verbose });
    console.log(formatUninstallReport(report));
    return;
  }

  // ── Pipeline actions (plan / preview / apply / bootstrap / dryRun) ───────
  await runApply(args);
}
