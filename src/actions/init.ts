/**
 * Interactive --init wizard for guided first-time setup (#175)
 *
 * Shows detected stack, lets user confirm and choose a profile, then
 * returns whether to proceed and with which profile.
 */
import readline from 'node:readline';
import type { DetectedStack } from '../types.js';
import type { InstallProfile } from '../types.js';

export interface InitResult {
  proceed: boolean;
  profile: InstallProfile;
}

export type AskFn = (prompt: string) => Promise<string>;

const PROFILES: InstallProfile[] = ['minimal', 'standard', 'full'];

export function formatStackSummary(stack: DetectedStack): string {
  const lines: string[] = [];
  lines.push(`  Primary language : ${stack.primaryLanguage.name}`);
  if (stack.frameworks.length > 0) {
    lines.push(`  Frameworks       : ${stack.frameworks.map(f => f.name).join(', ')}`);
  } else {
    lines.push('  Frameworks       : No frameworks detected');
  }
  lines.push(`  Package manager  : ${stack.patterns.packageManager}`);
  lines.push(`  TypeScript       : ${stack.patterns.hasTypeScript ? 'Yes' : 'No'}`);
  if (stack.patterns.testFramework) {
    lines.push(`  Test framework   : ${stack.patterns.testFramework}`);
  }
  if (stack.patterns.linter) {
    lines.push(`  Linter           : ${stack.patterns.linter}`);
  }
  return lines.join('\n');
}

export function formatProfileDescription(profile: InstallProfile): string {
  switch (profile) {
    case 'minimal':
      return 'minimal — Copilot instructions + MCP wiring only. Fastest, smallest footprint.';
    case 'standard':
      return 'standard — Instructions + agents + skills + tools. Recommended for most projects.';
    case 'full':
      return 'full — All integrations, extra skills, and advanced agents. Maximum AI OS coverage.';
  }
}

/** Core wizard logic — accepts injected ask function for testability. */
export async function runWizardLogic(stack: DetectedStack, ask: AskFn): Promise<InitResult> {
  console.log('\n  🔍 Detected project stack:\n');
  console.log(formatStackSummary(stack));
  console.log('');

  await ask('  Press Enter to confirm this stack (or Ctrl+C to exit): ');

  console.log('\n  📦 Choose an install profile:\n');
  for (const p of PROFILES) {
    const marker = p === 'standard' ? '  ✦' : '   ';
    console.log(`${marker} ${formatProfileDescription(p)}`);
  }
  console.log('');

  let profile: InstallProfile = 'standard';
  while (true) {
    const raw = (await ask('  Profile [minimal/standard/full] (default: standard): ')).trim().toLowerCase();
    if (raw === '' || raw === 'standard') { profile = 'standard'; break; }
    if (raw === 'minimal') { profile = 'minimal'; break; }
    if (raw === 'full') { profile = 'full'; break; }
    console.log('  Please enter: minimal, standard, or full');
  }

  console.log(`\n  Selected profile: ${profile}`);
  console.log('');
  console.log('  📋 What will be generated:');
  if (profile === 'minimal') {
    console.log('    • .github/copilot-instructions.md');
    console.log('    • .vscode/mcp.json');
    console.log('    • .github/ai-os/config.json');
  } else if (profile === 'standard') {
    console.log('    • .github/copilot-instructions.md');
    console.log('    • .github/agents/ (project agents)');
    console.log('    • .github/copilot/skills/ (recommended skills)');
    console.log('    • .vscode/mcp.json + tools.json');
    console.log('    • .github/ai-os/context/ (stack, conventions, architecture)');
  } else {
    console.log('    • Everything in standard plus:');
    console.log('    • Extra domain agents (db, auth, payments)');
    console.log('    • Advanced skill suite');
    console.log('    • GitHub Actions drift-check workflow');
  }
  console.log('');

  const confirm = (await ask('  Proceed with generation? [Y/n]: ')).trim().toLowerCase();
  if (confirm === 'n' || confirm === 'no') {
    console.log('\n  ⚡ Aborted. No files were written.\n');
    return { proceed: false, profile };
  }

  console.log('');
  return { proceed: true, profile };
}

/** Production entry point — wires readline and delegates to runWizardLogic. */
export async function runInitWizard(stack: DetectedStack, _cwd: string): Promise<InitResult> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask: AskFn = prompt => new Promise(resolve => rl.question(prompt, resolve));
  try {
    return await runWizardLogic(stack, ask);
  } finally {
    rl.close();
  }
}
