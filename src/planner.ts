import fs from 'node:fs';
import path from 'node:path';

export type PlannedActionType = 'create' | 'update' | 'merge' | 'skip';

export interface PlannedAction {
  path: string;
  action: PlannedActionType;
  reason: string;
  risk: 'low' | 'medium' | 'high';
}

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

function decideAction(
  targetDir: string,
  relPath: string,
  mode: 'safe' | 'refresh-existing' | 'update',
  behavior: 'always-overwrite' | 'safe-merge',
): PlannedAction {
  const alreadyExists = exists(targetDir, relPath);

  if (!alreadyExists) {
    return { path: relPath, action: 'create', reason: 'File does not exist yet', risk: 'low' };
  }

  if (behavior === 'always-overwrite') {
    return {
      path: relPath,
      action: 'update',
      reason: 'Generator rewrites this artifact each run (instructions are backed up to .bak)',
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
): OnboardingPlan {
  const actions: PlannedAction[] = [];

  // Core artifacts
  actions.push(decideAction(targetDir, '.github/copilot-instructions.md', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/instructions/ai-os.instructions.md', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/copilot/mcp.json', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/ai-os/tools.json', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.ai-os/mcp-server/runtime-manifest.json', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/ai-os/context/stack.md', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/ai-os/context/architecture.md', mode, 'safe-merge'));
  actions.push(decideAction(targetDir, '.github/ai-os/context/conventions.md', mode, 'safe-merge'));
  actions.push(decideAction(targetDir, '.github/ai-os/context/memory.md', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/ai-os/context/existing-ai-context.md', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/ai-os/context/dependency-graph.json', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/ai-os/config.json', mode, 'always-overwrite'));
  actions.push(decideAction(targetDir, '.github/ai-os/memory/README.md', mode, 'safe-merge'));
  actions.push(decideAction(targetDir, '.github/ai-os/memory/memory.jsonl', mode, 'safe-merge'));

  // Generated collections
  actions.push(decideAction(targetDir, '.github/agents/', mode, 'safe-merge'));
  actions.push(decideAction(targetDir, '.github/copilot/skills/', mode, 'safe-merge'));
  actions.push(decideAction(targetDir, '.github/copilot/prompts.json', mode, 'safe-merge'));
  actions.push(decideAction(targetDir, '.agents/skills/skill-creator/', mode, 'safe-merge'));

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
      acc[action.action] += 1;
      return acc;
    },
    { create: 0, update: 0, merge: 0, skip: 0 },
  );

  const lines: string[] = [];
  lines.push('');
  lines.push('  🧭 Onboarding Plan');
  lines.push(`  📂 Target: ${plan.targetDir}`);
  lines.push(`  🧩 Repo type: ${plan.detectedRepoType}`);
  lines.push(`  🔧 Mode: ${plan.mode}`);
  lines.push(`  📊 Actions: create=${counts.create}, update=${counts.update}, merge=${counts.merge}, skip=${counts.skip}`);
  lines.push('');

  for (const action of plan.actions) {
    lines.push(`  - [${action.action}] ${action.path} (${action.risk} risk) — ${action.reason}`);
  }

  lines.push('');
  lines.push('  ✅ Use --apply to execute this plan.');
  lines.push('');
  return lines.join('\n');
}
