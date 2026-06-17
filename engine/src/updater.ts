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
  return compareSemver(published, toolVersion) > 0 ? published : toolVersion;
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
 * Migrates the MCP server runtime from `.ai-os/mcp-server/` to `.github/ai-os/mcp-server/`
 * (pre-v0.22.0 → v0.22.0+). Safe to call on every refresh — no-ops if already migrated.
 */
function migrateLegacyMcpServer(targetDir: string): void {
  const legacyMcpDir = path.join(targetDir, '.ai-os', 'mcp-server');
  const legacyMcpEntry = path.join(legacyMcpDir, 'index.js');
  if (!fs.existsSync(legacyMcpEntry)) return;

  const newMcpDir = path.join(targetDir, '.github', 'ai-os', 'mcp-server');
  try {
    fs.mkdirSync(newMcpDir, { recursive: true });
    // Copy runtime files to new location
    for (const file of fs.readdirSync(legacyMcpDir)) {
      fs.copyFileSync(path.join(legacyMcpDir, file), path.join(newMcpDir, file));
    }
    // Remove legacy directory
    fs.rmSync(legacyMcpDir, { recursive: true, force: true });
    // Remove .ai-os/ if now empty
    const legacyAiOsDir = path.join(targetDir, '.ai-os');
    if (fs.existsSync(legacyAiOsDir) && fs.readdirSync(legacyAiOsDir).length === 0) {
      fs.rmdirSync(legacyAiOsDir);
    }
    // Update .gitignore: replace old entry with new one
    const gitignorePath = path.join(targetDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const updated = content
        .replace(/^\.ai-os\/mcp-server\/node_modules\s*$/m, '.github/ai-os/mcp-server/')
        .replace(/^\.ai-os\/mcp-server\/\s*$/m, '.github/ai-os/mcp-server/');
      if (updated !== content) fs.writeFileSync(gitignorePath, updated, 'utf-8');
    }
    console.log('  🔀 Migrated .ai-os/mcp-server/ → .github/ai-os/mcp-server/ (v0.22.0 layout)');
  } catch {
    // best-effort — never throw from cleanup
  }
}

/**
 * Remove legacy `.ai-os/context/` artifacts left over from pre-v0.3.0 installations.
 * Also migrates `.ai-os/mcp-server/` to `.github/ai-os/mcp-server/` (pre-v0.22.0).
 * Safe to call on every refresh — exits silently if nothing to do.
 * Only removes files that were generated by AI OS (*.md, *.json); leaves anything else.
 */
export interface LegacyPruneOptions {
  /**
   * Full cleanup mode used by --clean-update.
   * Removes legacy .ai-os/config.json, .ai-os/tools.json, and legacy context/memory dirs.
   * Also migrates .ai-os/mcp-server/ to .github/ai-os/mcp-server/.
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
  // Legacy MCP configs from pre-v0.6.27 (now emitted as .mcp.json and .vscode/mcp.json)
  const legacyMcpJson = path.join(targetDir, '.github', 'copilot', 'mcp.json');
  const legacyMcpLocal = path.join(targetDir, '.github', 'copilot', 'mcp.local.json');

  // ── Migrate .ai-os/mcp-server/ → .github/ai-os/mcp-server/ (pre-v0.22.0) ──
  migrateLegacyMcpServer(targetDir);

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

      // Remove .ai-os if now empty
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

  // Always clean up legacy MCP configs on refresh (they moved to .mcp.json / .vscode/mcp.json)
  for (const file of [legacyMcpJson, legacyMcpLocal]) {
    if (fs.existsSync(file)) {
      try { fs.rmSync(file); } catch { /* best-effort */ }
    }
  }

  // Remove .github/package.json stale artifact (#256)
  const staleGithubPkg = path.join(targetDir, '.github', 'package.json');
  if (fs.existsSync(staleGithubPkg)) {
    try {
      fs.rmSync(staleGithubPkg);
      console.log('  🧹 Removed stale .github/package.json artifact');
    } catch { /* best-effort */ }
  }

  // Untrack .github/ai-os/mcp-server/index.js from git if previously committed (#251)
  // The file is a build artifact; it must exist on disk for the MCP server to run,
  // but it must NOT be committed to source control. `ensureGitignoreEntry` prevents
  // future tracking; this step untracks any copy already in the index.
  const mcpBundleRelPath = '.github/ai-os/mcp-server/index.js';
  const mcpBundleAbsPath = path.join(targetDir, '.github', 'ai-os', 'mcp-server', 'index.js');
  if (fs.existsSync(mcpBundleAbsPath)) {
    try {
      const isTracked = spawnSync('git', ['ls-files', '--error-unmatch', mcpBundleRelPath], {
        cwd: targetDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      if (isTracked.status === 0) {
        spawnSync('git', ['rm', '--cached', mcpBundleRelPath], {
          cwd: targetDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        console.log('  🧹 Untracked .github/ai-os/mcp-server/index.js from git (build artifact)');
      }
    } catch { /* best-effort */ }
  }

  // Remove stale !.github/superpowers/ gitignore exceptions (#250)
  const gitignorePathForCleanup = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePathForCleanup)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePathForCleanup, 'utf-8');
      const staleGitignoreEntries = new Set(['!.github/superpowers/', '!.github/superpowers/**']);
      const gitignoreLines = gitignoreContent.split(/\r?\n/);
      const filtered = gitignoreLines.filter(l => !staleGitignoreEntries.has(l.trim()));
      if (filtered.length !== gitignoreLines.length) {
        fs.writeFileSync(gitignorePathForCleanup, filtered.join('\n'), 'utf-8');
        console.log('  🧹 Removed stale !.github/superpowers/ entries from .gitignore');
      }
    } catch { /* best-effort */ }
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
