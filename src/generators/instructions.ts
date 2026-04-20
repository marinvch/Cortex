import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DetectedStack, AiOsConfig } from '../types.js';
import { writeIfChanged, resolveTemplatesDir } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolveTemplatesDir(__dirname);

function readTemplate(name: string): string {
  try {
    return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf-8');
  } catch {
    return '';
  }
}

function readFrameworkTemplate(templateKey: string): string {
  return readTemplate(path.join('frameworks', `${templateKey}.md`));
}

function buildStackSummary(stack: DetectedStack): string {
  const lines: string[] = [];
  for (const lang of stack.languages.slice(0, 5)) {
    lines.push(`- **${lang.name}** (${lang.percentage}% of codebase, ${lang.fileCount} files)`);
  }
  return lines.join('\n');
}

function buildKeyFilesList(stack: DetectedStack): string {
  return stack.keyFiles.map(f => `- \`${f}\``).join('\n');
}

function buildBuildCommandsSection(stack: DetectedStack): string {
  const cmds = stack.buildCommands;
  if (!cmds || Object.keys(cmds).filter(k => cmds[k]).length === 0) return '';

  const lines: string[] = [];
  const orderedCommands: Array<[string, string]> = [];

  // Ordered by importance
  const slots = ['build', 'test', 'dev', 'lint', 'start'] as const;
  for (const slot of slots) {
    if (cmds[slot]) orderedCommands.push([slot.charAt(0).toUpperCase() + slot.slice(1), cmds[slot]!]);
  }
  // Any extra keys beyond the standard slots
  for (const [k, v] of Object.entries(cmds)) {
    if (!slots.includes(k as (typeof slots)[number]) && v) {
      orderedCommands.push([k.charAt(0).toUpperCase() + k.slice(1), v]);
    }
  }

  for (const [label, cmd] of orderedCommands) {
    lines.push(`- **${label}:** \`${cmd}\``);
  }
  return lines.join('\n');
}

function buildPersonaDirective(stack: DetectedStack): string {
  const fw = stack.primaryFramework?.name;
  if (fw) return `Act as a Senior ${fw} developer with deep expertise in ${stack.primaryLanguage.name} and the full ${fw} ecosystem.`;
  return `Act as a Senior ${stack.primaryLanguage.name} developer.`;
}

function fillTemplate(template: string, stack: DetectedStack, frameworkOverlay: string): string {
  const frameworks = stack.frameworks.map(f => f.name).join(', ') || stack.primaryLanguage.name;
  const linter = stack.patterns.linter ?? 'none detected';
  const formatter = stack.patterns.formatter ?? 'none detected';
  const testFramework = stack.patterns.testFramework ?? 'none detected';
  const testDir = stack.patterns.testDirectory ?? 'none detected';
  const buildCommandsSection = buildBuildCommandsSection(stack);

  return template
    .replace(/{{PROJECT_NAME}}/g, stack.projectName)
    .replace(/{{PRIMARY_LANGUAGE}}/g, stack.primaryLanguage.name)
    .replace(/{{FRAMEWORKS}}/g, frameworks)
    .replace(/{{PACKAGE_MANAGER}}/g, stack.patterns.packageManager)
    .replace(/{{HAS_TYPESCRIPT}}/g, stack.patterns.hasTypeScript ? 'Yes' : 'No')
    .replace(/{{STACK_SUMMARY}}/g, buildStackSummary(stack))
    .replace(/{{NAMING_CONVENTION}}/g, stack.patterns.namingConvention)
    .replace(/{{LINTER}}/g, linter)
    .replace(/{{FORMATTER}}/g, formatter)
    .replace(/{{TEST_FRAMEWORK}}/g, testFramework)
    .replace(/{{TEST_DIRECTORY}}/g, testDir)
    .replace(/{{KEY_FILES}}/g, buildKeyFilesList(stack))
    .replace(/{{BUILD_COMMANDS}}/g, buildCommandsSection)
    .replace(/{{PERSONA_DIRECTIVE}}/g, buildPersonaDirective(stack))
    .replace(/{{FRAMEWORK_OVERLAY}}/g, frameworkOverlay);
}

