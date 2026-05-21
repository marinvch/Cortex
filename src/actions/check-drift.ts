import { detectDrift, formatDriftReport } from '../detectors/drift.js';

export async function runCheckDriftAction(cwd: string, verbose = false): Promise<void> {
  console.log(`  🔍 AI OS drift check: ${cwd}`);
  console.log('');

  const report = detectDrift(cwd);
  console.log(formatDriftReport(report, verbose));

  if (report.errors.length > 0) {
    console.log('  ❌ Drift errors detected. Run `--refresh-existing` to fix.');
    console.log('');
    process.exit(1);
  } else if (report.warnings.length > 0) {
    console.log('  ⚠️  Drift warnings found. Consider running `--refresh-existing` to resync.');
    console.log('');
  } else {
    console.log('  ✅ No drift detected — all AI OS artifacts are healthy.');
    console.log('');
  }
}
