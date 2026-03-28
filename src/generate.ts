#!/usr/bin/env node
import path from 'node:path';
import { analyze } from './analyze.js';
import { generateInstructions } from './generators/instructions.js';
import { generateMcpJson } from './generators/mcp.js';
import { generateContextDocs } from './generators/context-docs.js';
import { generateAgents } from './generators/agents.js';
import { generateSkills, deployBundledSkills } from './generators/skills.js';
import { generatePrompts } from './generators/prompts.js';
import { checkUpdateStatus, printUpdateBanner } from './updater.js';

type GenerateMode = 'safe' | 'refresh-existing' | 'update';

function parseArgs(): { cwd: string; dryRun: boolean; mode: GenerateMode } {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let dryRun = false;
  let mode: GenerateMode = 'safe';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--cwd' && !args[i + 1]) {
      throw new Error('--cwd requires a path value');
    } else if (args[i]?.startsWith('--cwd=')) {
      cwd = path.resolve(args[i].slice('--cwd='.length));
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--refresh-existing') {
      mode = 'refresh-existing';
    } else if (args[i] === '--update') {
      mode = 'update';
    }
  }

  return { cwd, dryRun, mode };
}

function printBanner(): void {
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log('  ║          AI OS  v0.2.0            ║');
  console.log('  ║  Portable Copilot Context Engine  ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');
}

function printSummary(
  stack: ReturnType<typeof analyze>,
  outputDir: string,
  agents: string[],
  skills: string[],
  promptsAdded: number,
  bundledSkills: string[],
): void {
  const fw = stack.frameworks.map(f => f.name).join(', ') || stack.primaryLanguage.name;
  console.log(`  📦 Project:    ${stack.projectName}`);
  console.log(`  🔤 Language:   ${stack.primaryLanguage.name} (${stack.primaryLanguage.percentage}%)`);
  console.log(`  🏗️  Framework:  ${fw}`);
  console.log(`  📦 Pkg Mgr:   ${stack.patterns.packageManager}`);
  console.log(`  🔷 TypeScript: ${stack.patterns.hasTypeScript ? 'Yes' : 'No'}`);
  console.log('');
  console.log('  Generated files:');
  console.log(`  ✅ .github/copilot-instructions.md`);
  console.log(`  ✅ .github/copilot/mcp.json (${5 + 5} tools)`);
  console.log(`  ✅ .ai-os/context/ (stack, architecture, conventions, existing-ai-context, dependency-graph)`);

  if (agents.length > 0) {
    console.log(`  ✅ .github/agents/ → ${agents.length} new agent(s):`);
    for (const a of agents) console.log(`       • ${a}`);
  } else {
    console.log(`  ℹ️  .github/agents/ — all agents already exist, skipped`);
  }

  if (skills.length > 0) {
    console.log(`  ✅ .github/copilot/skills/ → ${skills.length} new skill(s):`);
    for (const s of skills) console.log(`       • ${s}`);
  } else {
    console.log(`  ℹ️  .github/copilot/skills/ — all skills already exist, skipped`);
  }

  if (promptsAdded > 0) {
    console.log(`  ✅ .github/copilot/prompts.json → +${promptsAdded} new prompt(s)`);
  } else {
    console.log(`  ℹ️  .github/copilot/prompts.json — all prompts already exist, skipped`);
  }

  if (bundledSkills.length > 0) {
    console.log(`  ✅ .agents/skills/ → ${bundledSkills.length} bundled skill(s) deployed:`);
    for (const s of bundledSkills) console.log(`       • ${s}`);
  } else {
    console.log(`  ℹ️  .agents/skills/skill-creator — already installed, skipped`);
  }

  console.log('');
  console.log('  🚀 AI OS installed! Open this repo in VS Code with GitHub Copilot enabled.');
  console.log(`  💡 Try @workspace, /new-page, /new-trpc-procedure, or any agent from Chat.`);
  console.log('');
}

async function main(): Promise<void> {
  printBanner();

  const { cwd, dryRun, mode: rawMode } = parseArgs();
  let mode: GenerateMode = rawMode;
  console.log(`  📂 Scanning: ${cwd}`);
  console.log(`  🔧 Mode: ${mode}`);
  console.log('');

  // Version check — notify if installed artifacts are older than this tool
  const updateStatus = checkUpdateStatus(cwd);
  if (mode === 'update') {
    if (updateStatus.isFirstInstall) {
      console.log('  ℹ️  No existing AI OS installation found. Running fresh install...');
    } else if (updateStatus.updateAvailable) {
      console.log(`  🔄 Updating from v${updateStatus.installedVersion ?? '?'} → v${updateStatus.toolVersion}`);
    } else {
      console.log(`  ✅ Already up-to-date (v${updateStatus.toolVersion}). Re-generating to refresh context...`);
    }
    mode = 'refresh-existing';
  } else if (!updateStatus.isFirstInstall) {
    printUpdateBanner(updateStatus);
  }

  const stack = analyze(cwd);

  if (dryRun) {
    console.log('  [DRY RUN] Detected stack:');
    console.log(JSON.stringify(stack, null, 2));
    return;
  }

  // Phase 1: Core context files
  generateContextDocs(stack, cwd);
  generateInstructions(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  generateMcpJson(stack, cwd, { refreshExisting: mode === 'refresh-existing' });

  // Phase 2: Agents, Skills, Prompts
  const agents = await generateAgents(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  const skills = await generateSkills(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  const promptsAdded = await generatePrompts(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  const bundledSkills = await deployBundledSkills(cwd, { refreshExisting: mode === 'refresh-existing' });

  printSummary(stack, cwd, agents, skills, promptsAdded, bundledSkills);
}

main().catch(err => {
  console.error('  ❌ Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
