import fs from 'node:fs';
import path from 'node:path';
import type { DetectedStack, AiOsConfig } from '../types.js';
import { buildDependencyGraph } from '../detectors/graph.js';
import { getToolVersion } from '../updater.js';
import { writeIfChanged } from './utils.js';

const DEFAULT_AI_OS_CONFIG: Omit<AiOsConfig, 'version' | 'installedAt' | 'projectName' | 'primaryLanguage' | 'primaryFramework' | 'frameworks' | 'packageManager' | 'hasTypeScript'> = {
  agentsMd: false,
  pathSpecificInstructions: true,
  recommendations: true,
  sessionContextCard: true,
  updateCheckEnabled: true,
  agentFlowMode: 'create',
  persistentRules: [],
  exclude: ['node_modules', 'dist', '.next', '.nuxt', 'build', 'out'],
};

/** Read and return the existing AI OS config, or null. */
export function readAiOsConfig(outputDir: string): AiOsConfig | null {
  const configPath = path.join(outputDir, '.github', 'ai-os', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AiOsConfig;
  } catch {
    return null;
  }
}

interface ExistingArtifact {
  path: string;
  category: 'instructions' | 'skills' | 'prompts' | 'agents' | 'docs' | 'other';
}

interface ExistingAiContextSummary {
  artifacts: ExistingArtifact[];
  counts: Record<ExistingArtifact['category'], number>;
}

function formatNodeLabel(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
}

function joinOrNone(values: string[], max = 4): string {
  if (values.length === 0) return 'none';
  const shown = values.slice(0, max);
  const suffix = values.length > max ? ` +${values.length - max} more` : '';
  return `${shown.join(', ')}${suffix}`;
}

function exists(root: string, relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function countMarkdownFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countMarkdownFiles(fullPath);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      total += 1;
    }
  }
  return total;
}

function detectExistingAiContext(rootDir: string): ExistingAiContextSummary {
  const artifacts: ExistingArtifact[] = [];
  const categories: ExistingArtifact['category'][] = ['instructions', 'skills', 'prompts', 'agents', 'docs', 'other'];
  const counts = Object.fromEntries(categories.map(c => [c, 0])) as Record<ExistingArtifact['category'], number>;

  const add = (relativePath: string, category: ExistingArtifact['category']): void => {
    artifacts.push({ path: relativePath, category });
    counts[category] += 1;
  };

  if (exists(rootDir, '.github/copilot-instructions.md')) add('.github/copilot-instructions.md', 'instructions');
  if (exists(rootDir, '.github/instructions')) add('.github/instructions/', 'instructions');
  if (exists(rootDir, '.github/copilot/prompts.json')) add('.github/copilot/prompts.json', 'prompts');

  const skillsDir = path.join(rootDir, '.github', 'copilot', 'skills');
  const skillsCount = countMarkdownFiles(skillsDir);
  if (skillsCount > 0) add(`.github/copilot/skills/ (${skillsCount} files)`, 'skills');

  const agentsDir = path.join(rootDir, '.github', 'agents');
  const agentsCount = countMarkdownFiles(agentsDir);
  if (agentsCount > 0) add(`.github/agents/ (${agentsCount} files)`, 'agents');

  if (exists(rootDir, '.github/ai-os/context/stack.md')) add('.github/ai-os/context/stack.md', 'docs');
  if (exists(rootDir, '.github/ai-os/context/architecture.md')) add('.github/ai-os/context/architecture.md', 'docs');
  if (exists(rootDir, '.github/ai-os/context/conventions.md')) add('.github/ai-os/context/conventions.md', 'docs');
  // Legacy paths — backward compat detection
  if (!exists(rootDir, '.github/ai-os/context/stack.md') && exists(rootDir, '.ai-os/context/stack.md')) add('.ai-os/context/stack.md (legacy)', 'docs');
  if (!exists(rootDir, '.github/ai-os/context/architecture.md') && exists(rootDir, '.ai-os/context/architecture.md')) add('.ai-os/context/architecture.md (legacy)', 'docs');
  if (!exists(rootDir, '.github/ai-os/context/conventions.md') && exists(rootDir, '.ai-os/context/conventions.md')) add('.ai-os/context/conventions.md (legacy)', 'docs');
  if (exists(rootDir, 'docs/ai/session_memory.md')) add('docs/ai/session_memory.md', 'docs');

  if (exists(rootDir, 'AGENTS.md')) add('AGENTS.md', 'other');
  if (exists(rootDir, 'CLAUDE.md')) add('CLAUDE.md', 'other');
  if (exists(rootDir, '.cursor/rules')) add('.cursor/rules/', 'other');
  if (exists(rootDir, '.windsurfrules')) add('.windsurfrules', 'other');

  return { artifacts, counts };
}