interface GenerateInstructionsOptions {
  refreshExisting?: boolean;
  /** When true, skip overwriting copilot-instructions.md if it already exists. */
  preserveContextFiles?: boolean;
  config?: AiOsConfig;
}

/** Enforce an 8 KB cap on copilot-instructions.md. Truncates framework overlay if needed. */
function enforceSizeCap(content: string, maxBytes = 8192): string {
  const encoded = Buffer.byteLength(content, 'utf-8');
  if (encoded <= maxBytes) return content;

  // Find the FRAMEWORK_OVERLAY boundary and trim from there
  const cutIdx = content.lastIndexOf('\n---\n', Math.floor(content.length * (maxBytes / encoded)));
  if (cutIdx > 0) {
    const truncated = content.slice(0, cutIdx) + '\n\n<!-- [AI OS] content trimmed to stay within 8 KB Copilot budget -->\n';
    if (Buffer.byteLength(truncated, 'utf-8') <= maxBytes) return truncated;
  }

  // Hard truncate as last resort
  const bytes = Buffer.from(content, 'utf-8').slice(0, maxBytes - 100);
  return bytes.toString('utf-8') + '\n\n<!-- [AI OS] truncated to 8 KB Copilot budget -->\n';
}

/** Generate path-specific instruction files based on detected stack paths. */
function generatePathSpecificInstructions(stack: DetectedStack, githubDir: string): string[] {
  const files: string[] = [];
  const root = path.dirname(githubDir); // outputDir
  const instructionsDir = path.join(githubDir, 'instructions');
  const fw = stack.primaryFramework?.name ?? '';
  const primaryLang = stack.primaryLanguage.name;

  // frontend.instructions.md
  const frontendPaths = ['src/app', 'src/pages', 'components', 'pages', 'app', 'src/components'];
  const hasFrontend = frontendPaths.some(p => fs.existsSync(path.join(root, p)));
  if (hasFrontend) {
    const applyPaths = frontendPaths.filter(p => fs.existsSync(path.join(root, p)));
    const applyTo = applyPaths.map(p => `${p}/**`).join(', ');
    const content = [
      '---',
      `applyTo: "${applyTo}"`,
      '---',
      '',
      `# Frontend Rules — ${stack.projectName}`,
      '',
      `- Use ${fw || primaryLang} conventions for all UI components`,
      '- Prefer shared components in the detected components directory over new one-offs',
      stack.patterns.hasTypeScript ? '- All component props must be typed (no `any`)' : '',
      stack.patterns.namingConvention === 'PascalCase' ? '- Component files: PascalCase (e.g. `MyButton.tsx`)' : `- Component files: ${stack.patterns.namingConvention}`,
      stack.patterns.testFramework ? `- Co-locate component tests (*.test.tsx / *.spec.tsx) using ${stack.patterns.testFramework}` : '',
    ].filter(Boolean).join('\n');
    const p = path.join(instructionsDir, 'frontend.instructions.md');
    writeIfChanged(p, content);
    files.push(p);
  }

  // backend.instructions.md
  const backendPaths = ['src/api', 'server', 'routes', 'src/routes', 'api', 'src/server'];
  const hasBackend = backendPaths.some(p => fs.existsSync(path.join(root, p)));
  if (hasBackend) {
    const applyPaths = backendPaths.filter(p => fs.existsSync(path.join(root, p)));
    const applyTo = applyPaths.map(p => `${p}/**`).join(', ');
    const content = [
      '---',
      `applyTo: "${applyTo}"`,
      '---',
      '',
      `# Backend Rules — ${stack.projectName}`,
      '',
      '- Validate all external inputs at API boundaries',
      '- Never return raw error messages to clients — use structured error responses',
      '- Scope all database queries by the authenticated user/owner',
      stack.patterns.hasTypeScript ? '- Type all request/response payloads (no implicit `any`)' : '',
      '- Use async/await over callback chains',
    ].filter(Boolean).join('\n');
    const p = path.join(instructionsDir, 'backend.instructions.md');
    writeIfChanged(p, content);
    files.push(p);
  }

  // tests.instructions.md
  const testExts = ['test.ts', 'test.tsx', 'spec.ts', 'spec.tsx', 'test.js', 'spec.js'];
  const hasTestFiles = testExts.some(ext => {
    try {
      const out = fs.readdirSync(root).some(f => f.endsWith(`.${ext}`));
      return out;
    } catch { return false; }
  });
  const hasTestDir = stack.patterns.testDirectory ? fs.existsSync(path.join(root, stack.patterns.testDirectory)) : false;
  if (hasTestDir || stack.patterns.testFramework) {
    const applyTo = '**/*.test.ts, **/*.test.tsx, **/*.spec.ts, **/*.spec.tsx, **/*.test.js, **/*.spec.js';
    const content = [
      '---',
      `applyTo: "${applyTo}"`,
      '---',
      '',
      `# Test Rules — ${stack.projectName}`,
      '',
      stack.patterns.testFramework ? `- Use ${stack.patterns.testFramework} as the test framework` : '- Use the existing test framework consistently',
      stack.patterns.testDirectory ? `- Tests live in \`${stack.patterns.testDirectory}/\` or co-located (\`*.test.ts\`)` : '',
      '- One assertion concept per test (avoid multiple unrelated assertions)',
      '- Test descriptions must be descriptive: `it("returns 401 when token is missing")`',
      '- Mock external services and databases in unit tests',
      '- Do not import from `dist/` or `build/` in tests',
    ].filter(Boolean).join('\n');
    const p = path.join(instructionsDir, 'tests.instructions.md');
    writeIfChanged(p, content);
    files.push(p);
  }

  // schema.instructions.md (Prisma or SQL migrations)
  const schemaPaths = ['prisma', 'migrations', 'db/migrations', 'src/db'];
  const hasSchema = schemaPaths.some(p => fs.existsSync(path.join(root, p)));
  if (hasSchema || stack.allDependencies.includes('prisma') || stack.allDependencies.includes('@prisma/client')) {
    const applyPaths = schemaPaths.filter(p => fs.existsSync(path.join(root, p)));
    const applyTo = applyPaths.length > 0 ? applyPaths.map(p => `${p}/**`).join(', ') : 'prisma/**, migrations/**';
    const content = [
      '---',
      `applyTo: "${applyTo}"`,
      '---',
      '',
      `# Schema & Migration Rules — ${stack.projectName}`,
      '',
      '- Call `get_prisma_schema` before any model changes',
      '- Never delete columns in a single migration — deprecate then remove in the next release',
      '- Add database indexes for all foreign keys and frequently queried fields',
      '- Schema changes require a migration file — do not edit the schema without running migrate',
    ].join('\n');
    const p = path.join(instructionsDir, 'schema.instructions.md');
    writeIfChanged(p, content);
    files.push(p);
  }

  return files;
}

