import { getToolVersion } from '../updater.js';
import { parseArgs } from './args.js';
import { runCheckHygieneAction } from '../actions/check-hygiene.js';
import { runDoctorAction } from '../actions/doctor.js';
import { runCheckFreshnessAction } from '../actions/check-freshness.js';
import { runCompactMemoryAction } from '../actions/compact-memory.js';
import { runApply } from '../actions/apply.js';
import { runUninstall, formatUninstallReport } from '../uninstall.js';

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
    runCheckHygieneAction(cwd);
    return;
  }

  if (action === 'doctor') {
    runDoctorAction(cwd);
    return;
  }

  if (action === 'check-freshness') {
    runCheckFreshnessAction(cwd);
    return;
  }

  if (action === 'compact-memory') {
    runCompactMemoryAction(cwd);
    return;
  }

  if (action === 'uninstall') {
    const report = runUninstall(cwd, { dryRun: args.dryRun, verbose: args.verbose });
    console.log(formatUninstallReport(report));
    return;
  }

  // ── Pipeline actions (plan / preview / apply / bootstrap / dryRun) ───────
  await runApply(args);
}
