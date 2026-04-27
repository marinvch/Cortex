/**
 * Codebase-aware bootstrap — one-command full-baseline setup.
 *
 * Given an already-analysed DetectedStack this module:
 *   1. Builds a BootstrapPlan describing every action to take (detection → action → reason)
 *   2. Applies the plan: installs stack-relevant agent skills via the skills CLI
 *      and records which MCP/VS Code items still need manual attention
 *
 * Dry-run mode returns the plan without performing any side effects.
 */

import { spawnSync } from 'node:child_process';
import type { DetectedStack } from './types.js';
import { collectRecommendations } from './recommendations/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type BootstrapItemCategory = 'skill' | 'mcp' | 'vscode' | 'copilot-extension';

export type BootstrapItemStatus =
  | 'pending'     // dry-run: would be applied
  | 'applied'     // successfully installed / configured
  | 'skipped'     // already installed / not applicable
  | 'failed';     // attempted but the skills CLI returned a non-zero exit code

export interface BootstrapPlanItem {
  category: BootstrapItemCategory;
  name: string;
  /** Why this item was selected (e.g. the dep/framework that triggered it) */
  reason: string;
  /** Optional install command for user reference */
  installCmd?: string;
  status: BootstrapItemStatus;
  /** Error message when status === 'failed' */
  error?: string;
}

export interface BootstrapReport {
  projectName: string;
  detectedLanguage: string;
  detectedFrameworks: string[];
  packageManager: string;
  hasTypeScript: boolean;
  dryRun: boolean;
  items: BootstrapPlanItem[];
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  pendingCount: number;
}