function generateExistingAiContextDoc(stack: DetectedStack, summary: ExistingAiContextSummary): string {
  const totalArtifacts = summary.artifacts.length;
  const lines: string[] = [
    `# Existing AI Context — ${stack.projectName}`,
    '',
    '> Auto-generated by AI OS. This report detects existing AI guidance and suggests a Git Bash-first optimization path.',
    '',
    '## Detection Summary',
    '',
    `- Total detected AI artifacts: **${totalArtifacts}**`,
    `- Copilot instructions: **${summary.counts.instructions}**`,
    `- Copilot skills: **${summary.counts.skills}**`,
    `- Prompt registries: **${summary.counts.prompts}**`,
    `- Agent files: **${summary.counts.agents}**`,
    `- AI docs/context files: **${summary.counts.docs}**`,
    `- Other assistant configs: **${summary.counts.other}**`,
    '',
    '## Detected Artifacts',
    '',
  ];

  if (summary.artifacts.length === 0) {
    lines.push('- No existing AI context artifacts were detected.');
  } else {
    for (const artifact of summary.artifacts) {
      lines.push(`- [${artifact.category}] \`${artifact.path}\``);
    }
  }

  lines.push('', '## Optimization Plan (Git Bash-First)', '');
  lines.push('1. Refresh generated artifacts in-place (safe for existing repos):');
  lines.push('```bash');
  lines.push('npm run generate -- --cwd "$PWD" --refresh-existing');
  lines.push('```');
  lines.push('2. Re-run installer in refresh mode when onboarding or syncing:');
  lines.push('```bash');
  lines.push('bash install.sh --cwd "$PWD" --refresh-existing');
  lines.push('```');
  lines.push('3. Keep Copilot as the single active target for generated instructions, prompts, and skills.');
  lines.push('4. Treat `.github/ai-os/context/*.md` files as source-of-truth and update them after architectural changes.');

  lines.push('', '## Notes', '');
  lines.push('- This workflow is shell-driven (Git Bash + Node.js) and does not require Python runtime scripts.');
  lines.push('- Existing files are preserved in safe mode and updated intentionally in refresh mode.');

  const chartTotal = Math.max(1, totalArtifacts);
  lines.push('', '## Visual Artifact Breakdown', '');
  lines.push('```mermaid');
  lines.push('pie showData');
  lines.push('  title Existing AI Context Artifacts');
  lines.push(`  \"instructions\" : ${summary.counts.instructions}`);
  lines.push(`  \"skills\" : ${summary.counts.skills}`);
  lines.push(`  \"prompts\" : ${summary.counts.prompts}`);
  lines.push(`  \"agents\" : ${summary.counts.agents}`);
  lines.push(`  \"docs\" : ${summary.counts.docs}`);
  lines.push(`  \"other\" : ${summary.counts.other}`);
  if (chartTotal === 0) {
    lines.push('  \"none\" : 1');
  }
  lines.push('```');
  lines.push('');
  lines.push('_Open this file in VS Code Markdown Preview to view the diagram._');

  return lines.join('\n');
}