/** Build the persistent rules section for copilot-instructions.md */
function buildPersistentRulesSection(persistentRules: string[], stack: DetectedStack): string {
  const detectedRules: string[] = [];
  const root = stack.rootDir;

  // Add auto-detected structural rules
  if (fs.existsSync(path.join(root, 'src', 'components', 'ui'))) {
    detectedRules.push('ALWAYS use shared components from `src/components/ui` before creating new UI components');
  } else if (fs.existsSync(path.join(root, 'components', 'ui'))) {
    detectedRules.push('ALWAYS use shared components from `components/ui` before creating new UI components');
  } else if (fs.existsSync(path.join(root, 'src', 'components'))) {
    detectedRules.push('ALWAYS check `src/components` for existing components before creating new ones');
  } else if (fs.existsSync(path.join(root, 'components'))) {
    detectedRules.push('ALWAYS check `components/` for existing components before creating new ones');
  }

  const utilsPaths = ['src/lib', 'src/utils', 'lib', 'utils'];
  for (const up of utilsPaths) {
    if (fs.existsSync(path.join(root, up))) {
      detectedRules.push(`NEVER create utility functions outside \`${up}/\` — add them there instead`);
      break;
    }
  }

  // API / server routes
  const apiPaths = ['src/api', 'src/routes', 'api', 'routes', 'server/routes'];
  for (const ap of apiPaths) {
    if (fs.existsSync(path.join(root, ap))) {
      detectedRules.push(`ALWAYS add new API routes inside \`${ap}/\` following the existing file structure`);
      break;
    }
  }

  // Type definitions
  const typePaths = ['src/types', 'src/interfaces', 'types', 'interfaces'];
  for (const tp of typePaths) {
    if (fs.existsSync(path.join(root, tp))) {
      detectedRules.push(`ALWAYS define shared types and interfaces in \`${tp}/\` — do not redeclare them inline`);
      break;
    }
  }

  // Test directory
  if (stack.patterns.testDirectory) {
    detectedRules.push(`ALWAYS place new test files in \`${stack.patterns.testDirectory}/\` or co-located with their source file`);
  }

  // TypeScript strict rule
  if (stack.patterns.hasTypeScript) {
    detectedRules.push('NEVER use `any` as a type — use proper TypeScript types or `unknown`');
  }

  const allRules = [...persistentRules, ...detectedRules];
  if (allRules.length === 0) return '';

  return [
    '',
    '## Persistent Rules',
    '',
    '> These rules survive context window resets. They are enforced on every request.',
    '',
    ...allRules.map(r => `- ${r}`),
  ].join('\n');
}

