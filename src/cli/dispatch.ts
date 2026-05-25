import { getToolVersion } from '../updater.js';
import { parseArgs } from './args.js';
import { runCheckHygieneAction } from '../actions/check-hygiene.js';
import { runDoctorAction } from '../actions/doctor.js';
import { runCheckFreshnessAction } from '../actions/check-freshness.js';
import { runCompactMemoryAction } from '../actions/compact-memory.js';
import { runCheckDriftAction } from '../actions/check-drift.js';
import { runApply } from '../actions/apply.js';
import { runUninstall, formatUninstallReport } from '../uninstall.js';
import { runInitWizard } from '../actions/init.js';
import { indexRepo } from '../actions/index.js';
import { analyze } from '../analyze.js';

function printBanner(): void {
  const version = `v${getToolVersion()}`;
  const versionCell = `AI OS  ${version}`.padEnd(25, ' ');
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log(`  ║          ${versionCell}║`);
  console.log('  ║  Portable Copilot Context Engine  ║');
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

  if (action === 'index') {
    await indexRepo({
      cwd,
      incremental: args.incremental,
      regenContext: args.regenerateContext,
      dryRun: args.dryRun,
      quiet: args.json,
    });
    return;
  }

  if (action === 'init') {
    const stack = analyze(cwd);
    const result = await runInitWizard(stack, cwd);
    if (!result.proceed) return;
    args.profile = result.profile;
    // Fall through to apply with selected profile
  }

  if (action === 'uninstall') {
    const report = runUninstall(cwd, { dryRun: args.dryRun, verbose: args.verbose });
    console.log(formatUninstallReport(report));
    return;
  }

  // ── Pipeline actions (plan / preview / apply / bootstrap / dryRun) ───────
  await runApply(args);
}
