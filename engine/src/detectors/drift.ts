import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'node:crypto';
import { CONFIG_DIR } from '../brand.js';

function globFiles(pattern: { dir: string; ext: string }, cwd: string): string[] {
  const absDir = join(cwd, pattern.dir);
  if (!existsSync(absDir)) return [];
  try {
    return readdirSync(absDir)
      .filter(f => f.endsWith(pattern.ext))
      .map(f => `${pattern.dir}/${f}`);
  } catch {
    return [];
  }
}

export type DriftSeverity = 'error' | 'warning' | 'info';

export interface DriftItem {
  path: string;
  kind: 'missing' | 'stale' | 'unknown-file' | 'schema-mismatch' | 'semantic-mismatch';
  severity: DriftSeverity;
  message: string;
  fix?: string;
}

export interface DriftReport {
  scannedAt: string;
  totalIssues: number;
  errors: DriftItem[];
  warnings: DriftItem[];
  infos: DriftItem[];
  healthy: string[];
}

const REQUIRED_FILES: Array<{ path: string; description: string }> = [
  { path: 'AGENTS.md', description: 'Canonical cross-tool instructions (primary artifact)' },
  { path: '.github/COPILOT_CONTEXT.md', description: 'Session context card' },
  { path: `${CONFIG_DIR}/config.json`, description: 'Cortex configuration' },
];

const SNAPSHOT_MAX_AGE_DAYS = 7;
const FIX_CMD = 'npx -y github:marinvch/ai-os --refresh-existing';

/**
 * Check semantic consistency between config.json and generated files:
 * 1. primaryFramework in config.json should appear in copilot-instructions.md
 * 2. agents.json agent count should match actual .agent.md file count
 */
function detectSemanticDrift(cwd: string, warnings: DriftItem[]): void {
  const configPath = join(cwd, CONFIG_DIR, 'config.json');
  // Prefer AGENTS.md as the canonical reference; fall back to copilot-instructions.md
  const agentsMdPath = join(cwd, 'AGENTS.md');
  const instrPath = join(cwd, '.github/copilot-instructions.md');
  const primaryPath = existsSync(agentsMdPath) ? agentsMdPath : instrPath;
  const primaryRel = existsSync(agentsMdPath) ? 'AGENTS.md' : '.github/copilot-instructions.md';

  if (existsSync(configPath) && existsSync(primaryPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        primaryFramework?: string;
        primaryLanguage?: string;
      };
      const instrContent = readFileSync(primaryPath, 'utf8');

      if (config.primaryFramework) {
        const fw = config.primaryFramework;
        if (!instrContent.toLowerCase().includes(fw.toLowerCase())) {
          warnings.push({
            path: primaryRel,
            kind: 'semantic-mismatch',
            severity: 'warning',
            message: `Primary framework "${fw}" from config.json is not mentioned in ${primaryRel} — instructions may be stale`,
            fix: FIX_CMD,
          });
        }
      }
    } catch { /* non-fatal */ }
  }

  // Check agent count via existing-ai-context.md instead of agents.json (#231)
  const existingContextPath = join(cwd, CONFIG_DIR, 'context/existing-ai-context.md');
  if (existsSync(existingContextPath)) {
    try {
      const contextContent = readFileSync(existingContextPath, 'utf8');
      const agentCountMatch = contextContent.match(/"agents"\s*:\s*(\d+)/);
      const recordedCount = agentCountMatch ? parseInt(agentCountMatch[1], 10) : null;
      const agentFiles = globFiles({ dir: '.github/agents', ext: '.agent.md' }, cwd);
      const fileCount = agentFiles.length;

      if (recordedCount !== null && recordedCount !== fileCount) {
        warnings.push({
          path: `${CONFIG_DIR}/context/existing-ai-context.md`,
          kind: 'semantic-mismatch',
          severity: 'warning',
          message: `existing-ai-context.md records ${recordedCount} agent(s) but ${fileCount} .agent.md file(s) found in .github/agents/ — run refresh to sync`,
          fix: FIX_CMD,
        });
      }

      // Check Mermaid diagram vs config.json for language/framework consistency (#244)
      if (existsSync(configPath)) {
        try {
          const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
            primaryFramework?: string;
            primaryLanguage?: string;
          };
          // Extract Mermaid block from the file
          const mermaidMatch = contextContent.match(/```mermaid([\s\S]*?)```/);
          if (mermaidMatch) {
            const mermaidBlock = mermaidMatch[1];
            // Check that config.json primaryFramework appears in the Mermaid Fw node
            if (config.primaryFramework) {
              const fwLabelMatch = mermaidBlock.match(/Fw\["([^"]+)"\]/);
              if (fwLabelMatch && !fwLabelMatch[1].toLowerCase().includes(config.primaryFramework.toLowerCase())) {
                warnings.push({
                  path: `${CONFIG_DIR}/context/existing-ai-context.md`,
                  kind: 'semantic-mismatch',
                  severity: 'warning',
                  message: `Mermaid diagram Fw label "${fwLabelMatch[1]}" does not include primary framework "${config.primaryFramework}" from config.json — diagram may be stale`,
                  fix: FIX_CMD,
                });
              }
            }
            // Check that config.json primaryLanguage appears in the Mermaid Lang node
            if (config.primaryLanguage) {
              const langLabelMatch = mermaidBlock.match(/Lang\["([^"]+)"\]/);
              if (langLabelMatch && !langLabelMatch[1].toLowerCase().includes(config.primaryLanguage.toLowerCase())) {
                warnings.push({
                  path: `${CONFIG_DIR}/context/existing-ai-context.md`,
                  kind: 'semantic-mismatch',
                  severity: 'warning',
                  message: `Mermaid diagram Lang label "${langLabelMatch[1]}" does not include primary language "${config.primaryLanguage}" from config.json — diagram may be stale`,
                  fix: FIX_CMD,
                });
              }
            }
          }
        } catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
  }
}

