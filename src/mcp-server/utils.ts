/**
 * utils.ts — thin barrel for mcp-server sub-modules.
 *
 * Keeps getProjectRoot(), readAiOsFile(), getSessionContext(), and
 * checkForUpdates() as real implementations, then re-exports everything
 * from the focused sub-modules for backward compatibility.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLatestResolvableVersion } from '../updater.js';
import { ROOT, readAiOsFile as _readAiOsFile } from './shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getProjectRoot(): string {
  return path.resolve(ROOT);
}

export { _readAiOsFile as readAiOsFile };

export function getSessionContext(): string {
  const SESSION_BOOTSTRAP = [
    '',
    '---',
    '',
    '## Session Start Bootstrap',
    '',
    '**At the start of every session, run in order:**',
    '',
    '1. `get_session_context` ← you are here',
    '2. `get_repo_memory` — reload durable architectural decisions',
    '3. `get_conventions` — reload coding rules before writing any code',
    '',
    '**Before any non-trivial change:**',
    '',
    '- `get_project_structure` — explore unfamiliar directories',
    '- `get_file_summary` — understand a file without reading it fully',
    '- `get_impact_of_change` — assess blast radius before editing shared files',
    '- Use `/define` → `/plan` lifecycle prompts before writing code',
    '',
    '> If the request is ambiguous or underspecified, ask clarifying questions first.',
    '> Do not improvise requirements or make architectural changes without confirmation.',
  ].join('\n');

  const contextCardPath = path.join(ROOT, '.github', 'COPILOT_CONTEXT.md');
  if (fs.existsSync(contextCardPath)) {
    return fs.readFileSync(contextCardPath, 'utf-8') + SESSION_BOOTSTRAP;
  }
  // Fallback: build a minimal context from available files
  const lines: string[] = [
    '# Session Context',
    '',
    '> COPILOT_CONTEXT.md not found. Run AI OS generation to create it.',
    '',
    '## Quick Context',
    '',
  ];
  const conventions = _readAiOsFile('context/conventions.md');
  if (conventions) {
    const firstSection = conventions.split('\n##')[0];
    lines.push(firstSection.split('\n').slice(0, 15).join('\n'));
  }
  lines.push('');
  lines.push('Call `get_conventions` and `get_repo_memory` for full context.');
  return lines.join('\n') + SESSION_BOOTSTRAP;
}

export function checkForUpdates(): string {
  const newConfigPath = path.join(ROOT, '.github', 'ai-os', 'config.json');
  const legacyConfigPath = path.join(ROOT, '.ai-os', 'config.json');
  const configPath = fs.existsSync(newConfigPath) ? newConfigPath : legacyConfigPath;
  if (!fs.existsSync(configPath)) {
    return 'AI OS is not installed in this repository. Run the bootstrap installer: `curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash`';
  }

  let installedVersion = '0.0.0';
  let installedAt = 'unknown';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      version?: string;
      installedAt?: string;
    };
    installedVersion = config.version ?? '0.0.0';
    installedAt = config.installedAt ?? 'unknown';
  } catch {
    return 'Could not read .github/ai-os/config.json';
  }

  let toolVersion = '0.0.0';
  try {
    const toolPkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { version?: string };
    toolVersion = toolPkg.version ?? '0.0.0';
  } catch { /* tool package.json not found */ }

  const latestVersion = getLatestResolvableVersion(toolVersion);

  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(latestVersion);
  const [iMaj = 0, iMin = 0, iPat = 0] = parse(installedVersion);
  const updateAvailable =
    cMaj > iMaj ||
    (cMaj === iMaj && cMin > iMin) ||
    (cMaj === iMaj && cMin === iMin && cPat > iPat);

  if (updateAvailable) {
    return [
      `## AI OS Update Available`,
      ``,
      `- **Installed:** v${installedVersion} (generated ${installedAt})`,
      `- **Latest:**    v${latestVersion}`,
      ``,
      `Run the following to update all AI OS artifacts in-place:`,
      `\`\`\`bash`,
      `npx -y "github:marinvch/ai-os#v${latestVersion}" --refresh-existing`,
      `\`\`\``,
      `Or use the bootstrap one-liner: \`curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash\``,
      `This refreshes context docs, agents, skills, MCP tools, and the dependency graph without deleting your existing files.`,
    ].join('\n');
  }

  return `AI OS is up-to-date (v${installedVersion}). Last generated: ${installedAt}`;
}

// ── Re-exports from focused sub-modules (backward compatibility) ───────────────
export * from './memory.js';
export * from './session.js';
export * from './search.js';
export * from './project-introspection.js';
export * from './freshness-bridge.js';
export * from './recommendations-bridge.js';