function generateStackDoc(stack: DetectedStack): string {
  const lines: string[] = [
    `# Tech Stack — ${stack.projectName}`,
    '',
    '## Languages',
    '',
  ];

  for (const lang of stack.languages) {
    lines.push(`- **${lang.name}** — ${lang.fileCount} files (${lang.percentage}%) | extensions: ${lang.extensions.map(e => `.${e}`).join(', ')}`);
  }

  lines.push('', '## Frameworks & Libraries', '');
  if (stack.frameworks.length === 0) {
    lines.push(`- ${stack.primaryLanguage.name} (no framework detected)`);
  } else {
    for (const fw of stack.frameworks) {
      const version = fw.version ? ` v${fw.version}` : '';
      lines.push(`- **${fw.name}**${version} (${fw.category})`);
    }
  }

  lines.push('', '## Build & Tooling', '');
  lines.push(`- **Package Manager:** ${stack.patterns.packageManager}`);
  if (stack.patterns.bundler) lines.push(`- **Bundler:** ${stack.patterns.bundler}`);
  if (stack.patterns.linter) lines.push(`- **Linter:** ${stack.patterns.linter}`);
  if (stack.patterns.formatter) lines.push(`- **Formatter:** ${stack.patterns.formatter}`);
  if (stack.patterns.testFramework) lines.push(`- **Test Framework:** ${stack.patterns.testFramework}`);
  if (stack.patterns.ciCdProvider) lines.push(`- **CI/CD:** ${stack.patterns.ciCdProvider}`);
  lines.push(`- **TypeScript:** ${stack.patterns.hasTypeScript ? 'Yes' : 'No'}`);
  lines.push(`- **Docker:** ${stack.patterns.hasDockerfile ? 'Yes' : 'No'}`);
  lines.push(`- **Monorepo:** ${stack.patterns.monorepo ? 'Yes' : 'No'}`);

  lines.push('', '## Key Files', '');
  for (const f of stack.keyFiles) {
    lines.push(`- \`${f}\``);
  }

  if (stack.packageProfiles && stack.packageProfiles.length > 1) {
    lines.push('', '## Package Profiles (Per-Package Detection)', '');
    for (const profile of stack.packageProfiles) {
      const profileFrameworks = profile.frameworks.length > 0
        ? profile.frameworks.map((fw) => fw.name).join(', ')
        : 'none detected';
      const profileLangs = profile.languages.slice(0, 3).map((lang) => `${lang.name} ${lang.percentage}%`).join(', ') || 'none detected';
      lines.push(`- **${profile.name}** at \`${profile.path}\``);
      lines.push(`  - Languages: ${profileLangs}`);
      lines.push(`  - Frameworks: ${profileFrameworks}`);
      lines.push(`  - Package manager: ${profile.patterns.packageManager}`);
      lines.push(`  - Build/Test: ${profile.patterns.bundler ?? 'n/a'} / ${profile.patterns.testFramework ?? 'n/a'}`);
    }
  }

  const parityTargets = ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust'];
  const detectedParity = stack.languages
    .map((lang) => lang.name)
    .filter((name) => parityTargets.includes(name));

  if (detectedParity.length > 0) {
    lines.push('', '## MCP Parity Signals', '');
    lines.push(`- Detected language families for parity checks: ${detectedParity.join(', ')}`);
    lines.push('- Route discovery, package/build introspection, and env-convention scanning are enabled per detected stack.');
  }

  lines.push('', '## Visual Stack Map', '');
  lines.push('```mermaid');
  lines.push('flowchart LR');
  lines.push(`  Project[\"${formatNodeLabel(`Project: ${stack.projectName}`)}\"]`);
  lines.push(`  Lang[\"${formatNodeLabel(`Languages: ${joinOrNone(stack.languages.map((lang) => lang.name))}`)}\"]`);
  lines.push(`  Fw[\"${formatNodeLabel(`Frameworks: ${joinOrNone(stack.frameworks.map((fw) => fw.name))}`)}\"]`);
  lines.push(`  Tooling[\"${formatNodeLabel(`Tooling: ${stack.patterns.packageManager}${stack.patterns.testFramework ? `, ${stack.patterns.testFramework}` : ''}`)}\"]`);
  lines.push(`  Files[\"${formatNodeLabel(`Key files: ${Math.min(stack.keyFiles.length, 6)} shown in table`) }\"]`);
  lines.push('  Project --> Lang');
  lines.push('  Project --> Fw');
  lines.push('  Project --> Tooling');
  lines.push('  Project --> Files');
  lines.push('```');
  lines.push('');
  lines.push('_Open this file in VS Code Markdown Preview to view the diagram._');

  return lines.join('\n');
}