export function detectDrift(cwd: string): DriftReport {
  const errors: DriftItem[] = [];
  const warnings: DriftItem[] = [];
  const infos: DriftItem[] = [];
  const healthy: string[] = [];

  // 1. Required files
  for (const { path, description } of REQUIRED_FILES) {
    if (!existsSync(join(cwd, path))) {
      errors.push({ path, kind: 'missing', severity: 'error', message: `${description} is missing`, fix: FIX_CMD });
    } else {
      healthy.push(path);
    }
  }

  // 2. MCP config — either .mcp.json or .vscode/mcp.json required
  const mcpPaths = ['.mcp.json', '.vscode/mcp.json'];
  const presentMcpPaths = mcpPaths.filter(p => existsSync(join(cwd, p)));
  if (presentMcpPaths.length === 0) {
    errors.push({
      path: '.vscode/mcp.json',
      kind: 'missing',
      severity: 'error',
      message: 'MCP configuration is missing — Copilot agent tools will not load',
      fix: FIX_CMD,
    });
  } else {
    for (const p of presentMcpPaths) {
      try {
        const cfg = JSON.parse(readFileSync(join(cwd, p), 'utf8')) as Record<string, unknown>;
        const servers = (cfg['mcpServers'] ?? cfg['servers'] ?? {}) as Record<string, { args?: string[] }>;
        let serverPathBroken = false;
        for (const [name, def] of Object.entries(servers)) {
          const serverPath = (def.args ?? []).find(a => a.endsWith('.js'));
          if (serverPath) {
            const resolved = serverPath.replace('${workspaceFolder}', cwd);
            if (!existsSync(resolved)) {
              warnings.push({
                path: p,
                kind: 'stale',
                severity: 'warning',
                message: `MCP server "${name}" references non-existent path: ${serverPath}`,
                fix: FIX_CMD,
              });
              serverPathBroken = true;
            }
          }
        }
        if (!serverPathBroken) healthy.push(p);
      } catch {
        errors.push({ path: p, kind: 'schema-mismatch', severity: 'error', message: `${p} is not valid JSON` });
      }
    }
  }

  // 3. Unreplaced template placeholders in AGENTS.md (canonical primary)
  const agentsMdPath = join(cwd, 'AGENTS.md');
  if (existsSync(agentsMdPath)) {
    const agentsMdContent = readFileSync(agentsMdPath, 'utf8');
    const placeholders = agentsMdContent.match(/\{\{[A-Z_]+\}\}/g);
    if (placeholders) {
      errors.push({
        path: 'AGENTS.md',
        kind: 'schema-mismatch',
        severity: 'error',
        message: `Contains unreplaced template placeholders: ${[...new Set(placeholders)].join(', ')}`,
        fix: FIX_CMD,
      });
    }
  }

  // 3b. copilot-instructions.md — adapter view check (warning if missing when AGENTS.md present)
  const instrPath = join(cwd, '.github/copilot-instructions.md');
  if (existsSync(agentsMdPath) && !existsSync(instrPath)) {
    // AGENTS.md exists (healthy) but copilot adapter file is absent — warn, not error
    warnings.push({
      path: '.github/copilot-instructions.md',
      kind: 'missing',
      severity: 'warning',
      message: 'Copilot adapter file is missing — run refresh to regenerate it',
      fix: FIX_CMD,
    });
  } else if (existsSync(instrPath)) {
    // Check for unreplaced placeholders in the copilot adapter file
    const instrContent = readFileSync(instrPath, 'utf8');
    const instrPlaceholders = instrContent.match(/\{\{[A-Z_]+\}\}/g);
    if (instrPlaceholders) {
      errors.push({
        path: '.github/copilot-instructions.md',
        kind: 'schema-mismatch',
        severity: 'error',
        message: `Contains unreplaced template placeholders: ${[...new Set(instrPlaceholders)].join(', ')}`,
        fix: FIX_CMD,
      });
    } else {
      // Copilot adapter file exists and is valid — mark healthy
      healthy.push('.github/copilot-instructions.md');
    }
  }

  // 4. Context snapshot age
  const snapshotPath = `${CONFIG_DIR}/context-snapshot.json`;
  const snapshotAbs = join(cwd, snapshotPath);
  if (existsSync(snapshotAbs)) {
    try {
      const snap = JSON.parse(readFileSync(snapshotAbs, 'utf8')) as { generatedAt?: string };
      const generatedAt = snap.generatedAt ? new Date(snap.generatedAt) : null;
      if (generatedAt) {
        const ageDays = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > SNAPSHOT_MAX_AGE_DAYS) {
          warnings.push({
            path: snapshotPath,
            kind: 'stale',
            severity: 'warning',
            message: `Context snapshot is ${Math.floor(ageDays)} days old (threshold: ${SNAPSHOT_MAX_AGE_DAYS} days)`,
            fix: FIX_CMD,
          });
        } else {
          healthy.push(snapshotPath);
        }
      }
    } catch {
      warnings.push({ path: snapshotPath, kind: 'schema-mismatch', severity: 'warning', message: 'context-snapshot.json is not valid JSON' });
    }
  }

  // 5. Agent files — check for required sections
  const agentFiles = globFiles({ dir: '.github/agents', ext: '.agent.md' }, cwd);
  for (const agentFile of agentFiles) {
    const content = readFileSync(join(cwd, agentFile), 'utf8');
    const missingSections: string[] = [];
    if (!content.includes('## Goal') && !content.includes('# Goal')) missingSections.push('Goal');
    if (!content.includes('## Constraints') && !content.includes('# Constraints')) missingSections.push('Constraints');
    if (missingSections.length > 0) {
      infos.push({
        path: agentFile,
        kind: 'schema-mismatch',
        severity: 'info',
        message: `Agent file missing recommended sections: ${missingSections.join(', ')}`,
        fix: FIX_CMD,
      });
    } else {
      healthy.push(agentFile);
    }
  }

  // 6. Skills in instructions vs installed — check canonical path first, then legacy (#237)
  const skillsDirNew = join(cwd, '.github', 'skills');
  const skillsDirLegacy = join(cwd, '.github', 'copilot', 'skills');
  const skillsDir = existsSync(skillsDirNew) ? skillsDirNew : skillsDirLegacy;
  const installedSkills = existsSync(skillsDir)
    ? readdirSync(skillsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace(/\.md$/, ''))
    : [];

  // Check skills listing in AGENTS.md (primary) or copilot-instructions.md (adapter fallback)
  const skillCheckPath = existsSync(join(cwd, 'AGENTS.md')) ? join(cwd, 'AGENTS.md') : instrPath;
  const skillCheckRel = existsSync(join(cwd, 'AGENTS.md')) ? 'AGENTS.md' : '.github/copilot-instructions.md';
  if (installedSkills.length > 0 && existsSync(skillCheckPath)) {
    const instrContent = readFileSync(skillCheckPath, 'utf8');
    for (const skill of installedSkills) {
      if (!instrContent.includes(skill)) {
        warnings.push({
          path: skillCheckRel,
          kind: 'stale',
          severity: 'warning',
          message: `Installed skill "${skill}" is not listed in ${skillCheckRel}`,
          fix: FIX_CMD,
        });
      }
    }
  }

  // 7. Skill version integrity — compare hashes stored in config.json with live files
  const configPath = join(cwd, CONFIG_DIR, 'config.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as { skillVersions?: Record<string, string> };
      if (cfg.skillVersions && Object.keys(cfg.skillVersions).length > 0) {
        // Resolve skills dir: canonical path first, then legacy
        const svDirNew = join(cwd, '.github', 'skills');
        const svDirLegacy = join(cwd, '.github', 'copilot', 'skills');
        const svDir = existsSync(svDirNew) ? svDirNew : svDirLegacy;
        const svDirRel = existsSync(svDirNew) ? '.github/skills' : '.github/copilot/skills';
        for (const [skillName, expectedHash] of Object.entries(cfg.skillVersions)) {
          const skillFilePath = join(svDir, `${skillName}.md`);
          if (!existsSync(skillFilePath)) {
            warnings.push({
              path: `${svDirRel}/${skillName}.md`,
              kind: 'missing',
              severity: 'warning',
              message: `Tracked skill "${skillName}" is missing from ${svDirRel}/`,
              fix: FIX_CMD,
            });
          } else {
            const content = readFileSync(skillFilePath, 'utf8');
            const actualHash = createHash('sha256').update(content).digest('hex').slice(0, 12);
            if (actualHash !== expectedHash) {
              warnings.push({
                path: `${svDirRel}/${skillName}.md`,
                kind: 'stale',
                severity: 'warning',
                message: `Skill "${skillName}" content has changed since last generation (hash mismatch)`,
                fix: FIX_CMD,
              });
            } else {
              healthy.push(`${svDirRel}/${skillName}.md`);
            }
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  // 8. Semantic drift: config vs instructions content consistency
  detectSemanticDrift(cwd, warnings);

  const totalIssues = errors.length + warnings.length + infos.length;
  return {
    scannedAt: new Date().toISOString(),
    totalIssues,
    errors,
    warnings,
    infos,
    healthy: [...new Set(healthy)],
  };
}

export function formatDriftReport(report: DriftReport, verbose = false): string {
  const lines: string[] = [
    `## Cortex Drift Report — ${new Date(report.scannedAt).toLocaleString()}`,
    '',
  ];

  if (report.totalIssues === 0) {
    lines.push('✅ All Cortex artifacts are healthy — no drift detected.');
    if (verbose && report.healthy.length > 0) {
      lines.push('');
      lines.push(`Healthy files (${report.healthy.length}):`);
      for (const h of report.healthy) lines.push(`  - \`${h}\``);
    }
    return lines.join('\n');
  }

  lines.push(`Found **${report.totalIssues}** issue(s):`);
  lines.push('');

  if (report.errors.length > 0) {
    lines.push(`### ❌ Errors (${report.errors.length})`);
    for (const item of report.errors) {
      lines.push(`- \`${item.path}\`: ${item.message}`);
      if (item.fix) lines.push(`  Fix: \`${item.fix}\``);
    }
    lines.push('');
  }

  if (report.warnings.length > 0) {
    const semanticWarnings = report.warnings.filter(w => w.kind === 'semantic-mismatch');
    const otherWarnings = report.warnings.filter(w => w.kind !== 'semantic-mismatch');

    if (otherWarnings.length > 0) {
      lines.push(`### ⚠️ Warnings (${otherWarnings.length})`);
      for (const item of otherWarnings) {
        lines.push(`- \`${item.path}\`: ${item.message}`);
        if (item.fix) lines.push(`  Fix: \`${item.fix}\``);
      }
      lines.push('');
    }

    if (semanticWarnings.length > 0) {
      lines.push(`### 🔀 Semantic Drift (${semanticWarnings.length})`);
      for (const item of semanticWarnings) {
        lines.push(`- \`${item.path}\`: ${item.message}`);
        if (item.fix) lines.push(`  Fix: \`${item.fix}\``);
      }
      lines.push('');
    }
  }

  if (report.infos.length > 0) {
    lines.push(`### ℹ️ Info (${report.infos.length})`);
    for (const item of report.infos) {
      lines.push(`- \`${item.path}\`: ${item.message}`);
    }
    lines.push('');
  }

  if (verbose && report.healthy.length > 0) {
    lines.push(`### ✅ Healthy (${report.healthy.length})`);
    for (const h of report.healthy) lines.push(`- \`${h}\``);
  }

  return lines.join('\n');
}
