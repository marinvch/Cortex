import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Read the ai-os tool's own version from its package.json */
export function getToolVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface InstalledConfig {
  version: string;
  installedAt: string;
  projectName: string;
  primaryLanguage: string;
  primaryFramework: string | null;
  frameworks: string[];
  packageManager: string;
  hasTypeScript: boolean;
}

/** Read the ai-os config installed in a target repo */
export function readInstalledConfig(targetDir: string): InstalledConfig | null {
  const configPath = path.join(targetDir, '.ai-os', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as InstalledConfig;
  } catch {
    return null;
  }
}

/** Compare semver strings — returns true if `candidate` is newer than `installed` */
function isNewer(candidate: string, installed: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(candidate);
  const [iMaj = 0, iMin = 0, iPat = 0] = parse(installed);
  if (cMaj !== iMaj) return cMaj > iMaj;
  if (cMin !== iMin) return cMin > iMin;
  return cPat > iPat;
}

export interface UpdateStatus {
  toolVersion: string;
  installedVersion: string | null;
  updateAvailable: boolean;
  isFirstInstall: boolean;
}

export function checkUpdateStatus(targetDir: string): UpdateStatus {
  const toolVersion = getToolVersion();
  const config = readInstalledConfig(targetDir);

  if (!config) {
    return { toolVersion, installedVersion: null, updateAvailable: false, isFirstInstall: true };
  }

  const installedVersion = config.version;
  return {
    toolVersion,
    installedVersion,
    updateAvailable: isNewer(toolVersion, installedVersion),
    isFirstInstall: false,
  };
}

export function printUpdateBanner(status: UpdateStatus): void {
  if (!status.updateAvailable) return;

  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────┐');
  console.log(`  │  🔔 AI OS Update Available                          │`);
  console.log(`  │     Installed: v${status.installedVersion?.padEnd(10) ?? 'unknown   '}  →  Latest: v${status.toolVersion.padEnd(10)}│`);
  console.log(`  │                                                     │`);
  console.log(`  │  Run:  npm run update  (or --update flag)           │`);
  console.log(`  │  to refresh all context, tools, and agent files.    │`);
  console.log('  └─────────────────────────────────────────────────────┘');
  console.log('');
}