export interface BootstrapOptions {
  dryRun?: boolean;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function buildInstallCmd(skillName: string, source?: string): string {
  const spec = source ? `${source}@${skillName}` : `<source>@${skillName}`;
  return `npx -y skills add ${spec} -g -a github-copilot`;
}

/**
 * Attempt to install a single skill via the skills CLI.
 * Returns { success, error }.
 */
function installSkill(skillName: string, source?: string): { success: boolean; error?: string } {
  const args = ['skills', 'add'];
  if (source) {
    args.push(`${source}@${skillName}`);
  } else {
    // Unknown source — cannot auto-install; mark as skipped
    return { success: false, error: `No known source for skill "${skillName}" — cannot auto-install` };
  }
  args.push('-g', '-a', 'github-copilot', '-y');

  const result = spawnSync('npx', ['-y', ...args], {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  if (result.status === 0) return { success: true };

  const stderr = result.stderr?.trim() ?? '';
  const stdout = result.stdout?.trim() ?? '';
  const detail = [stderr, stdout].filter(Boolean).join(' | ');
  return {
    success: false,
    error: detail || `skills CLI exited with code ${result.status ?? 'unknown'}`,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the bootstrap plan for the given stack.
 * In dry-run mode all items have status 'pending'; no side effects.
 * In apply mode skill items are attempted via the skills CLI.
 */
export function runBootstrap(stack: DetectedStack, options: BootstrapOptions = {}): BootstrapReport {
  const { dryRun = false } = options;
  const recs = collectRecommendations(stack);

  const items: BootstrapPlanItem[] = [];

  // ── Skills (stack-specific + universal) ──────────────────────────────────
  const allSkills = [
    ...recs.skills.map(s => ({ ...s, universal: false })),
    ...recs.universalSkills.map(s => ({ ...s, universal: true })),
  ];

  for (const skill of allSkills) {
    const installCmd = buildInstallCmd(skill.name, skill.source);
    const item: BootstrapPlanItem = {
      category: 'skill',
      name: skill.name,
      reason: skill.universal ? 'universal — recommended for every project' : `triggered by: ${skill.trigger}`,
      installCmd,
      status: 'pending',
    };

    if (!dryRun) {
      if (!skill.source) {
        item.status = 'skipped';
        item.error = `No known source for skill "${skill.name}" — add manually using: ${installCmd}`;
      } else {
        const result = installSkill(skill.name, skill.source);
        if (result.success) {
          item.status = 'applied';
        } else {
          item.status = 'failed';
          item.error = result.error;
        }
      }
    }

    items.push(item);
  }

  // ── MCP servers (informational — already wired by generation step) ────────
  for (const mcp of recs.mcp) {
    items.push({
      category: 'mcp',
      name: mcp.package,
      reason: `triggered by: ${mcp.trigger} — ${mcp.description}`,
      installCmd: `# add under .mcp.json:mcpServers or .vscode/mcp.json:servers: "${mcp.package.replace('/', '-')}": { "type": "stdio", "command": "npx", "args": ["-y", "${mcp.package}"] }`,
      status: dryRun ? 'pending' : 'skipped', // MCP wiring is handled by the generation step
    });
  }

  // ── VS Code extensions (informational) ───────────────────────────────────
  for (const ext of recs.vscode) {
    items.push({
      category: 'vscode',
      name: ext.id,
      reason: `triggered by: ${ext.trigger}`,
      installCmd: `code --install-extension ${ext.id}`,
      status: dryRun ? 'pending' : 'skipped', // Must be installed manually
    });
  }

  // ── Copilot Extensions (informational) ───────────────────────────────────
  for (const ext of recs.copilotExtensions) {
    items.push({
      category: 'copilot-extension',
      name: ext.name,
      reason: `triggered by: ${ext.trigger}`,
      installCmd: ext.url,
      status: dryRun ? 'pending' : 'skipped',
    });
  }

  const appliedCount = items.filter(i => i.status === 'applied').length;
  const skippedCount = items.filter(i => i.status === 'skipped').length;
  const failedCount = items.filter(i => i.status === 'failed').length;
  const pendingCount = items.filter(i => i.status === 'pending').length;

  return {
    projectName: stack.projectName,
    detectedLanguage: stack.primaryLanguage.name,
    detectedFrameworks: stack.frameworks.map(f => f.name),
    packageManager: stack.patterns.packageManager,
    hasTypeScript: stack.patterns.hasTypeScript,
    dryRun,
    items,
    appliedCount,
    skippedCount,
    failedCount,
    pendingCount,
  };
}

// ── Report printer ────────────────────────────────────────────────────────────

/**
 * Format a BootstrapReport as a human-readable console output string.
 */
export function formatBootstrapReport(report: BootstrapReport): string {
  const lines: string[] = [];
  const title = report.dryRun
    ? `Bootstrap Plan (DRY RUN) — ${report.projectName}`
    : `Bootstrap Report — ${report.projectName}`;

  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n, ' ');

  lines.push('');
  lines.push(`  ╔${'═'.repeat(title.length + 4)}╗`);
  lines.push(`  ║  ${title}  ║`);
  lines.push(`  ╚${'═'.repeat(title.length + 4)}╝`);
  lines.push('');
  lines.push('  Detected Stack:');
  lines.push(`    Language:    ${report.detectedLanguage}`);
  lines.push(`    Frameworks:  ${report.detectedFrameworks.length > 0 ? report.detectedFrameworks.join(', ') : '(none)'}`);
  lines.push(`    Pkg Manager: ${report.packageManager}`);
  lines.push(`    TypeScript:  ${report.hasTypeScript ? 'Yes' : 'No'}`);
  lines.push('');

  if (report.items.length === 0) {
    lines.push('  No bootstrap actions for this stack.');
    lines.push('');
    return lines.join('\n');
  }

  const heading = report.dryRun ? '  Bootstrap Plan:' : '  Bootstrap Actions:';
  lines.push(heading);
  lines.push('');

  for (const item of report.items) {
    const icon =
      item.status === 'applied' ? '✅' :
      item.status === 'skipped' ? '📋' :
      item.status === 'failed'  ? '❌' :
      '🔲'; // pending (dry-run)

    const cat = pad(`[${item.category}]`, 20);
    const name = pad(item.name, 32);
    lines.push(`  ${icon} ${cat} ${name}  ← ${item.reason}`);
    if (item.installCmd && (item.status === 'skipped' || item.status === 'pending' || item.status === 'failed')) {
      lines.push(`       Install: ${item.installCmd}`);
    }
    if (item.error && item.status === 'failed') {
      lines.push(`       ⚠ Error: ${item.error}`);
    }
    if (item.error && item.status === 'skipped') {
      lines.push(`       ℹ ${item.error}`);
    }
  }

  lines.push('');

  if (report.dryRun) {
    lines.push(`  Summary: ${report.pendingCount} action(s) planned (dry-run — nothing applied)`);
    lines.push('');
    lines.push('  Run without --dry-run to apply:');
    lines.push('    npx -y "github:marinvch/ai-os" --bootstrap');
  } else {
    const parts: string[] = [];
    if (report.appliedCount > 0) parts.push(`${report.appliedCount} applied`);
    if (report.skippedCount > 0) parts.push(`${report.skippedCount} informational`);
    if (report.failedCount > 0) parts.push(`${report.failedCount} failed`);
    lines.push(`  Summary: ${parts.join(', ') || '0 actions'}`);
    if (report.skippedCount > 0) {
      lines.push('');
      lines.push('  📋 Informational items (manual action required):');
      lines.push('     - MCP servers: add to .mcp.json (Copilot CLI) or .vscode/mcp.json (VS Code/Copilot Chat)');
      lines.push('     - VS Code extensions: install via VS Code Marketplace or code --install-extension <id>');
      lines.push('     - Skills with unknown source: find the hosting repo and run the install command');
    }
  }

  lines.push('');
  return lines.join('\n');
}
