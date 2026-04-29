#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
import { readManifest, writeManifest, getManifestPath, setVerboseMode, writeFileAtomic, hashFile } from './generators/utils.js';
import { generateRecommendations, getSkillsGapReport } from './recommendations/index.js';
import { applyProfile, describeProfile, parseProfile } from './profile.js';
import type { InstallProfile } from './types.js';
import { runDoctor, printDoctorReport } from './doctor.js';
import { mergeUserBlocks } from './user-blocks.js';
import { runBootstrap, formatBootstrapReport } from './bootstrap.js';
import { captureContextSnapshot, writeContextSnapshot, computeFreshnessReport, formatFreshnessReport } from './detectors/freshness.js';
import { runMemoryMaintenance, pruneMemory } from './mcp-server/utils.js';
import { runUninstall, formatUninstallReport } from './uninstall.js';
import type { OnboardingPlan } from './planner.js';
import type { UpdateStatus } from './updater.js';

type GenerateMode = 'safe' | 'refresh-existing' | 'update';
type GenerateAction = 'apply' | 'plan' | 'preview' | 'check-hygiene' | 'doctor' | 'bootstrap' | 'check-freshness' | 'compact-memory' | 'uninstall';

function parseArgs(): { cwd: string; dryRun: boolean; mode: GenerateMode; action: GenerateAction; prune: boolean; verbose: boolean; cleanUpdate: boolean; regenerateContext: boolean; pruneCustomArtifacts: boolean; profile: InstallProfile | null } {
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
  let profile: InstallProfile | null = null;

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
    } else if (args[i] === '--doctor') {
      action = 'doctor';
    } else if (args[i] === '--bootstrap') {
      action = 'bootstrap';
    } else if (args[i] === '--check-freshness') {
      action = 'check-freshness';
    } else if (args[i] === '--compact-memory') {
      action = 'compact-memory';
    } else if (args[i] === '--uninstall') {
      action = 'uninstall';
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--regenerate-context') {
      regenerateContext = true;
    } else if (args[i] === '--prune-custom-artifacts') {
      pruneCustomArtifacts = true;
    } else if (args[i] === '--profile' && args[i + 1]) {
      const parsed = parseProfile(args[i + 1]);
      if (!parsed) throw new Error(`--profile must be one of: minimal, standard, full (got "${args[i + 1]}")`);
      profile = parsed;
      i++;
    } else if (args[i]?.startsWith('--profile=')) {
      const raw = args[i].slice('--profile='.length);
      const parsed = parseProfile(raw);
      if (!parsed) throw new Error(`--profile must be one of: minimal, standard, full (got "${raw}")`);
      profile = parsed;
    }
  }

  return { cwd, dryRun, mode, action, prune, verbose, cleanUpdate, regenerateContext, pruneCustomArtifacts, profile };
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
  activeProfile?: string,
): void {
  const mcpToolCount = getMcpToolsForStack(stack).length;
  const fw = stack.frameworks.map(f => f.name).join(', ') || stack.primaryLanguage.name;
  console.log(`  📦 Project:    ${stack.projectName}`);
  console.log(`  🔤 Language:   ${stack.primaryLanguage.name} (${stack.primaryLanguage.percentage}%)`);
  console.log(`  🏗️  Framework:  ${fw}`);
  console.log(`  📦 Pkg Mgr:   ${stack.patterns.packageManager}`);
  console.log(`  🔷 TypeScript: ${stack.patterns.hasTypeScript ? 'Yes' : 'No'}`);
  if (activeProfile) {
    console.log(`  🎛️  Profile:    ${activeProfile}`);
  }
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
  // Print previous freshness score (before this run's snapshot is written) to show drift
  try {
    const prevReport = computeFreshnessReport(outputDir);
    if (prevReport.status !== 'unknown') {
      const scorePercent = Math.round(prevReport.score * 100);
      const statusEmoji: Record<string, string> = { fresh: '✅', drifted: '⚠️', stale: '❌' };
      const emoji = statusEmoji[prevReport.status] ?? '❓';
      console.log(`  ${emoji} Context freshness (pre-run): ${scorePercent}/100 (${prevReport.status})`);
      if (prevReport.staleArtifacts.length > 0) {
        console.log(`     Stale artifacts: ${prevReport.staleArtifacts.join(', ')}`);
      }
      if (prevReport.changedSourceFiles.length > 0) {
        console.log(`     Changed sources: ${prevReport.changedSourceFiles.join(', ')}`);
      }
    }
  } catch { /* non-fatal */ }
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
 * Parsed result of `.github/ai-os/protect.json`.
 *
 * - `protected` — whole-file shield: file is never overwritten or pruned.
 * - `hybrid`    — block-level merge: file is regenerated but
 *                 `<!-- AI-OS:USER_BLOCK:START id="..." -->` sections authored
 *                 by the user are preserved and re-inserted after generation.
 */
interface ProtectConfig {
  protected: Set<string>;
  hybrid: Set<string>;
}

/**
 * Load the optional `.github/ai-os/protect.json` file.
 *
 * Supports two modes per file:
 *  - `protected` — whole-file shield (existing behaviour)
 *  - `hybrid`    — block-level user-section preservation (new)
 *
 * Example protect.json:
 * ```json
 * {
 *   "protected": [
 *     ".github/agents/my-custom-agent.md"
 *   ],
 *   "hybrid": [
 *     ".github/copilot-instructions.md",
 *     ".github/ai-os/context/conventions.md"
 *   ]
 * }
 * ```
 */
/**
 * Convert an unknown JSON array value into a Set of normalised forward-slash paths.
 * Non-array values and non-string elements are silently ignored.
 */
function toPathSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    (value as unknown[])
      .filter((p): p is string => typeof p === 'string')
      .map(p => p.replace(/\\/g, '/')),
  );
}