function generateArchitectureDoc(stack: DetectedStack): string {
  const lines: string[] = [
    `# Architecture — ${stack.projectName}`,
    '',
    '> Auto-generated by AI OS. Update this file as the architecture evolves.',
    '',
    '## Project Type',
    '',
  ];

  const fw = stack.primaryFramework;
  if (fw) {
    lines.push(`**${fw.name}** (${fw.category}) project.`);
  } else {
    lines.push(`**${stack.primaryLanguage.name}** project.`);
  }

  lines.push('', '## Directory Structure', '');
  lines.push('```');
  try {
    const entries = fs.readdirSync(stack.rootDir).filter(e => !e.startsWith('.') && e !== 'node_modules');
    for (const entry of entries.slice(0, 20)) {
      const stat = fs.statSync(path.join(stack.rootDir, entry));
      lines.push(stat.isDirectory() ? `${entry}/` : entry);
    }
  } catch {
    lines.push('(could not read directory)');
  }
  lines.push('```');

  lines.push('', '## Data Flow', '');
  if (fw?.name === 'Next.js') {
    lines.push('```');
    lines.push('Browser → Next.js App Router → Server Components → DB/API');
    lines.push('       ↘ Client Components → tRPC/fetch → API Routes → DB');
    lines.push('```');
  } else if (fw?.category === 'backend') {
    lines.push('```');
    lines.push('Client → HTTP/REST → Controller → Service → Database');
    lines.push('```');
  } else if (fw?.category === 'fullstack') {
    lines.push('```');
    lines.push('Browser → Routes/Pages → Server Logic → Database/API');
    lines.push('```');
  } else {
    lines.push('_Update this section with your actual data flow._');
  }

  lines.push('', '## Integration Points', '');
  lines.push('_List external services, APIs, and third-party integrations here._');

  lines.push('', '## Visual Architecture Overview', '');
  lines.push('```mermaid');
  lines.push('flowchart TD');
  lines.push(`  Repo[\"${formatNodeLabel(`Repository: ${stack.projectName}`)}\"] --> Detect[\"Detect stack & patterns\"]`);
  lines.push(`  Detect --> Lang[\"${formatNodeLabel(`Languages: ${joinOrNone(stack.languages.map((lang) => lang.name))}`)}\"]`);
  lines.push(`  Detect --> Fw[\"${formatNodeLabel(`Frameworks: ${joinOrNone(stack.frameworks.map((fw) => fw.name))}`)}\"]`);
  lines.push('  Detect --> Ctx["Scan existing AI context"]');
  lines.push('  Detect --> Graph["Build dependency graph"]');
  lines.push('  Detect --> Generate["Generate AI OS artifacts"]');
  lines.push('  Generate --> Docs[".github/ai-os/context/*.md"]');
  lines.push('  Generate --> Instr[".github/copilot-instructions.md"]');
  lines.push('  Generate --> MCP[".vscode/mcp.json + .ai-os/mcp-server/"]');
  lines.push('  Generate --> Agents[".github/agents/*.agent.md"]');
  lines.push('  Generate --> Skills[".github/copilot/skills/*.md"]');
  lines.push('```');
  lines.push('');
  lines.push('_Open this file in VS Code Markdown Preview to view the diagram._');

  return lines.join('\n');
}

function generateConventionsDoc(stack: DetectedStack): string {
  const lines: string[] = [
    `# Coding Conventions — ${stack.projectName}`,
    '',
    '> Auto-generated by AI OS. Update to reflect actual team agreements.',
    '',
    '## Naming Conventions',
    '',
    `- **General style:** ${stack.patterns.namingConvention}`,
  ];

  if (stack.patterns.hasTypeScript) {
    lines.push('- **TypeScript interfaces:** PascalCase (e.g., `UserProfile`)');
    lines.push('- **Types/Enums:** PascalCase');
    lines.push('- **Variables/functions:** camelCase');
    lines.push('- **Constants:** SCREAMING_SNAKE_CASE');
  }

  if (stack.primaryFramework?.name === 'Next.js' || stack.primaryFramework?.name === 'React') {
    lines.push('- **React components:** PascalCase files + exports');
    lines.push('- **Hooks:** `use` prefix (e.g., `useAuth`, `useCart`)');
    lines.push('- **Event handlers:** `handle` prefix (e.g., `handleSubmit`)');
    lines.push('- **Boolean state:** `is`/`has`/`show` prefix (e.g., `isLoading`, `hasError`)');
  }

  lines.push('', '## File Structure Rules', '');
  if (stack.patterns.srcDirectory) {
    lines.push('- All source code lives under `src/`');
  }
  if (stack.patterns.testDirectory) {
    lines.push(`- Tests in \`${stack.patterns.testDirectory}/\``);
  }
  if (stack.patterns.linter) {
    lines.push(`- Linter: **${stack.patterns.linter}** — must pass before committing`);
  }
  if (stack.patterns.formatter) {
    lines.push(`- Formatter: **${stack.patterns.formatter}** — auto-format on save`);
  }

  lines.push('', '## Code Style', '');
  lines.push('- Prefer early returns over deep nesting');
  lines.push('- Validate all external inputs at API/form boundaries');
  lines.push('- Async/await over .then() chains');
  lines.push('- No commented-out code in commits');
  lines.push('- No secrets or credentials in source code');

  if (stack.patterns.testFramework) {
    lines.push('', '## Testing', '');
    lines.push(`- Framework: **${stack.patterns.testFramework}**`);
    lines.push('- Unit tests for all business logic');
    lines.push('- Integration tests for API endpoints');
    lines.push('- Never hit real external services in unit tests — mock them');
  }

  return lines.join('\n');
}

