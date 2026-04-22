#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze } from './analyze.js';
import { generateInstructions } from './generators/instructions.js';
import { generateMcpJson, writeMcpServerConfig } from './generators/mcp.js';
import { generateContextDocs, readAiOsConfig } from './generators/context-docs.js';
import { generateAgents, scanExistingAgents } from './generators/agents.js';
import { generateSkills, deployBundledSkills } from './generators/skills.js';
import { generatePrompts } from './generators/prompts.js';
import { generateWorkflows } from './generators/workflows.js';
import { getMcpToolsForStack } from './mcp-tools.js';
import { checkUpdateStatus, printUpdateBanner, getToolVersion, pruneLegacyArtifacts } from './updater.js';
import { buildOnboardingPlan, formatOnboardingPlan } from './planner.js';
import { readManifest, writeManifest, getManifestPath, setVerboseMode } from './generators/utils.js';
import { generateRecommendations, getSkillsGapReport } from './recommendations/index.js';
import type { OnboardingPlan } from './planner.js';
import type { UpdateStatus } from './updater.js';

type GenerateMode = 'safe' | 'refresh-existing' | 'update';
type GenerateAction = 'apply' | 'plan' | 'preview' | 'check-hygiene';

function parseArgs(): { cwd: string; dryRun: boolean; mode: GenerateMode; action: GenerateAction; prune: boolean; verbose: boolean; cleanUpdate: boolean; regenerateContext: boolean; pruneCustomArtifacts: boolean } {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let dryRun = false;
  let mode: GenerateMode = 'safe';
  let action: GenerateAction = 'apply';
  let prune = false;
  let verbose = false;
  let cleanUpdate = false;
  let regenerateContext = false;
  let pruneCustomArtifacts = false;

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
    } else if (args[i]?.startsWith('--clean-update')) {
      // Accept --clean-update and forgiving variants like --clean-update~ from shell typos.
      cleanUpdate = true;
      mode = 'refresh-existing';
    } else if (args[i] === '--check-hygiene') {
      action = 'check-hygiene';
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--regenerate-context') {
      regenerateContext = true;
    } else if (args[i] === '--prune-custom-artifacts') {
      pruneCustomArtifacts = true;
    }
  }

  return { cwd, dryRun, mode, action, prune, verbose, cleanUpdate, regenerateContext, pruneCustomArtifacts };
}

function printBanner(): void {
  const version = `v${getToolVersion()}`;
  const versionCell = `AI OS  ${version}`.padEnd(25, ' ');
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log(`  ║          ${versionCell}║`);
  console.log('  ║  Portable Copilot Context Engine  ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');
}

/**
 * Print the one-time agent-flow setup prompt.
 *
 * If userDefined agents exist we offer three choices:
 *   create  — generate the three sequential agents alongside existing ones
 *   hook    — print instructions for referencing the new agents from existing ones
 *   skip    — do nothing
 *
 * The user records their choice in .github/ai-os/config.json `agentFlowMode`
 * to suppress the prompt on subsequent runs.
 */
