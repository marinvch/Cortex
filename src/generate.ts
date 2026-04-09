#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from './analyze.js';
import { generateInstructions } from './generators/instructions.js';
import { generateMcpJson } from './generators/mcp.js';
import { generateContextDocs } from './generators/context-docs.js';
import { generateAgents } from './generators/agents.js';
import { generateSkills, deployBundledSkills } from './generators/skills.js';
import { generatePrompts } from './generators/prompts.js';
import { getMcpToolsForStack } from './mcp-tools.js';
import { checkUpdateStatus, printUpdateBanner, getToolVersion } from './updater.js';
import { buildOnboardingPlan, formatOnboardingPlan } from './planner.js';
import { readManifest, writeManifest, getManifestPath } from './generators/utils.js';

type GenerateMode = 'safe' | 'refresh-existing' | 'update';
type GenerateAction = 'apply' | 'plan' | 'preview';

function parseArgs(): { cwd: string; dryRun: boolean; mode: GenerateMode; action: GenerateAction; prune: boolean } {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let dryRun = false;
  let mode: GenerateMode = 'safe';
  let action: GenerateAction = 'apply';
  let prune = false;

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
    } else if (args[i] === '--plan') {
      action = 'plan';
    } else if (args[i] === '--preview') {
      action = 'preview';
    } else if (args[i] === '--apply') {
      action = 'apply';
    } else if (args[i] === '--prune') {
      prune = true;
    }
  }

  return { cwd, dryRun, mode, action, prune };
}

function printBanner(): void {
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log('  ║          AI OS  v0.3.0            ║');
  console.log('  ║  Portable Copilot Context Engine  ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');
}

function printSummary(
  stack: ReturnType<typeof analyze>,
  outputDir: string,
  written: string[],
  skipped: string[],
  pruned: string[],
  agents: string[],
): void {
  const mcpToolCount = getMcpToolsForStack(stack).length;
  const fw = stack.frameworks.map(f => f.name).join(', ') || stack.primaryLanguage.name;
  console.log(`  📦 Project:    ${stack.projectName}`);
  console.log(`  🔤 Language:   ${stack.primaryLanguage.name} (${stack.primaryLanguage.percentage}%)`);
  console.log(`  🏗️  Framework:  ${fw}`);
  console.log(`  📦 Pkg Mgr:   ${stack.patterns.packageManager}`);
  console.log(`  🔷 TypeScript: ${stack.patterns.hasTypeScript ? 'Yes' : 'No'}`);
  console.log('');
  console.log('  Diff summary:');
  console.log(`  ✅ Written (new or changed):  ${written.length}`);
  console.log(`  ⏭️  Unchanged (skipped):        ${skipped.length}`);
  if (pruned.length > 0) {
    console.log(`  🗑️  Pruned (stale):              ${pruned.length}`);
    for (const p of pruned) console.log(`       • ${path.relative(outputDir, p).replace(/\\/g, '/')}`);
  }
  if (agents.length > 0) {
    console.log(`  🤖 Agents generated: ${agents.length}`);
  }
  console.log(`  🔧 MCP tools registered: ${mcpToolCount}`);
  console.log(`  🗳️  Manifest: ${path.relative(outputDir, getManifestPath(outputDir)).replace(/\\/g, '/')}`);
  console.log('');
  console.log('  🚀 AI OS installed! Open this repo in VS Code with GitHub Copilot enabled.');
  console.log(`  💡 Try @workspace, /new-page, /new-trpc-procedure, or any agent from Chat.`);
  console.log('');
}

