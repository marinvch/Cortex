import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  // Check new location first, then fall back to legacy .ai-os/ for migration compat
  const newConfigPath = path.join(targetDir, '.github', 'ai-os', 'config.json');
  const legacyConfigPath = path.join(targetDir, '.ai-os', 'config.json');
  const configPath = fs.existsSync(newConfigPath) ? newConfigPath : legacyConfigPath;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as InstalledConfig;
  } catch {
    return null;
  }
}

/** Compare semver strings — returns true if `candidate` is newer than `installed` */
function parseSemver(v: string): [number, number, number] {
  const [maj = 0, min = 0, pat = 0] = v.replace(/^v/, '').split('.').map(Number);
  return [maj, min, pat];
}

function compareSemver(a: string, b: string): number {
  const [aMaj = 0, aMin = 0, aPat = 0] = parseSemver(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parseSemver(b);

  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
  if (aMin !== bMin) return aMin > bMin ? 1 : -1;
  if (aPat !== bPat) return aPat > bPat ? 1 : -1;
  return 0;
}

/** Compare semver strings — returns true if `candidate` is newer than `installed` */
function isNewer(candidate: string, installed: string): boolean {
  const [cMaj = 0, cMin = 0, cPat = 0] = parseSemver(candidate);
  const [iMaj = 0, iMin = 0, iPat = 0] = parseSemver(installed);
  if (cMaj !== iMaj) return cMaj > iMaj;
  if (cMin !== iMin) return cMin > iMin;
  return cPat > iPat;
}

function getLatestPublishedTagVersion(): string | null {
  try {
    const result = spawnSync(
      'git',
      ['ls-remote', '--tags', '--refs', 'https://github.com/marinvch/ai-os.git', 'v*'],
      {
        encoding: 'utf-8',
        timeout: 5000,
      },
    );

    if (result.status !== 0 || !result.stdout) return null;

    const versions = result.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/refs\/tags\/v(\d+\.\d+\.\d+)$/);
        return match?.[1] ?? null;
      })
      .filter((v): v is string => v !== null);

    if (versions.length === 0) return null;

    return versions.reduce((latest, current) =>
      compareSemver(current, latest) > 0 ? current : latest,
    );
  } catch {
    return null;
  }
}

export function getLatestResolvableVersion(toolVersion: string): string {
  const published = getLatestPublishedTagVersion();
  if (!published) return toolVersion;
  return published;
}

export interface UpdateStatus {
  toolVersion: string;
  latestVersion: string;
  installedVersion: string | null;
  updateAvailable: boolean;
  isFirstInstall: boolean;
}

export function checkUpdateStatus(targetDir: string): UpdateStatus {
  const toolVersion = getToolVersion();
  const latestVersion = getLatestResolvableVersion(toolVersion);
  const config = readInstalledConfig(targetDir);

  if (!config) {
    return {
      toolVersion,
      latestVersion,
      installedVersion: null,
      updateAvailable: false,
      isFirstInstall: true,
    };
  }

  const installedVersion = config.version;
  return {
    toolVersion,
    latestVersion,
    installedVersion,
    updateAvailable: isNewer(latestVersion, installedVersion),
    isFirstInstall: false,
  };
}

export function printUpdateBanner(status: UpdateStatus): void {
  if (!status.updateAvailable) return;

  const updateCmd = `npx -y "github:marinvch/ai-os#v${status.latestVersion}" --refresh-existing`;

  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────┐');
  console.log(`  │  🔔 AI OS Update Available                          │`);
  console.log(`  │     Installed: v${status.installedVersion?.padEnd(10) ?? 'unknown   '}  →  Latest: v${status.latestVersion.padEnd(10)}│`);
  console.log(`  │                                                     │`);
  console.log(`  │  Re-run AI OS with --refresh-existing (or --update) │`);
  console.log(`  │  to refresh context, tools, agents, and MCP files.  │`);
  console.log('  └─────────────────────────────────────────────────────┘');
  console.log(`  ${updateCmd}`);
  console.log('');
}