function printAgentFlowSetupPrompt(cwd: string, currentMode: 'create' | 'hook' | 'skip' | null): void {
  const scan = scanExistingAgents(cwd);
  const hasUserAgents = scan.userDefined.length > 0;

  // Skip prompt if the user already set a mode (other than first-run undefined)
  if (currentMode !== null) return;

  console.log('  ┌─────────────────────────────────────────────────────────────┐');
  console.log('  │  🤖 Sequential Agent Flow — Setup                           │');
  console.log('  │                                                             │');
  console.log('  │  AI OS can generate a 3-agent sequential improvement flow:  │');
  console.log('  │                                                             │');
  console.log('  │   1. Feature Enhancement Advisor  (finds improvements)     │');
  console.log('  │      ↓                                                      │');
  console.log('  │   2. Idea Validator               (confirms before coding)  │');
  console.log('  │      ↓                                                      │');
  console.log('  │   3. Implementation Agent         (executes validated plan)  │');
  console.log('  │                                                             │');
  if (hasUserAgents) {
    console.log(`  │  Existing agents detected: ${scan.userDefined.join(', ').slice(0, 38).padEnd(38)} │`);
    console.log('  │                                                             │');
    console.log('  │  Choose an option in .github/ai-os/config.json:            │');
    console.log('  │    "agentFlowMode": "create"  — add the 3 agents (default) │');
    console.log('  │    "agentFlowMode": "hook"    — guide to link to existing   │');
    console.log('  │    "agentFlowMode": "skip"    — do not generate agents      │');
  } else {
    console.log('  │  No existing agents found — the 3 agents will be created.  │');
    console.log('  │  Set "agentFlowMode": "skip" in config.json to opt out.    │');
  }
  console.log('  │                                                             │');
  console.log('  │  Already created: .github/agents/feature-enhancement-advisor.agent.md │');
  console.log('  │                   .github/agents/idea-validator.agent.md    │');
  console.log('  │                   .github/agents/implementation-agent.agent.md │');
  console.log('  └─────────────────────────────────────────────────────────────┘');
  console.log('');

  if (currentMode === 'hook' && hasUserAgents) {
    printAgentHookGuide(scan.userDefined);
  }
}

function printAgentHookGuide(userDefinedAgents: string[]): void {
  console.log('  📎 Hook Guide — connecting your existing agents to the ai-os flow:');
  console.log('');
  for (const agent of userDefinedAgents) {
    console.log(`     ${agent}`);
    console.log('       → Add a "Handoff" section pointing to feature-enhancement-advisor.agent.md');
    console.log('         or idea-validator.agent.md as the next step in your workflow.');
  }
  console.log('');
  console.log('  Example handoff to add at the bottom of an existing agent:');
  console.log('');
  console.log('     ## Handoff');
  console.log('     When analysis is complete, pass the findings to the');
  console.log('     **Idea Validator** agent for cross-checking before implementation.');
  console.log('');
}

function printAgentFlowStatus(cwd: string, mode: 'create' | 'hook' | 'skip' | null): void {
  const scan = scanExistingAgents(cwd);
  const flowFiles = [
    'feature-enhancement-advisor.agent.md',
    'idea-validator.agent.md',
    'implementation-agent.agent.md',
  ];
  const present = flowFiles.filter((f) => scan.aiOsGenerated.includes(f) || scan.userDefined.includes(f));
  const activeMode = mode ?? 'create';

  console.log('  🤖 Agent flow status:');
  console.log(`     agent flow mode: ${activeMode}`);
  console.log(`     flow agents present: ${present.length}/3`);
  if (present.length > 0) {
    console.log(`     detected: ${present.join(', ')}`);
  }
  if (activeMode === 'hook') {
    console.log('     hook mode enabled — AI OS will keep your existing agents and print handoff guidance.');
  } else if (activeMode === 'skip') {
    console.log('     skip mode enabled — set agentFlowMode to "create" in .github/ai-os/config.json to enable flow agents.');
  }
  console.log('');
}

function printSummary(
  stack: ReturnType<typeof analyze>,
  outputDir: string,
  written: string[],
  skipped: string[],
  pruned: string[],
  agents: string[],
  preserved: string[],
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
  if (preserved.length > 0) {
    console.log(`  🔒 Preserved (curated):        ${preserved.length}`);
    for (const p of preserved) console.log(`       • ${path.relative(outputDir, p).replace(/\\/g, '/')}`);
  }
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
}

