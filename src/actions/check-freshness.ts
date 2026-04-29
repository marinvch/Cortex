import { computeFreshnessReport, formatFreshnessReport } from '../detectors/freshness.js';

export function runCheckFreshnessAction(cwd: string): void {
  console.log(`  🔍 Context freshness check: ${cwd}`);
  console.log('');

  const report = computeFreshnessReport(cwd);
  console.log(formatFreshnessReport(report));

  const isCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';

  if (report.status === 'stale') {
    console.log('  ❌ Context is stale. Run `--refresh-existing` to rebuild context artifacts.');
    if (isCi) process.exit(1);
  } else if (report.status === 'drifted') {
    console.log('  ⚠️  Context has drifted. Consider running `--refresh-existing` to resync.');
  } else if (report.status === 'unknown') {
    console.log('  ❓ No snapshot found — run AI OS generation first to establish a baseline.');
  } else {
    console.log('  ✅ Context is fresh.');
  }
  console.log('');
}