/**
 * Remove legacy `.ai-os/context/` artifacts left over from pre-v0.3.0 installations.
 * Safe to call on every refresh — exits silently if the directory does not exist.
 * Only removes files that were generated by AI OS (*.md, *.json); leaves anything else.
 */
export interface LegacyPruneOptions {
  /**
   * Full cleanup mode used by --clean-update.
   * Removes legacy .ai-os/config.json, .ai-os/tools.json, and legacy context/memory dirs.
   * Keeps .ai-os/mcp-server runtime intact.
   */
  fullCleanup?: boolean;
}

export function pruneLegacyArtifacts(targetDir: string, options?: LegacyPruneOptions): void {
  const fullCleanup = options?.fullCleanup === true;
  const legacyContextDir = path.join(targetDir, '.ai-os', 'context');
  const legacyConfig = path.join(targetDir, '.ai-os', 'config.json');
  const legacyTools = path.join(targetDir, '.ai-os', 'tools.json');
  const legacyMemoryDir = path.join(targetDir, '.ai-os', 'memory');
  const legacyAiOsDir = path.join(targetDir, '.ai-os');
  // Legacy MCP configs from pre-v0.6.27 (now .vscode/mcp.json)
  const legacyMcpJson = path.join(targetDir, '.github', 'copilot', 'mcp.json');
  const legacyMcpLocal = path.join(targetDir, '.github', 'copilot', 'mcp.local.json');

  if (fullCleanup) {
    let removed = 0;
    try {
      for (const file of [legacyConfig, legacyTools, legacyMcpJson, legacyMcpLocal]) {
        if (fs.existsSync(file)) {
          fs.rmSync(file);
          removed += 1;
        }
      }

      for (const dir of [legacyContextDir, legacyMemoryDir]) {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          removed += 1;
        }
      }

      // Remove .ai-os only if now empty (keep mcp-server runtime if present)
      if (fs.existsSync(legacyAiOsDir) && fs.readdirSync(legacyAiOsDir).length === 0) {
        fs.rmdirSync(legacyAiOsDir);
      }
    } catch {
      // best-effort — never throw from cleanup
    }

    if (removed > 0) {
      console.log(`  🧹 Clean-update removed ${removed} legacy .ai-os artifact(s) (config/tools/context/memory)`);
    }
    return;
  }

  // Always clean up legacy MCP configs on refresh (they moved to .vscode/mcp.json)
  for (const file of [legacyMcpJson, legacyMcpLocal]) {
    if (fs.existsSync(file)) {
      try { fs.rmSync(file); } catch { /* best-effort */ }
    }
  }

  if (!fs.existsSync(legacyContextDir)) return;

  const MANAGED_EXTENSIONS = new Set(['.md', '.json']);
  let removed = 0;

  try {
    const entries = fs.readdirSync(legacyContextDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!MANAGED_EXTENSIONS.has(ext)) continue;
      try {
        fs.rmSync(path.join(legacyContextDir, entry.name));
        removed += 1;
      } catch {
        // best-effort
      }
    }

    // Remove directory if now empty
    const remaining = fs.readdirSync(legacyContextDir);
    if (remaining.length === 0) {
      fs.rmdirSync(legacyContextDir);
      // Also remove .ai-os/memory/ if empty and .ai-os/ if empty
      if (fs.existsSync(legacyMemoryDir) && fs.readdirSync(legacyMemoryDir).length === 0) {
        fs.rmdirSync(legacyMemoryDir);
      }
      if (fs.existsSync(legacyAiOsDir) && fs.readdirSync(legacyAiOsDir).length === 0) {
        fs.rmdirSync(legacyAiOsDir);
      }
    }
  } catch {
    // best-effort — never throw from cleanup
  }

  if (removed > 0) {
    console.log(`  🧹 Pruned ${removed} legacy .ai-os/context/ artifact(s) (pre-v0.3.0 migration)`);
  }
}
