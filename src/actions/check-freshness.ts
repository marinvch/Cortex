import { computeFreshnessReport, formatFreshnessReport } from '../detectors/freshness.js';

export function runCheckFreshnessAction(cwd: string, json = false): void {
  if (!json) {
    console.log(`  🔍 Context freshness check: ${cwd}`);
    console.log('');
  }

  const report = computeFreshnessReport(cwd);

  if (json) {
    console.log(JSON.stringify({
      action: 'check-freshness',
      status: report.status,
      score: report.score,
      snapshotCapturedAt: report.snapshotCapturedAt ?? null,
      lastGenerationAt: report.lastGeneratedAt ?? null,
      staleArtifacts: report.staleArtifacts,
      changedSourceFiles: report.changedSourceFiles,
      recommendations: report.recommendations,
    }));

    const isCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
    if (report.status === 'stale' && isCi) process.exit(1);
    return;
  }

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