function generateContextBudgetDoc(stack: DetectedStack): string {
  const lines: string[] = [
    `# Context Budget Policy — ${stack.projectName}`,
    '',
    '> Auto-generated by AI OS. This policy defines context loading order, compaction triggers, anti-patterns, and session reset guidance.',
    '',
    '## Context Loading Order',
    '',
    'Load context in this priority sequence — stop loading once the task has enough information:',
    '',
    '1. **Session card** (`get_session_context`) — always first; ≤ 500 tokens',
    '2. **Repository memory** (`get_repo_memory`) — durable decisions and constraints; load at task start',
    '3. **Conventions** (`get_conventions`) — before writing any new code',
    '4. **Stack info** (`get_stack_info`) — before suggesting library or tooling changes',
    '5. **File summaries** (`get_file_summary`) — before reading full files; token-efficient',
    '6. **Full file reads** — only when implementation requires exact edits',
    '7. **Search** (`search_codebase`) — targeted lookup; prefer over full directory scans',
    '',
    '## Compaction / Summarization Triggers',
    '',
    'Consider summarizing or compacting context when:',
    '',
    '- Context window usage exceeds ~70% of the model\'s limit',
    '- The same file or section has been re-read more than twice in a session',
    '- A completed task\'s reasoning chain is no longer needed for the next task',
    '- A long plan has been fully executed and only the outcomes matter',
    '',
    '**How to compact:**',
    '- Store stable findings in repository memory via `remember_repo_fact`',
    '- Drop intermediate reasoning; keep only decisions and code references',
    '- Restart with `get_session_context` + `get_repo_memory` for a clean context baseline',
    '',
    '## Anti-Patterns to Avoid',
    '',
    '### Context Starvation',
    '- Starting a non-trivial task without calling `get_session_context` or `get_repo_memory`',
    '- Guessing conventions instead of loading `get_conventions`',
    '- Skipping `get_impact_of_change` before editing shared files',
    '',
    '### Context Flooding',
    '- Loading entire directory trees when targeted file summaries would suffice',
    '- Re-reading files already in context without a clear reason',
    '- Appending all retrieved context verbatim when a 2-sentence summary would do',
    '- Loading stack docs for a task that only touches a single utility function',
    '',
    '### Context Pollution',
    '- Storing transient status notes in repository memory',
    '- Keeping stale plan steps in context after the task is done',
    '- Mixing reasoning for two separate tasks in the same context window',
    '',
    '## Session Reset Guidance',
    '',
    'When a context window reset occurs or a new session begins:',
    '',
    '1. Call `get_session_context` to reload the session card and MUST-ALWAYS rules',
    '2. Call `get_repo_memory` to reload durable architectural decisions',
    '3. Call `get_conventions` to reload coding rules',
    '4. Resume only from the last verified checkpoint — do not reconstruct reasoning from memory',
    '5. If work-in-progress was lost, ask the user for the last known state before resuming',
    '',
    '> **Rule:** Never continue with assumptions after a reset. Reload context explicitly.',
  ];

  return lines.join('\n');
}

function generateProtectedBlocksDoc(): string {
  const lines: string[] = [
    '# Protected Block Hooks — Design & Recovery',
    '',
    '> Auto-generated by AI OS. This document describes the opt-in protected-block mechanism for preventing accidental AI edits of critical code regions.',
    '',
    '## Overview',
    '',
    'Protected blocks let developers mark regions of code that AI assistants must not modify, simplify, or refactor without explicit permission. The mechanism is opt-in, language-agnostic, and requires no tooling beyond comment markers.',
    '',
    '## Marker Syntax',
    '',
    '```text',
    '// @ai-os:protect reason="<human-readable explanation>"',
    '... protected code ...',
    '// @ai-os:protect-end',
    '```',
    '',
    'The `reason` attribute is required to document why the block is protected.',
    '',
    '## How AI Assistants Must Behave',
    '',
    '- **MUST NOT** modify, delete, simplify, reorder, or refactor any line between `@ai-os:protect` and `@ai-os:protect-end`',
    '- **MUST** preserve the markers themselves when editing surrounding code',
    '- **MUST** stop and ask the user for explicit confirmation if a task requires changing a protected region',
    '- **MUST NOT** remove markers as part of a "cleanup" or "dead code elimination" pass',
    '',
    '## Supported Comment Styles',
    '',
    'Use the comment syntax appropriate for the file language:',
    '',
    '| Language | Marker format |',
    '| -------- | ------------- |',
    '| TypeScript / JavaScript | `// @ai-os:protect reason="..."` |',
    '| Python | `# @ai-os:protect reason="..."` |',
    '| Go | `// @ai-os:protect reason="..."` |',
    '| Java / C# | `// @ai-os:protect reason="..."` |',
    '| HTML / XML | `<!-- @ai-os:protect reason="..." -->` |',
    '| CSS / SCSS | `/* @ai-os:protect reason="..." */` |',
    '',
    '## When to Use Protected Blocks',
    '',
    '- Hand-tuned performance-critical algorithms',
    '- Security-sensitive validation or auth logic',
    '- Vendor-required interface implementations with exact signatures',
    '- Migration compatibility shims that must stay bit-for-bit identical',
    '- Legal / compliance notices embedded in code',
    '',
    '## Recovery Behavior',
    '',
    'To unprotect a region:',
    '',
    '1. Remove the `@ai-os:protect reason="..."` line',
    '2. Remove the `@ai-os:protect-end` line',
    '3. The code between the former markers is now freely editable by AI assistants',
    '',
    '## Important Notes',
    '',
    '- Protection is **advisory** — it instructs AI assistants but does not enforce anything at the Git or CI level',
    '- Absence of markers means **no protection** is in effect for that code',
    '- Nested protected blocks are not supported; only use flat, non-overlapping markers',
    '- Add protected blocks sparingly — overuse reduces AI effectiveness',
  ];

  return lines.join('\n');
}

