import fs from 'node:fs';
import path from 'node:path';

export type PlannedActionType = 'create' | 'update' | 'merge' | 'skip' | 'preserve';

export interface PlannedAction {
  path: string;
  action: PlannedActionType;
  reason: string;
  risk: 'low' | 'medium' | 'high';
}

/** Classification of a managed file for safe-refresh decision-making. */
export type FileCategory = 'tooling' | 'context' | 'custom-artifact';

export interface OnboardingPlan {
  targetDir: string;
  detectedRepoType: 'new' | 'existing-ai-os' | 'existing-non-ai-os';
  mode: 'safe' | 'refresh-existing' | 'update';
  actions: PlannedAction[];
}

function exists(root: string, relPath: string): boolean {
  return fs.existsSync(path.join(root, relPath));
}

function detectRepoType(targetDir: string): OnboardingPlan['detectedRepoType'] {
  if (exists(targetDir, '.github/ai-os/config.json') || exists(targetDir, '.ai-os/config.json')) return 'existing-ai-os';
  if (exists(targetDir, '.github/copilot-instructions.md') || exists(targetDir, '.github/copilot/prompts.json')) {
    return 'existing-non-ai-os';
  }
  return 'new';
}

/**
 * Curated context files that are preserved by default in safe refresh mode.
 * Pass --regenerate-context to allow full rewrite of these files.
 */
const CONTEXT_FILE_PATHS = new Set([
  '.github/copilot-instructions.md',
  '.github/ai-os/context/architecture.md',
  '.github/ai-os/context/conventions.md',
]);

function decideAction(
  targetDir: string,
  relPath: string,
  mode: 'safe' | 'refresh-existing' | 'update',
  behavior: 'always-overwrite' | 'safe-merge',
  preserveContextFiles: boolean,
): PlannedAction {
  const alreadyExists = exists(targetDir, relPath);

  if (!alreadyExists) {
    return { path: relPath, action: 'create', reason: 'File does not exist yet', risk: 'low' };
  }

  // In safe refresh mode, curated context files are preserved to avoid downgrading
  // manually maintained content to generic defaults.
  if (preserveContextFiles && CONTEXT_FILE_PATHS.has(relPath)) {
    return {
      path: relPath,
      action: 'preserve',
      reason: 'Safe refresh: curated file preserved (pass --regenerate-context to allow rewrite)',
      risk: 'low',
    };
  }

  if (behavior === 'always-overwrite') {
    return {
      path: relPath,
      action: 'update',
      reason: 'Generator rewrites this artifact each run (write-if-changed prevents no-op diffs)',
      risk: relPath.includes('copilot-instructions.md') ? 'medium' : 'low',
    };
  }

  if (mode === 'refresh-existing' || mode === 'update') {
    return {
      path: relPath,
      action: 'update',
      reason: 'Refresh mode updates existing generated artifacts in place',
      risk: 'low',
    };
  }

  return {
    path: relPath,
    action: 'merge',
    reason: 'Safe mode only appends/keeps existing content where possible',
    risk: 'low',
  };
}

export function buildOnboardingPlan(
  targetDir: string,
  mode: 'safe' | 'refresh-existing' | 'update',
  opts: { regenerateContext?: boolean } = {},
): OnboardingPlan {
  const preserveContextFiles = (mode === 'refresh-existing') && !(opts.regenerateContext ?? false);
  const actions: PlannedAction[] = [];

  // Core artifacts
  actions.push(decideAction(targetDir, '.github/copilot-instructions.md', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/instructions/ai-os.instructions.md', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.mcp.json', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.vscode/mcp.json', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/tools.json', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.ai-os/mcp-server/runtime-manifest.json', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/context/stack.md', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/context/architecture.md', mode, 'safe-merge', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/context/conventions.md', mode, 'safe-merge', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/context/memory.md', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/context/existing-ai-context.md', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/context/dependency-graph.json', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/config.json', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/manifest.json', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/memory/README.md', mode, 'safe-merge', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/memory/memory.jsonl', mode, 'safe-merge', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/COPILOT_CONTEXT.md', mode, 'always-overwrite', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/ai-os/recommendations.md', mode, 'always-overwrite', preserveContextFiles));

  // Generated collections
  actions.push(decideAction(targetDir, '.github/agents/', mode, 'safe-merge', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/copilot/skills/', mode, 'safe-merge', preserveContextFiles));
  actions.push(decideAction(targetDir, '.github/copilot/prompts.json', mode, 'safe-merge', preserveContextFiles));
  actions.push(decideAction(targetDir, '.agents/skills/skill-creator/', mode, 'safe-merge', preserveContextFiles));

  return {
    targetDir,
    detectedRepoType: detectRepoType(targetDir),
    mode,
    actions,
  };
}

export function formatOnboardingPlan(plan: OnboardingPlan): string {
  const counts = plan.actions.reduce(
    (acc, action) => {
      acc[action.action] = (acc[action.action] ?? 0) + 1;
      return acc;
    },
    { create: 0, update: 0, merge: 0, skip: 0, preserve: 0 } as Record<PlannedActionType, number>,
  );

  const lines: string[] = [];
  lines.push('');
  lines.push('  🧭 Onboarding Plan');
  lines.push(`  📂 Target: ${plan.targetDir}`);
  lines.push(`  🧩 Repo type: ${plan.detectedRepoType}`);
  lines.push(`  🔧 Mode: ${plan.mode}`);
  lines.push(`  📊 Actions: create=${counts.create}, update=${counts.update}, merge=${counts.merge}, preserve=${counts.preserve}, skip=${counts.skip}`);
  lines.push('');

  for (const action of plan.actions) {
    const icon = action.action === 'preserve' ? '🔒' : '·';
    lines.push(`  ${icon} [${action.action}] ${action.path} (${action.risk} risk) — ${action.reason}`);
  }

  lines.push('');
  lines.push('  ✅ Use --apply to execute this plan.');
  lines.push('');
  return lines.join('\n');
}