function loadProtectConfig(cwd: string): ProtectConfig {
  const empty: ProtectConfig = { protected: new Set(), hybrid: new Set() };
  const protectPath = path.join(cwd, '.github', 'ai-os', 'protect.json');
  if (!fs.existsSync(protectPath)) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(protectPath, 'utf-8')) as {
      protected?: unknown;
      hybrid?: unknown;
    };

    return {
      protected: toPathSet(raw.protected),
      hybrid: toPathSet(raw.hybrid),
    };
  } catch {
    console.warn('  ⚠ Could not parse .github/ai-os/protect.json — ignoring protection config');
    return empty;
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
  writeFileAtomic(gitignorePath, next);
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

  writeFileAtomic(runtimeManifest, JSON.stringify({
    name: 'ai-os-mcp-server',
    runtime: 'bundled',
    sourceVersion: getToolVersion(),
    installedAt: new Date().toISOString(),
  }, null, 2));

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

  const { cwd, dryRun, mode: rawMode, action, prune: pruneFlag, verbose, cleanUpdate, regenerateContext, pruneCustomArtifacts, profile: cliProfile } = parseArgs();
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

  // ── --doctor action (post-install health validation) ──────────────────────
  if (action === 'doctor') {
    const doctorResult = runDoctor(cwd);
    const exitCode = printDoctorReport(doctorResult);
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }

  // ── --check-freshness action (runs before scan, no generation needed) ──────
  if (action === 'check-freshness') {
    runFreshnessCheck(cwd);
    return;
  }

  // ── --compact-memory action (runs before scan, no generation needed) ───────
  if (action === 'compact-memory') {
    runCompactMemory(cwd);
    return;
  }

  // ── --uninstall action ────────────────────────────────────────────────────
  if (action === 'uninstall') {
    const report = runUninstall(cwd, { dryRun, verbose });
    console.log(formatUninstallReport(report));
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
  const protectConfig = loadProtectConfig(cwd);
  const protectedPaths = protectConfig.protected;
  const hybridPaths    = protectConfig.hybrid;

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

  // Snapshot content of hybrid-mode files BEFORE generation so we can
  // re-insert user-authored blocks after the generator rewrites them.
  const hybridSnapshots = new Map<string, string>();
  if (isRefresh) {
    for (const rel of hybridPaths) {
      const abs = path.join(cwd, rel);
      if (fs.existsSync(abs)) {
        hybridSnapshots.set(abs, fs.readFileSync(abs, 'utf-8'));
      }
    }
    if (hybridSnapshots.size > 0) {
      console.log(`  🔀 protect.json: ${hybridSnapshots.size} file(s) in hybrid mode (user blocks will be preserved).`);
      console.log('');
    }
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
    if (action === 'bootstrap') {
      const report = runBootstrap(stack, { dryRun: true });
      console.log(formatBootstrapReport(report));
      return;
    }

    // ── Rich dry-run: generate into a temp dir then compare with real files ──
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-dry-'));
    try {
      // Seed the tmp dir with the current ai-os config so generators see it.
      const configSrc = path.join(cwd, '.github', 'ai-os', 'config.json');
      const configDst = path.join(tmpCwd, '.github', 'ai-os', 'config.json');
      if (fs.existsSync(configSrc)) {
        fs.mkdirSync(path.dirname(configDst), { recursive: true });
        fs.copyFileSync(configSrc, configDst);
      }
      // Seed protect.json so generators can read it.
      const protectSrc = path.join(cwd, '.github', 'ai-os', 'protect.json');
      const protectDst = path.join(tmpCwd, '.github', 'ai-os', 'protect.json');
      if (fs.existsSync(protectSrc)) {
        fs.mkdirSync(path.dirname(protectDst), { recursive: true });
        fs.copyFileSync(protectSrc, protectDst);
      }

      let tmpConfig = readAiOsConfig(tmpCwd) ?? existingConfig;
      const tmpEffectiveProfile = cliProfile ?? tmpConfig?.profile ?? null;
      if (tmpEffectiveProfile && tmpConfig) {
        tmpConfig = applyProfile(tmpConfig, tmpEffectiveProfile);
      }
      const tmpSkillsStrategy = tmpConfig?.skillsStrategy ?? 'creator-only';

      // Run generators targeting tmpCwd (no real files written to cwd).
      const tmpInstructionFiles = generateInstructions(stack, tmpCwd, {
        refreshExisting: mode === 'refresh-existing',
        preserveContextFiles: false,
        config: tmpConfig ?? undefined,
      });
      const tmpMcpFiles = generateMcpJson(stack, tmpCwd, {
        refreshExisting: mode === 'refresh-existing',
        config: tmpConfig ?? undefined,
      });
      const tmpAgentFiles = await generateAgents(stack, tmpCwd, {
        refreshExisting: mode === 'refresh-existing',
        preserveExistingAgents: false,
        config: tmpConfig ?? undefined,
      });
      const tmpSkillFiles = await generateSkills(stack, tmpCwd, {
        refreshExisting: mode === 'refresh-existing',
        strategy: tmpSkillsStrategy,
      });
      const tmpPromptFiles = await generatePrompts(stack, tmpCwd, {
        refreshExisting: mode === 'refresh-existing',
      });
      const tmpWorkflowFiles = generateWorkflows(tmpCwd, { config: tmpConfig ?? undefined });

      const allTmpAbs = [
        ...tmpInstructionFiles,
        ...tmpMcpFiles,
        ...tmpAgentFiles,
        ...tmpSkillFiles,
        ...tmpPromptFiles,
        ...tmpWorkflowFiles,
      ];

      const toRel = (p: string, base: string) => path.relative(base, p).replace(/\\/g, '/');

      const newCount: string[] = [];
      const modCount: string[] = [];
      const sameCount: string[] = [];

      console.log('');
      console.log('  📋 Dry-run diff (no files written)');
      console.log('  ─────────────────────────────────────────────────────────────');

      for (const tmpAbs of allTmpAbs) {
        const rel = toRel(tmpAbs, tmpCwd);
        const realAbs = path.join(cwd, rel);
        const newContent = fs.existsSync(tmpAbs) ? fs.readFileSync(tmpAbs, 'utf-8') : null;
        if (newContent === null) continue;

        if (!fs.existsSync(realAbs)) {
          newCount.push(rel);
          console.log(`  ${'\x1b[32m'}+ NEW     ${'\x1b[0m'} ${rel}`);
        } else {
          const existingContent = fs.readFileSync(realAbs, 'utf-8');
          if (existingContent !== newContent) {
            modCount.push(rel);
            console.log(`  ${'\x1b[33m'}~ MODIFY  ${'\x1b[0m'} ${rel}`);
          } else {
            sameCount.push(rel);
            console.log(`  ${'\x1b[90m'}= SAME    ${'\x1b[0m'} ${rel}`);
          }
        }
      }

      // Show files that would be pruned.
      const prevManifest = readManifest(cwd);
      if (prevManifest && (pruneFlag || mode === 'refresh-existing')) {
        const currentRelSet = new Set(allTmpAbs.map((p) => toRel(p, tmpCwd)));
        for (const rel of prevManifest.files) {
          if (!currentRelSet.has(rel) && fs.existsSync(path.join(cwd, rel))) {
            console.log(`  ${'\x1b[31m'}- DELETE  ${'\x1b[0m'} ${rel}`);
          }
        }
      }

      console.log('');
      console.log(`  Summary:  +${newCount.length} new  ~${modCount.length} modified  =${sameCount.length} unchanged`);
      console.log('');
      console.log('  Run without --dry-run to apply changes.');
      console.log('');
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
    return;
  }

  // Read previous manifest to allow pruning stale files (#7 / #8).
  const previousManifest = readManifest(cwd);
  const previousFiles = new Set(previousManifest?.files ?? []);

  // Phase 1: Core context files (config.json is written here, with user fields preserved)
  const contextFiles = generateContextDocs(stack, cwd, { preserveContextFiles });
  // Read the freshly-written config to get feature flags for remaining generators.
  // If a --profile flag was passed, apply it now (it overrides individual flags but is
  // written back into config.json so subsequent refreshes inherit the same density level).
  let config = readAiOsConfig(cwd) ?? existingConfig;

  // Resolve the effective profile: CLI flag > persisted config > none
  const effectiveProfile = cliProfile ?? config?.profile ?? null;
  if (effectiveProfile) {
    if (cliProfile) {
      console.log(`\n  🎛️  Applying profile: ${cliProfile}`);
      console.log(describeProfile(cliProfile));
      console.log('');
    }
    if (config) {
      config = applyProfile(config, effectiveProfile);
      // Persist the profile-applied config back to disk.
      const configPath = path.join(cwd, '.github', 'ai-os', 'config.json');
      writeFileAtomic(configPath, JSON.stringify(config, null, 2) + '\n');
    }
  }

  const skillsStrategy = config?.skillsStrategy ?? 'creator-only';
  const instructionFiles = generateInstructions(stack, cwd, { refreshExisting: mode === 'refresh-existing', preserveContextFiles, config: config ?? undefined });
  const mcpFiles = generateMcpJson(stack, cwd, { refreshExisting: mode === 'refresh-existing', config: config ?? undefined });

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
        // Skip files protected by protect.json (full shield)
        if (protectedPaths.has(rel)) {
          if (verbose) console.log(`  🔒 protect  ${rel}  (in protect.json)`);
          preservedAbs.push(path.join(cwd, rel));
          continue;
        }
        // Skip files in hybrid mode — they are managed but user blocks survive
        if (hybridPaths.has(rel)) {
          if (verbose) console.log(`  🔀 hybrid   ${rel}  (in protect.json hybrid — user blocks preserved)`);
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
      writeFileAtomic(abs, originalContent);
      const rel = path.relative(cwd, abs).replace(/\\/g, '/');
      if (verbose) console.log(`  🔒 restored ${rel}  (protect.json: overwrite reverted)`);
      if (!preservedAbs.some(p => p === abs)) preservedAbs.push(abs);
    }
  }

  // Apply hybrid-mode user-block merge: for each file in the hybrid list, merge
  // user blocks from the pre-generation snapshot back into the newly written content.
  // Emit a conflict report for any block that could not be re-inserted safely.
  const allConflicts: Array<{ file: string; blockId: string; reason: string; detail: string }> = [];
  for (const [abs, snapshot] of hybridSnapshots) {
    if (!fs.existsSync(abs)) continue;
    const generated = fs.readFileSync(abs, 'utf-8');
    const { content: merged, preserved: mergedIds, conflicts } = mergeUserBlocks(generated, snapshot);
    if (mergedIds.length > 0 || conflicts.length > 0) {
      const rel = path.relative(cwd, abs).replace(/\\/g, '/');
      // Only write when the merge actually changed the content
      if (merged !== generated) {
        writeFileAtomic(abs, merged);
      }
      if (mergedIds.length > 0) {
        if (verbose) {
          console.log(`  🔀 merged   ${rel}  (${mergedIds.length} user block(s) preserved: ${mergedIds.join(', ')})`);
        } else {
          console.log(`  🔀 Hybrid merge: ${mergedIds.length} user block(s) preserved in ${rel}`);
        }
      }
      for (const conflict of conflicts) {
        allConflicts.push({ file: rel, ...conflict });
        console.warn(`  ⚠ Hybrid conflict in ${rel}: block "${conflict.blockId}" — ${conflict.detail}`);
      }
    }
  }

  if (allConflicts.length > 0) {
    console.log('');
    console.log(`  ⚠ ${allConflicts.length} user block conflict(s) require manual reconciliation.`);
    console.log('     Each block has been appended to its file wrapped in <!-- AI-OS:CONFLICT --> markers.');
    console.log('     Review and move them to the correct location, then remove the conflict markers.');
    console.log('');
  }

  // Write updated manifest (#8 / #11 / #115).
  // Compute SHA-256 hashes for all managed files so future refresh runs
  // can detect which files have drifted from the generated baseline.
  const contentHashes: Record<string, string> = {};
  for (const rel of currentRelFiles) {
    if (rel === manifestRel) continue;
    const hash = hashFile(path.join(cwd, rel));
    if (hash) contentHashes[rel] = hash;
  }
  writeManifest(cwd, getToolVersion(), currentRelFiles, contentHashes);

  // ── Capture context freshness snapshot ──────────────────────────────────
  // After a successful generation run, record a new baseline snapshot so that
  // future `--check-freshness` / `get_context_freshness` calls can detect drift.
  try {
    const snapshot = captureContextSnapshot(cwd, getToolVersion());
    writeContextSnapshot(cwd, snapshot);
    if (verbose) {
      console.log('  ✏️  write   .github/ai-os/context-snapshot.json  (freshness baseline)');
    }
  } catch {
    // Non-fatal: freshness snapshot is best-effort
  }

  // Diff counts for summary (#11).
  // A file is "written" when it exists but may have changed; we track via comparing
  // against previous manifest (new entry = written) plus the fact that writeIfChanged
  // inside generators only wrote when content differed. We use a simple heuristic:
  // files not in the previous manifest are "new" (written); the rest may be skipped or updated.
  const newFiles = currentRelFiles.filter(r => r !== manifestRel && !previousFiles.has(r));
  const existingFiles = currentRelFiles.filter(r => r !== manifestRel && previousFiles.has(r));

  installLocalMcpRuntime(cwd, verbose);

  // ── Memory maintenance summary (refresh/update mode only) ────────────────
  if (isRefresh) {
    printMemoryMaintenanceSummary(cwd);
  }

  printSummary(stack, cwd, newFiles, existingFiles, prunedAbs, agentFiles, preservedAbs, effectiveProfile ?? undefined);
  printContextualNextSteps(mode, onboardingPlan, updateStatus, config?.recommendations !== false);

  // ── Bootstrap action: auto-install skills after full generation ──────────
  if (action === 'bootstrap') {
    console.log('  🚀 Running codebase-aware bootstrap...');
    console.log('');
    const bootstrapReport = runBootstrap(stack, { dryRun: false });
    console.log(formatBootstrapReport(bootstrapReport));
    return;
  }

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

// ── --check-freshness ─────────────────────────────────────────────────────────

function runFreshnessCheck(cwd: string): void {
  console.log(`  🔍 Context freshness check: ${cwd}`);
  console.log('');

  const report = computeFreshnessReport(cwd);
  console.log(formatFreshnessReport(report));

  const isCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';

  if (report.status === 'stale') {
    console.log('  ❌ Context is stale. Run `--refresh-existing` to rebuild context artifacts.');
    if (isCi) process.exit(1);
  } else if (report.status === 'drifted') {
    console.log('  ⚠️  Context has drifted. Consider running `--refresh-existing` to resync.');
  } else if (report.status === 'unknown') {
    console.log('  ❓ No snapshot found — run AI OS generation first to establish a baseline.');
  } else {
    console.log('  ✅ Context is fresh.');
  }
  console.log('');
}

// ── Memory maintenance helpers ────────────────────────────────────────────────

/**
 * Print a memory maintenance summary during refresh/update runs.
 * This is a non-destructive read-only hygiene report (does not modify the file).
 */
function printMemoryMaintenanceSummary(cwd: string): void {
  const memoryFile = path.join(cwd, '.github', 'ai-os', 'memory', 'memory.jsonl');
  if (!fs.existsSync(memoryFile)) return;

  try {
    process.env['AI_OS_ROOT'] = cwd;
    const summary = runMemoryMaintenance();

    if (summary.totalBefore === 0) return;

    console.log('  🧠 Memory maintenance:');
    console.log(`     Active entries:       ${summary.activeAfter}`);
    if (summary.staleMarked > 0) {
      console.log(`     Stale entries found:  ${summary.staleMarked} (run --compact-memory to remove)`);
    }
    if (summary.nearDuplicatesMarked > 0) {
      console.log(`     Near-duplicates:      ${summary.nearDuplicatesMarked}`);
    }
    if (summary.malformedSkipped > 0) {
      console.log(`     Malformed lines:      ${summary.malformedSkipped} (will be removed on next write)`);
    }
    console.log('');
  } catch {
    // Best-effort — never fail a refresh run due to memory reporting.
  }
}

/**
 * Handle the --compact-memory CLI action: run full memory hygiene and
 * physically remove stale entries from memory.jsonl.
 */
function runCompactMemory(cwd: string): void {
  console.log(`  🧹 Compact memory: ${cwd}`);
  console.log('');

  const memoryFile = path.join(cwd, '.github', 'ai-os', 'memory', 'memory.jsonl');
  if (!fs.existsSync(memoryFile)) {
    console.log('  ℹ️  No memory.jsonl file found — nothing to compact.');
    console.log('');
    return;
  }

  try {
    process.env['AI_OS_ROOT'] = cwd;
    const result = pruneMemory();
    const lines = result.split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
  } catch (err) {
    console.error(`  ❌ Memory compact failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log('');
}
