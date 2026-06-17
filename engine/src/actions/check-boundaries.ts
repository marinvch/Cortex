import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BoundaryLeak { id: string; title: string; domain: string; }
export interface BoundaryReport {
  status: 'clean' | 'leaks-found' | 'no-memory';
  leaks: BoundaryLeak[];
  missingGitignore: string[];
  scannedEntries: number;
}

const REQUIRED_GITIGNORE = ['.github/ai-os/memory/'];

export function computeBoundaryReport(cwd: string): BoundaryReport {
  const memPath = path.join(cwd, '.github', 'ai-os', 'memory', 'memory.jsonl');
  const leaks: BoundaryLeak[] = [];
  let scannedEntries = 0;

  if (fs.existsSync(memPath)) {
    const lines = fs.readFileSync(memPath, 'utf-8').split('\n').filter((l) => l.trim());
    for (const line of lines) {
      let entry: { id?: string; title?: string; domain?: string };
      try { entry = JSON.parse(line); } catch { continue; }
      scannedEntries++;
      const domain = entry.domain ?? 'project';
      if (domain !== 'project') {
        leaks.push({ id: entry.id ?? '(no id)', title: entry.title ?? '(no title)', domain });
      }
    }
  }

  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  const present = new Set(gitignore.split(/\r?\n/).map((l) => l.trim()));
  const missingGitignore = REQUIRED_GITIGNORE.filter((rule) => !present.has(rule));

  const hasIssues = leaks.length > 0 || missingGitignore.length > 0;
  const status: BoundaryReport['status'] =
    !fs.existsSync(memPath) && missingGitignore.length === 0 ? 'no-memory'
    : hasIssues ? 'leaks-found'
    : 'clean';

  return { status, leaks, missingGitignore, scannedEntries };
}

export function runCheckBoundariesAction(cwd: string, json = false): void {
  const report = computeBoundaryReport(cwd);
  if (json) {
    console.log(JSON.stringify({ action: 'check-boundaries', ...report }));
    const isCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
    if (report.status === 'leaks-found' && isCi) process.exit(1);
    return;
  }
  console.log(`  🔒 Boundary check: ${cwd}\n`);
  console.log(`  Scanned ${report.scannedEntries} memory entr${report.scannedEntries === 1 ? 'y' : 'ies'}.`);
  if (report.leaks.length) {
    console.log(`  ❌ ${report.leaks.length} non-project entr${report.leaks.length === 1 ? 'y' : 'ies'} found (boundary leak):`);
    for (const l of report.leaks) console.log(`     - [${l.domain}] ${l.title} (id: ${l.id})`);
  }
  if (report.missingGitignore.length) {
    console.log(`  ⚠️  Missing .gitignore rules: ${report.missingGitignore.join(', ')}`);
  }
  if (report.status === 'clean') console.log('  ✅ No boundary leaks.');
  console.log('');
  const isCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
  if (report.status === 'leaks-found' && isCi) process.exit(1);
}