function printContextualNextSteps(
  mode: GenerateMode,
  onboardingPlan: OnboardingPlan,
  updateStatus: UpdateStatus,
  recommendationsEnabled: boolean,
): void {
  const refreshCmd = `npx -y "github:marinvch/ai-os#v${updateStatus.latestVersion}" --refresh-existing`;
  const recommendationsPath = '.github/ai-os/recommendations.md';

  const printInstructionStrategy = (): void => {
    console.log('  📌 First action after install/refresh:');
    console.log('     Review and optimize .github/copilot-instructions.md before asking Copilot to implement changes.');

    if (onboardingPlan.detectedRepoType === 'new') {
      console.log('  🆕 Strategy for new project:');
      console.log('     Build a baseline context first (stack, conventions, architecture), then keep instructions concise and task-agnostic.');
      console.log('     Use AI OS MCP tools to fill context as the codebase grows.');
      return;
    }

    console.log('  🏗️  Strategy for existing/large project:');
    console.log('     Compare current instructions against real project state and patch missing context before feature work.');
    console.log('     Prioritize architecture, build/test flow, and known pitfalls to reduce tool failures and rework.');
  };

  const printRecommendationsHint = (): void => {
    if (recommendationsEnabled) {
      console.log(`  📘 Recommendations saved to ${recommendationsPath}`);
    }
  };

  if (mode === 'safe' && updateStatus.updateAvailable && !updateStatus.isFirstInstall) {
    console.log('  🧭 Recommended next step:');
    console.log(`  ${refreshCmd}`);
    console.log('  Safe mode updated local MCP/runtime wiring, but left existing AI OS context artifacts in place.');
    printInstructionStrategy();
    console.log('  After refresh, ask Copilot:');
    console.log('     "Use all AI OS MCP tools, inspect this codebase, and improve the AI context files."');
    printRecommendationsHint();
    console.log('');
    return;
  }

  if (mode === 'refresh-existing' || mode === 'update') {
    console.log('  ✅ Ready to use with Copilot.');
    printInstructionStrategy();
    console.log('  If the tools do not appear immediately, run: MCP: Restart Servers');
    console.log('  Suggested first prompt:');
    console.log('     "Open and optimize .github/copilot-instructions.md for this repo state, then use AI OS MCP tools to review architecture, conventions, and missing context gaps."');
    printRecommendationsHint();
    console.log('');
    return;
  }

  const firstPrompt = onboardingPlan.detectedRepoType === 'existing-non-ai-os'
    ? 'Use AI OS MCP tools to map this codebase, compare the existing instructions with generated context, and improve the AI context files.'
    : 'Use all AI OS MCP tools, inspect this codebase, and improve the AI context files.';

  console.log('  🧭 Next steps:');
  console.log('  1. Open this repo in VS Code with GitHub Copilot Agent mode enabled.');
  console.log('  2. Review and optimize .github/copilot-instructions.md for the current project state.');
  if (onboardingPlan.detectedRepoType === 'new') {
    console.log('     New project strategy: bootstrap minimal context first, then expand instructions as the codebase evolves.');
  } else {
    console.log('     Existing/large project strategy: fill missing context first (architecture, build/test flow, pitfalls), then proceed with implementation.');
  }
  console.log('  3. If the tools do not appear immediately, run: MCP: Restart Servers');
  console.log('  4. Suggested first prompt:');
  console.log(`     "${firstPrompt}"`);
  printRecommendationsHint();
  console.log('');
}

/**
 * Load the optional `.github/ai-os/protect.json` file.
 * Returns a Set of repo-relative forward-slash paths that should never be
 * overwritten or pruned during a refresh run.
 *
 * Example protect.json:
 * ```json
 * {
 *   "protected": [
 *     ".github/agents/my-custom-agent.md",
 *     ".github/ai-os/context/conventions.md"
 *   ]
 * }
 * ```
 */