function generateMemoryDoc(stack: DetectedStack): string {
  const lines: string[] = [
    `# Memory Protocol — ${stack.projectName}`,
    '',
    '> Auto-generated by AI OS. Use this protocol to preserve stable project knowledge across long sessions.',
    '',
    '## Goals',
    '',
    '- Reduce hallucinations by reusing verified repo facts instead of re-deriving assumptions each turn',
    '- Keep core principles persistent across long feature branches and multi-day sessions',
    '- Capture decisions, constraints, and gotchas that are easy to forget',
    '',
    '## Memory Files',
    '',
    '- `.github/ai-os/memory/memory.jsonl` — append-only durable memory entries',
    '- `.github/ai-os/memory/README.md` — memory categories and usage rules',
    '',
    '## Agent Workflow',
    '',
    '1. MUST at task start: call `get_repo_memory` with relevant query/category before coding',
    '2. During implementation: avoid contradicting existing memory unless code evidence shows memory is stale',
    '3. MUST at task end: call `remember_repo_fact` only for verified durable findings (not transient details)',
    '',
    '## What To Store',
    '',
    '- Architecture invariants and boundaries',
    '- Non-obvious conventions and naming rules',
    '- Build/test commands that are validated and repeatable',
    '- Known pitfalls, migration gotchas, and failure modes',
    '- Conflict/supersession notes when prior memory must be replaced',
    '',
    '## What Not To Store',
    '',
    '- Secrets, credentials, or personal data',
    '- Ephemeral status updates or one-off debug outputs',
    '- Speculative guesses that were not verified from the codebase',
    '- Duplicate facts that restate existing memory without new evidence',
  ];

  return lines.join('\n');
}