async function main(): Promise<void> {
  printBanner();

  const { cwd, dryRun, mode: rawMode, action, prune: pruneFlag } = parseArgs();
  let mode: GenerateMode = rawMode;
  console.log(`  📂 Scanning: ${cwd}`);
  console.log(`  🔧 Mode: ${mode}`);
  console.log(`  ▶️  Action: ${action}`);
  console.log('');

  // Version check — notify if installed artifacts are older than this tool
  const updateStatus = checkUpdateStatus(cwd);
  const installedVersionLabel = updateStatus.installedVersion ?? 'none';
  console.log(`  🩺 Diagnostics: tool=v${updateStatus.toolVersion}, installed=v${installedVersionLabel}, firstInstall=${updateStatus.isFirstInstall ? 'yes' : 'no'}, updateAvailable=${updateStatus.updateAvailable ? 'yes' : 'no'}`);

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
  const onboardingPlan = buildOnboardingPlan(cwd, mode);

  if (action === 'plan') {
    console.log(formatOnboardingPlan(onboardingPlan));
    return;
  }

  if (action === 'preview') {
    console.log(formatOnboardingPlan(onboardingPlan));
    console.log('  🔍 Preview only: no files were written. Run with --apply to execute.');
    console.log('');
    return;
  }

  if (dryRun) {
    console.log('  [DRY RUN] Detected stack:');
    console.log(JSON.stringify(stack, null, 2));
    return;
  }

  // Read previous manifest to allow pruning stale files (#7 / #8).
  const previousManifest = readManifest(cwd);
  const previousFiles = new Set(previousManifest?.files ?? []);

  // Phase 1: Core context files
  const contextFiles = generateContextDocs(stack, cwd);
  const instructionFiles = generateInstructions(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  const mcpFiles = generateMcpJson(stack, cwd, { refreshExisting: mode === 'refresh-existing' });

  // Phase 2: Agents, Skills, Prompts
  const agentFiles = await generateAgents(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  const skillFiles = await generateSkills(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  const promptFiles = await generatePrompts(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  await deployBundledSkills(cwd, { refreshExisting: mode === 'refresh-existing' });

  // Collect all managed absolute paths and convert to repo-relative forward-slash keys.
  const allManagedAbs = [
    ...contextFiles,
    ...instructionFiles,
    ...mcpFiles,
    ...agentFiles,
    ...skillFiles,
    ...promptFiles,
  ];
  const toRel = (p: string) => path.relative(cwd, p).replace(/\\/g, '/');
  const currentRelFiles = allManagedAbs.map(toRel);

  // Also track the manifest itself.
  const manifestRel = toRel(getManifestPath(cwd));
  currentRelFiles.push(manifestRel);

  // #7 / #8 — Prune stale files (files in previous manifest but not in current run).
  //            Pruning only happens in refresh/update mode, or when --prune is explicit.
  const shouldPrune = pruneFlag || mode === 'refresh-existing';
  const prunedAbs: string[] = [];

  if (shouldPrune && previousFiles.size > 0) {
    const currentSet = new Set(currentRelFiles);
    for (const rel of previousFiles) {
      if (!currentSet.has(rel)) {
        const abs = path.join(cwd, rel);
        if (fs.existsSync(abs)) {
          try {
            fs.rmSync(abs);
            prunedAbs.push(abs);
            console.log(`  🗑️  Pruned stale artifact: ${rel}`);
          } catch {
            console.warn(`  ⚠ Could not prune: ${rel}`);
          }
        }
      }
    }
  }

  // Write updated manifest (#8 / #11).
  writeManifest(cwd, getToolVersion(), currentRelFiles);

  // Diff counts for summary (#11).
  // A file is "written" when it exists but may have changed; we track via comparing
  // against previous manifest (new entry = written) plus the fact that writeIfChanged
  // inside generators only wrote when content differed. We use a simple heuristic:
  // files not in the previous manifest are "new" (written); the rest may be skipped or updated.
  const newFiles = currentRelFiles.filter(r => r !== manifestRel && !previousFiles.has(r));
  const existingFiles = currentRelFiles.filter(r => r !== manifestRel && previousFiles.has(r));

  printSummary(stack, cwd, newFiles, existingFiles, prunedAbs, agentFiles);
}

main().catch(err => {
  console.error('  ❌ Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