function loadProtectConfig(cwd: string): Set<string> {
  const protectPath = path.join(cwd, '.github', 'ai-os', 'protect.json');
  if (!fs.existsSync(protectPath)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(protectPath, 'utf-8')) as { protected?: unknown };
    if (!Array.isArray(raw.protected)) return new Set();
    return new Set(
      (raw.protected as unknown[])
        .filter((p): p is string => typeof p === 'string')
        .map(p => p.replace(/\\/g, '/')),
    );
  } catch {
    console.warn('  ⚠ Could not parse .github/ai-os/protect.json — ignoring protection config');
    return new Set();
  }
}

/**
 * Directories whose contents are considered "custom artifacts" (user-created or user-edited).
 * Files under these paths are NOT pruned during refresh unless --prune-custom-artifacts is passed.
 */
const CUSTOM_ARTIFACT_DIRS = ['.github/agents/', '.agents/skills/'];

function isCustomArtifact(relPath: string): boolean {
  return CUSTOM_ARTIFACT_DIRS.some(dir => relPath.startsWith(dir));
}

function ensureGitignoreEntry(cwd: string, entry: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return;

  const current = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = current.split(/\r?\n/);
  if (lines.includes(entry)) return;

  const next = `${current.replace(/\s*$/, '')}\n${entry}\n`;
  fs.writeFileSync(gitignorePath, next, 'utf-8');
}