function mergeSections(existing: string, updated: string): string {
  if (!existing.trim()) return updated;
  const parseSections = (content: string): Map<string, string> => {
    const sections = new Map<string, string>();
    let currentHeading = '__preamble__';
    let currentLines: string[] = [];
    for (const line of content.split('\n')) {
      if (line.startsWith('## ')) {
        sections.set(currentHeading, currentLines.join('\n'));
        currentHeading = line.slice(3).trim();
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }
    sections.set(currentHeading, currentLines.join('\n'));
    return sections;
  };
  const existingSections = parseSections(existing);
  const updatedSections = parseSections(updated);
  const result: string[] = [updatedSections.get('__preamble__') ?? ''];
  for (const [heading, content] of updatedSections) {
    if (heading !== '__preamble__') result.push(content);
  }
  for (const [heading, content] of existingSections) {
    if (heading !== '__preamble__' && !updatedSections.has(heading)) result.push(content);
  }
  return result.join('\n');
}

interface GenerateContextDocsOptions {
  /** When true, skip overwriting curated context files that already exist (architecture.md, conventions.md). */
  preserveContextFiles?: boolean;
}

/** Returns absolute paths of all managed files. */
export function generateContextDocs(stack: DetectedStack, outputDir: string, options?: GenerateContextDocsOptions): string[] {
  const preserveContextFiles = options?.preserveContextFiles ?? false;
  const contextDir = path.join(outputDir, '.github', 'ai-os', 'context');
  fs.mkdirSync(contextDir, { recursive: true });
  const memoryDir = path.join(outputDir, '.github', 'ai-os', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  const managed: string[] = [];
  const track = (p: string) => { managed.push(p); return p; };
  const shouldPreserve = (absPath: string): boolean => preserveContextFiles && fs.existsSync(absPath);

  const existingContext = detectExistingAiContext(outputDir);

  // Migrate legacy memory.jsonl from .ai-os/ if needed
  const legacyMemory = path.join(outputDir, '.ai-os', 'memory', 'memory.jsonl');
  const newMemory = path.join(memoryDir, 'memory.jsonl');
  if (fs.existsSync(legacyMemory) && !fs.existsSync(newMemory)) {
    fs.copyFileSync(legacyMemory, newMemory);
  }

  const stackPath = track(path.join(contextDir, 'stack.md'));
  if (!shouldPreserve(stackPath)) {
    writeIfChanged(stackPath, generateStackDoc(stack));
  }

  // architecture.md and conventions.md: section-level merge to preserve manual edits.
  // When preserveContextFiles is true (safe refresh mode), skip writing if the file already
  // exists so that curated content is never downgraded to generic defaults.
  const archPath = track(path.join(contextDir, 'architecture.md'));
  if (!(preserveContextFiles && fs.existsSync(archPath))) {
    const archGenerated = generateArchitectureDoc(stack);
    writeIfChanged(archPath, fs.existsSync(archPath) ? mergeSections(fs.readFileSync(archPath, 'utf-8'), archGenerated) : archGenerated);
  }

  const convsPath = track(path.join(contextDir, 'conventions.md'));
  if (!(preserveContextFiles && fs.existsSync(convsPath))) {
    const convsGenerated = generateConventionsDoc(stack);
    writeIfChanged(convsPath, fs.existsSync(convsPath) ? mergeSections(fs.readFileSync(convsPath, 'utf-8'), convsGenerated) : convsGenerated);
  }

  writeIfChanged(track(path.join(contextDir, 'memory.md')), generateMemoryDoc(stack));

  const existingAiContextPath = track(path.join(contextDir, 'existing-ai-context.md'));
  if (!shouldPreserve(existingAiContextPath)) {
    writeIfChanged(existingAiContextPath, generateExistingAiContextDoc(stack, existingContext));
  }

  const contextBudgetPath = track(path.join(contextDir, 'context-budget.md'));
  if (!shouldPreserve(contextBudgetPath)) {
    writeIfChanged(contextBudgetPath, generateContextBudgetDoc(stack));
  }

  const protectedBlocksPath = track(path.join(contextDir, 'protected-blocks.md'));
  if (!shouldPreserve(protectedBlocksPath)) {
    writeIfChanged(protectedBlocksPath, generateProtectedBlocksDoc());
  }

  const memoryReadmePath = track(path.join(memoryDir, 'README.md'));
  if (!fs.existsSync(memoryReadmePath)) {
    writeIfChanged(
      memoryReadmePath,
      [
        '# AI OS Repository Memory',
        '',
        '- Durable memory lives in `memory.jsonl` as one JSON object per line.',
        '- Use categories: architecture, conventions, build, testing, security, pitfalls, decisions.',
        '- Keep entries concise, factual, and evidence-based.',
      ].join('\n'),
    );
  }

  const memoryFilePath = track(path.join(memoryDir, 'memory.jsonl'));
  if (!fs.existsSync(memoryFilePath)) {
    // C3 — Write high-priority session preamble entries so every new agent session
    // is anchored with the core workflow even before any user-authored memories exist.
    const preambleEntries = [
      {
        id: 'session-preamble-start-protocol',
        title: 'Session Start Protocol',
        content: 'On every new conversation, call get_session_context first to reload MUST-ALWAYS rules, build commands, and key file locations. Then call get_repo_memory and get_conventions before starting any task.',
        category: 'conventions',
        tags: 'session,always,startup',
        priority: 'high',
        createdAt: new Date().toISOString(),
        source: 'ai-os-installer',
      },
      {
        id: 'session-preamble-memory-workflow',
        title: 'Memory Workflow — Always-On',
        content: 'Before implementation: call get_repo_memory with a relevant query. After a substantial task: call remember_repo_fact only for verified durable findings. Never store speculative, duplicate, or transient notes.',
        category: 'conventions',
        tags: 'memory,always,session',
        priority: 'high',
        createdAt: new Date().toISOString(),
        source: 'ai-os-installer',
      },
    ];
    fs.writeFileSync(
      memoryFilePath,
      preambleEntries.map(e => JSON.stringify(e)).join('\n') + '\n',
      'utf-8',
    );
  }

  // Build and persist dependency graph for AI impact analysis
  const graph = buildDependencyGraph(outputDir);
  writeIfChanged(track(path.join(contextDir, 'dependency-graph.json')), JSON.stringify(graph, null, 2));

  // Write config.json — preserve user-editable fields across refreshes
  const existingConfig = readAiOsConfig(outputDir);
  const config: AiOsConfig = {
  // Auto-detected fields (always refreshed)
    version: getToolVersion(),
    installedAt: new Date().toISOString(),
    projectName: stack.projectName,
    primaryLanguage: stack.primaryLanguage.name,
    primaryFramework: stack.primaryFramework?.name ?? null,
    frameworks: stack.frameworks.map(f => f.name),
    packageManager: stack.patterns.packageManager,
    hasTypeScript: stack.patterns.hasTypeScript,
    // User-editable fields (preserved from existing config, fall back to defaults)
    agentsMd: existingConfig?.agentsMd ?? DEFAULT_AI_OS_CONFIG.agentsMd,
    pathSpecificInstructions: existingConfig?.pathSpecificInstructions ?? DEFAULT_AI_OS_CONFIG.pathSpecificInstructions,
    recommendations: existingConfig?.recommendations ?? DEFAULT_AI_OS_CONFIG.recommendations,
    sessionContextCard: existingConfig?.sessionContextCard ?? DEFAULT_AI_OS_CONFIG.sessionContextCard,
    updateCheckEnabled: existingConfig?.updateCheckEnabled ?? DEFAULT_AI_OS_CONFIG.updateCheckEnabled,
    agentFlowMode: existingConfig?.agentFlowMode ?? DEFAULT_AI_OS_CONFIG.agentFlowMode,
    persistentRules: existingConfig?.persistentRules ?? DEFAULT_AI_OS_CONFIG.persistentRules,
    exclude: existingConfig?.exclude ?? DEFAULT_AI_OS_CONFIG.exclude,
  };

  const aiOsDir = path.join(outputDir, '.github', 'ai-os');
  writeIfChanged(track(path.join(aiOsDir, 'config.json')), JSON.stringify(config, null, 2));

  // Generate session context card if enabled
  if (config.sessionContextCard) {
    const sessionCardPath = track(path.join(outputDir, '.github', 'COPILOT_CONTEXT.md'));
    if (!shouldPreserve(sessionCardPath)) {
      writeIfChanged(sessionCardPath, generateSessionContextCard(stack, config));
    }
  }

  return managed;
}

/** Generate a compact session context card (≤ 500 tokens). */
function generateSessionContextCard(stack: DetectedStack, config: AiOsConfig): string {
  const fw = stack.primaryFramework?.name ?? stack.primaryLanguage.name;
  const pm = stack.patterns.packageManager;
  const isNode = ['npm', 'yarn', 'pnpm', 'bun'].includes(pm);

  // Build/test commands based on detected stack
  const buildCmd = isNode ? `${pm} run build` : pm === 'go' ? 'go build ./...' : pm === 'cargo' ? 'cargo build' : pm === 'maven' ? 'mvn package' : pm === 'gradle' ? './gradlew build' : 'build';
  const testCmd = isNode ? `${pm} run test` : pm === 'go' ? 'go test ./...' : pm === 'cargo' ? 'cargo test' : pm === 'maven' ? 'mvn test' : pm === 'gradle' ? './gradlew test' : 'test';
  const lintCmd = stack.patterns.linter ? (isNode ? `${pm} run lint` : stack.patterns.linter) : null;

  const rules: string[] = [
    `Use ${fw} conventions for all new code`,
    `Primary language: ${stack.primaryLanguage.name}${stack.patterns.hasTypeScript ? ' with TypeScript' : ''}`,
    `Package manager: ${pm} — do not mix with others`,
    'Call get_repo_memory before starting any non-trivial task',
    'Call get_conventions before writing new code',
    'Call get_impact_of_change before editing any shared file',
  ];

  // Add user-defined persistent rules at the top
  const allRules = [...config.persistentRules, ...rules].slice(0, 10);

  const keyFilesTable = stack.keyFiles.slice(0, 6).map(f => `| \`${f}\` | key file |`).join('\n');

  return [
    '# Copilot Context — Quick Start',
    '',
    '> **If starting a new conversation**: call `get_session_context` before any task to reload all critical context.',
    '',
    '## MUST-ALWAYS Rules',
    '',
    ...allRules.map(r => `- ${r}`),
    '',
    '## Build & Test',
    '',
    '```bash',
    `${buildCmd}   # build`,
    `${testCmd}   # test`,
    ...(lintCmd ? [`${lintCmd}   # lint`] : []),
    '```',
    '',
    '## Key Files',
    '',
    '| File | Role |',
    '|------|------|',
    keyFilesTable,
    '',
    '## Session Restart Protocol',
    '',
    '1. Call `get_session_context` → reloads this card',
    '2. Call `get_repo_memory` → reloads durable decisions',
    '3. Call `get_conventions` → reloads coding rules',
    '',
    '## Non-Trivial Task Protocol',
    '',
    '> Before writing any code on a non-trivial task:',
    '',
    '1. **Clarify** — state what is ambiguous; ask focused questions if needed',
    '2. **Discover** — call `get_project_structure` and `get_file_summary` on relevant files',
    '3. **Assess impact** — call `get_impact_of_change` before editing any shared file',
    '4. **Plan** — use `/plan` to produce a task list before touching code',
    '5. **Build one task at a time** — use `/build`, confirm, then proceed',
  ].join('\n');
}