/** Returns absolute paths of all managed files. */
export function generateInstructions(stack: DetectedStack, outputDir: string, options?: GenerateInstructionsOptions): string[] {
  const base = readTemplate('base-instructions.md');
  if (!base) throw new Error('Base instructions template not found');

  const config = options?.config;

  // Load primary framework template + any additional ones
  const templateKeys = new Set<string>();
  for (const fw of stack.frameworks) {
    templateKeys.add(fw.template);
  }
  // Deduplicated overlays
  const overlays = [...templateKeys].map(k => readFrameworkTemplate(k)).filter(Boolean).join('\n\n---\n\n');

  let content = fillTemplate(base, stack, overlays || `## ${stack.primaryLanguage.name} Project\n\nNo specific framework template found. Follow the general rules above.`);

  // Inject persistent rules section
  const persistentRules = config?.persistentRules ?? [];
  const persistentSection = buildPersistentRulesSection(persistentRules, stack);
  if (persistentSection) {
    content = content + persistentSection;
  }

  // Enforce 8 KB cap
  content = enforceSizeCap(content);

  const githubDir = path.join(outputDir, '.github');

  const outputPath = path.join(githubDir, 'copilot-instructions.md');
  // In safe refresh mode, preserve existing copilot-instructions.md to avoid
  // downgrading curated project rules to generic defaults.
  if (!(options?.preserveContextFiles && fs.existsSync(outputPath))) {
    writeIfChanged(outputPath, content);
  }

  // Generate .github/instructions/ai-os.instructions.md
  // This file with applyTo:"**" causes Copilot's default agent to auto-load these
  // instructions on every request, enabling MCP tools without manual activation.
  const instructionsDir = path.join(githubDir, 'instructions');

  const autoActivationContent = [
    '---',
    'applyTo: "**"',
    '---',
    '',
    `# AI OS — Active (${stack.projectName})`,
    '',
    'This repository uses **AI OS** for context-enriched Copilot assistance.',
    'The following MCP tools are available — use them proactively:',
    '',
    '| Tool | When to call |',
    '|---|---|',
    '| `get_session_context` | **At session start** — reloads MUST-ALWAYS rules and key context |',
    '| `get_project_structure` | Before exploring unfamiliar directories |',
    '| `get_stack_info` | Before suggesting any library or tooling changes |',
    '| `get_conventions` | Before writing new code in this repo |',
    '| `get_file_summary` | To understand a file without reading it fully |',
    '| `get_impact_of_change` | **Before editing any file** — shows blast radius |',
    '| `get_dependency_chain` | To trace how a module connects to the rest of the code |',
    '| `search_codebase` | To find symbols, patterns, or usage examples |',
    '| `get_env_vars` | Before referencing environment variables |',
    '| `check_for_updates` | To see if AI OS artifacts are out of date |',
    '| `get_memory_guidelines` | At task start to load memory safety protocol |',
    '| `get_repo_memory` | Before coding to recover durable repo decisions and constraints |',
    '| `remember_repo_fact` | After substantial tasks to persist verified learnings |',
    '| `get_recommendations` | To see stack-appropriate tools, extensions, and skills |',
    '| `suggest_improvements` | To surface architectural and tooling gaps |',
    '',
    '## Session Restart Protocol',
    '',
    '**When starting a new conversation or after a context window reset:**',
    '1. Call `get_session_context` → reloads MUST-ALWAYS rules, build commands, key files',
    '2. Call `get_repo_memory` → reloads durable architectural decisions',
    '3. Call `get_conventions` → reloads coding rules',
    '',
    '## Memory Protocol',
    '',
    '1. MUST start each non-trivial task by checking relevant repository memory.',
    '2. Prioritize memory-backed constraints over assumptions.',
    '3. MUST persist only verified durable facts and decisions at the end of the task.',
    '4. Do not store speculative, duplicate, or transient status notes in repo memory.',
    '',
    '## Project-State Strategy',
    '',
    'Always start by reviewing `.github/copilot-instructions.md` and aligning it to the current repository state before implementation.',
    '',
    '1. **New Project Strategy:** Create a lightweight baseline first (stack, conventions, build/test commands, key paths). Keep instructions concise and expand only when new codepaths appear.',
    '2. **Existing or Large Project Strategy:** Audit instruction drift first. If context is missing, fill architecture/build/pitfall gaps before coding so Copilot can reason with fewer retries and less token waste.',
    '',
    '## AI OS Value Mode',
    '',
    'Use AI OS to expand Copilot capabilities beyond default behavior:',
    '',
    '1. **Problem Understanding First:** Restate the objective in implementation terms, derive constraints and acceptance criteria from repo context and memory, and ask focused clarification when ambiguity changes behavior.',
    '2. **Token Spending Discipline:** Prefer targeted retrieval tools before full reads, reuse loaded context, report deltas instead of repetition, and stop exploration when confidence is sufficient.',
    '3. **User-Value Delivery:** Complete tasks end-to-end when feasible (implementation plus validation), surface tradeoffs and risks clearly, and optimize for reduced user effort.',
    '',
    '## Strict Behavior Guardrails',
    '',
    '1. MUST ask clarifying questions first when a request is ambiguous, underspecified, or outside described scope.',
    '2. MUST NOT improvise requirements, API contracts, or migration scope beyond explicit instructions.',
    '3. MUST avoid silent fallback for core runtime failures; return explicit diagnostics instead.',
    '',
    '### Allowed Actions',
    '',
    '- Read relevant context and repository memory before implementation.',
    '- Apply minimal in-scope edits and validate with non-destructive checks.',
    '',
    '### Forbidden Actions',
    '',
    '- Destructive operations without explicit approval.',
    '- Broad refactors or architecture changes without confirmation.',
    '- Writing speculative or transient notes into repo memory.',
    '',
    '### Escalation Flow (When Ambiguous)',
    '',
    '1. State what is unclear and what assumptions would change behavior.',
    '2. Ask focused clarifying question(s) with bounded options.',
    '3. Continue after clarification; if unavailable, take safest minimal action and document limits.',
    '',
    '## Update AI OS',
    '',
    'If `check_for_updates` returns an available update, run:',
    '```bash',
    'npx -y github:marinvch/ai-os --refresh-existing',
    '```',
    'This refreshes all context docs, agent files, skills, and MCP tools in-place.',
  ].join('\n');

  const autoActivationPath = path.join(instructionsDir, 'ai-os.instructions.md');
  writeIfChanged(autoActivationPath, autoActivationContent);

  const outputFiles = [outputPath, autoActivationPath];

  // Generate path-specific instruction files if enabled
  if (config?.pathSpecificInstructions !== false) {
    const pathSpecificFiles = generatePathSpecificInstructions(stack, githubDir);
    outputFiles.push(...pathSpecificFiles);
  }

  return outputFiles;
}