function resolveBundledServerSource(): string | null {
  const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(runtimeDir, 'server.js'),
    path.join(runtimeDir, '..', 'bundle', 'server.js'),
    path.join(runtimeDir, '..', 'dist', 'server.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function installLocalMcpRuntime(cwd: string, verbose: boolean): void {
  const bundledServerSource = resolveBundledServerSource();
  if (!bundledServerSource) {
    console.warn('  ⚠ Could not locate bundled MCP server; local ai-os tools may be unavailable.');
    return;
  }

  const runtimeDir = path.join(cwd, '.ai-os', 'mcp-server');
  const runtimeEntry = path.join(runtimeDir, 'index.js');
  const runtimeManifest = path.join(runtimeDir, 'runtime-manifest.json');
  const nodePath = process.execPath;

  fs.mkdirSync(runtimeDir, { recursive: true });

  fs.copyFileSync(bundledServerSource, runtimeEntry);
  fs.chmodSync(runtimeEntry, 0o755);

  fs.writeFileSync(runtimeManifest, JSON.stringify({
    name: 'ai-os-mcp-server',
    runtime: 'bundled',
    sourceVersion: getToolVersion(),
    installedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');

  // Write the official VS Code MCP config (.vscode/mcp.json) with the resolved
  // Node executable path. This avoids shell alias/PATH issues when VS Code
  // launches the MCP server directly, especially on Windows.
  writeMcpServerConfig(cwd, {
    command: nodePath,
    args: [runtimeEntry],
    env: {
      AI_OS_ROOT: cwd,
    },
  });

  ensureGitignoreEntry(cwd, '.ai-os/mcp-server/node_modules');
  ensureGitignoreEntry(cwd, '.github/ai-os/memory/.memory.lock');

  // Clean up legacy .github/copilot/mcp.local.json if present
  const legacyLocalMcp = path.join(cwd, '.github', 'copilot', 'mcp.local.json');
  if (fs.existsSync(legacyLocalMcp)) {
    try { fs.rmSync(legacyLocalMcp); } catch { /* ignore */ }
  }

  const healthcheck = spawnSync(nodePath, [runtimeEntry, '--healthcheck'], {
    cwd,
    env: { ...process.env, AI_OS_ROOT: cwd },
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  if (healthcheck.status !== 0) {
    const details = [healthcheck.stdout, healthcheck.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`MCP runtime healthcheck failed after install${details ? `: ${details}` : ''}`);
  }

  if (verbose) {
    console.log(`  ✏️  write   ${runtimeEntry}`);
    console.log(`  ✏️  write   ${runtimeManifest}`);
    console.log(`  ✏️  write   .vscode/mcp.json`);
  } else {
    console.log('  ✓ MCP runtime installed to .ai-os/mcp-server');
    console.log('  ✓ MCP config written to .vscode/mcp.json');
  }
}

async function main(): Promise<void> {
  printBanner();

  const { cwd, dryRun, mode: rawMode, action, prune: pruneFlag, verbose, cleanUpdate, regenerateContext, pruneCustomArtifacts } = parseArgs();
  let mode: GenerateMode = rawMode;

  // Enable verbose per-file logging when --verbose / -v is passed
  if (verbose) {
    setVerboseMode(true);
    console.log('  🔍 Verbose mode enabled — per-file write/skip/prune reasons will be shown.\n');
  }

  // ── --check-hygiene action (runs before scan, no generation needed) ────────
  if (action === 'check-hygiene') {
    runHygieneCheck(cwd);
    return;
  }

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
  } else if (mode === 'safe' && !updateStatus.isFirstInstall) {
    printUpdateBanner(updateStatus);
  }

  // In refresh mode, curated context/instruction files are preserved by default.
  // Pass --regenerate-context to allow full rewrite of those files.
  const isRefresh = mode === 'refresh-existing';
  const preserveContextFiles = isRefresh && !regenerateContext;

  if (isRefresh && preserveContextFiles) {
    console.log('  🔒 Safe refresh: curated context/instruction files will be preserved.');
    console.log('     Pass --regenerate-context to allow full rewrite of those files.');
    console.log('');
  }

  // Prune legacy artifacts on every refresh/update run
  if (mode === 'refresh-existing') {
    pruneLegacyArtifacts(cwd, { fullCleanup: cleanUpdate });
  }

  // Load optional protection config for files that must never be overwritten/pruned.
  const protectedPaths = loadProtectConfig(cwd);

  // Snapshot content of protect.json-listed files BEFORE generation so we can
  // restore them afterwards if a generator accidentally overwrites them.
  const protectedSnapshots = new Map<string, string>();
  for (const rel of protectedPaths) {
    const abs = path.join(cwd, rel);
    if (fs.existsSync(abs)) {
      protectedSnapshots.set(abs, fs.readFileSync(abs, 'utf-8'));
    }
  }
  if (isRefresh && protectedSnapshots.size > 0) {
    console.log(`  🔒 protect.json: ${protectedSnapshots.size} file(s) shielded against overwrite.`);
    console.log('');
  }

  const stack = analyze(cwd);
  // Read existing config before generation to preserve user-editable fields
  const existingConfig = readAiOsConfig(cwd);
  const onboardingPlan = buildOnboardingPlan(cwd, mode, { regenerateContext });

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

  // Phase 1: Core context files (config.json is written here, with user fields preserved)
  const contextFiles = generateContextDocs(stack, cwd, { preserveContextFiles });
  // Read the freshly-written config to get feature flags for remaining generators
  const config = readAiOsConfig(cwd) ?? existingConfig;
  const skillsStrategy = config?.skillsStrategy ?? 'creator-only';
  const instructionFiles = generateInstructions(stack, cwd, { refreshExisting: mode === 'refresh-existing', preserveContextFiles, config: config ?? undefined });
  const mcpFiles = generateMcpJson(stack, cwd, { refreshExisting: mode === 'refresh-existing' });

  // Phase 2: Agents, Skills, Prompts
  const agentFiles = await generateAgents(stack, cwd, { refreshExisting: mode === 'refresh-existing', preserveExistingAgents: preserveContextFiles, config: config ?? undefined });
  const skillFiles = await generateSkills(stack, cwd, {
    refreshExisting: mode === 'refresh-existing',
    strategy: skillsStrategy,
  });
  const promptFiles = await generatePrompts(stack, cwd, { refreshExisting: mode === 'refresh-existing' });
  const workflowFiles = generateWorkflows(cwd, { config: config ?? undefined });
  await deployBundledSkills(cwd, { refreshExisting: mode === 'refresh-existing' });

  console.log(`  🧠 Skills strategy: ${skillsStrategy}`);

  // Phase 3: Recommendations (if enabled in config, default: true)
  const recommendationFiles: string[] = [];
  if (config?.recommendations !== false) {
    const recPath = generateRecommendations(stack, cwd);
    recommendationFiles.push(recPath);
    // Skills gap report (stdout only, not written to disk)
    const skillsLockPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skills-lock.json');
    const gapReport = getSkillsGapReport(stack, skillsLockPath);
    if (gapReport) console.log(`\n${gapReport}\n`);
  }

  // Collect all managed absolute paths and convert to repo-relative forward-slash keys.
  const allManagedAbs = [
    ...contextFiles,
    ...instructionFiles,
    ...mcpFiles,
    ...agentFiles,
    ...skillFiles,
    ...promptFiles,
    ...workflowFiles,
    ...recommendationFiles,
  ];
  const toRel = (p: string) => path.relative(cwd, p).replace(/\\/g, '/');
  const currentRelFiles = allManagedAbs.map(toRel);

  // Also track the manifest itself.
  const manifestRel = toRel(getManifestPath(cwd));
  currentRelFiles.push(manifestRel);

  // #7 / #8 — Prune stale files (files in previous manifest but not in current run).
  //            Pruning only happens in refresh/update mode, or when --prune is explicit.
  //            Custom artifact directories (.github/agents/, .agents/skills/) are spared
  //            unless --prune-custom-artifacts is passed or the file is not a custom artifact.
  const shouldPrune = pruneFlag || mode === 'refresh-existing';
  const prunedAbs: string[] = [];
  const preservedAbs: string[] = [];

  if (shouldPrune && previousFiles.size > 0) {
    const currentSet = new Set(currentRelFiles);
    for (const rel of previousFiles) {
      if (!currentSet.has(rel)) {
        // Skip files protected by protect.json
        if (protectedPaths.has(rel)) {
          if (verbose) console.log(`  🔒 protect  ${rel}  (in protect.json)`);
          preservedAbs.push(path.join(cwd, rel));
          continue;
        }
        // Skip custom artifacts unless --prune-custom-artifacts is passed
        if (!pruneCustomArtifacts && isCustomArtifact(rel)) {
          if (verbose) {
            console.log(`  🔒 preserve ${rel}  (custom artifact — pass --prune-custom-artifacts to remove)`);
          }
          preservedAbs.push(path.join(cwd, rel));
          continue;
        }
        const abs = path.join(cwd, rel);
        if (fs.existsSync(abs)) {
          try {
            fs.rmSync(abs);
            prunedAbs.push(abs);
            if (verbose) {
              console.log(`  🗑️  prune   ${rel}  (stale — not in current generation)`);
            } else {
              console.log(`  🗑️  Pruned stale artifact: ${rel}`);
            }
          } catch {
            console.warn(`  ⚠ Could not prune: ${rel}`);
          }
        } else if (verbose) {
          console.log(`  🗑️  prune   ${rel}  (already missing, skipping delete)`);
        }
      }
    }
  }

  // Restore any files that were overwritten during generation despite being in protect.json.
  // This ensures protect.json guards both prune and write paths.
  for (const [abs, originalContent] of protectedSnapshots) {
    if (!fs.existsSync(abs)) continue;
    const currentContent = fs.readFileSync(abs, 'utf-8');
    if (currentContent !== originalContent) {
      fs.writeFileSync(abs, originalContent, 'utf-8');
      const rel = path.relative(cwd, abs).replace(/\\/g, '/');
      if (verbose) console.log(`  🔒 restored ${rel}  (protect.json: overwrite reverted)`);
      if (!preservedAbs.some(p => p === abs)) preservedAbs.push(abs);
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

  installLocalMcpRuntime(cwd, verbose);

  printSummary(stack, cwd, newFiles, existingFiles, prunedAbs, agentFiles, preservedAbs);
  printContextualNextSteps(mode, onboardingPlan, updateStatus, config?.recommendations !== false);

  // ── Agent-flow setup prompt ──────────────────────────────────────────────
  // On first install (no prior config) or when agentFlowMode is not explicitly
  // set, scan for existing agents and print a one-time setup suggestion.
  const agentFlowMode = config?.agentFlowMode;
  const isFirstInstall = updateStatus.isFirstInstall;
  if (isFirstInstall || agentFlowMode === undefined) {
    printAgentFlowSetupPrompt(cwd, config?.agentFlowMode ?? null);
  }
  printAgentFlowStatus(cwd, config?.agentFlowMode ?? null);
}

main().catch(err => {
  console.error('  ❌ Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// ── --check-hygiene ───────────────────────────────────────────────────────────

function runHygieneCheck(cwd: string): void {
  console.log(`  🧹 Hygiene check: ${cwd}`);
  console.log('');
  const issues: string[] = [];

  // Check for legacy .ai-os/context/ artifacts (pre-v0.3.0 paths)
  const legacyContextDir = path.join(cwd, '.ai-os', 'context');
  if (fs.existsSync(legacyContextDir)) {
    const legacyFiles = fs.readdirSync(legacyContextDir);
    if (legacyFiles.length > 0) {
      issues.push(`  ⚠  Legacy .ai-os/context/ found with ${legacyFiles.length} file(s) — run --refresh-existing to migrate and prune`);
    }
  }

  // Check for leftover .memory.lock files (crash artifact)
  const lockPaths = [
    path.join(cwd, '.github', 'ai-os', 'memory', '.memory.lock'),
    path.join(cwd, '.ai-os', 'memory', '.memory.lock'),
  ];
  for (const lockPath of lockPaths) {
    if (fs.existsSync(lockPath)) {
      issues.push(`  ⚠  Stale lock file found: ${path.relative(cwd, lockPath)} — safe to delete`);
    }
  }

  // Check for node_modules inside .ai-os/mcp-server/ (Phase F not yet applied)
  const mcpNodeModules = path.join(cwd, '.ai-os', 'mcp-server', 'node_modules');
  if (fs.existsSync(mcpNodeModules)) {
    issues.push(`  ⚠  node_modules present in .ai-os/mcp-server/ — Phase F (bundle deploy) will eliminate this`);
  }

  // Check for *.tmp files in ai-os dirs
  const aiOsDirs = [
    path.join(cwd, '.github', 'ai-os'),
    path.join(cwd, '.ai-os'),
  ];
  for (const dir of aiOsDirs) {
    if (!fs.existsSync(dir)) continue;
    const tmpFiles = findFilesRecursive(dir, f => f.endsWith('.tmp'));
    for (const f of tmpFiles) {
      issues.push(`  ⚠  Orphaned temp file: ${path.relative(cwd, f)}`);
    }
  }

  // Check manifest consistency
  const manifest = readManifest(cwd);
  if (manifest) {
    const missingFiles = manifest.files.filter(f => !fs.existsSync(path.join(cwd, f)));
    if (missingFiles.length > 0) {
      issues.push(`  ⚠  ${missingFiles.length} manifest entries point to missing files — run --refresh-existing`);
    }
  } else {
    issues.push(`  ⚠  No manifest.json found — run AI OS generation to create one`);
  }

  if (issues.length === 0) {
    console.log('  ✅ Hygiene check passed — no orphaned files or dump artifacts found.');
  } else {
    console.log('  Issues found:');
    for (const issue of issues) console.log(issue);
    console.log('');
    console.log(`  Total issues: ${issues.length}`);
    process.exit(1);
  }
  console.log('');
}

function findFilesRecursive(dir: string, predicate: (name: string) => boolean): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFilesRecursive(full, predicate));
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(full);
      }
    }
  } catch {
    // ignore permission errors
  }
  return results;
}
