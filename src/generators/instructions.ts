import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DetectedStack, AiOsConfig } from '../types.js';
import { writeIfChanged, resolveTemplatesDir, sanitizeForInstructions } from './utils.js';

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
    lines.push(`- **${sanitizeForInstructions(lang.name)}** (${lang.percentage}% of codebase, ${lang.fileCount} files)`);
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
  const fw = stack.primaryFramework ? sanitizeForInstructions(stack.primaryFramework.name) : null;
  const lang = sanitizeForInstructions(stack.primaryLanguage.name);
  if (fw) return `Act as a Senior ${fw} developer with deep expertise in ${lang} and the full ${fw} ecosystem.`;
  return `Act as a Senior ${lang} developer.`;
}

/** Discover installed skills from canonical and legacy paths, return a Skill Routing section, or '' if no skills. */
function buildSkillRoutingSection(outputDir: string): string {
  const canonicalSkillsDir = path.join(outputDir, '.github', 'skills');
  const legacySkillsDir = path.join(outputDir, '.github', 'copilot', 'skills');

  const rows: string[] = [];

  // Scan new canonical path: .github/skills/<name>/SKILL.md (#255)
  if (fs.existsSync(canonicalSkillsDir)) {
    for (const entry of fs.readdirSync(canonicalSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(canonicalSkillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;
      try {
        const raw = fs.readFileSync(skillMdPath, 'utf-8');
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1]?.trim() ?? entry.name;
        const desc = descMatch?.[1]?.trim() ?? '';
        rows.push(`| \`${name}\` | ${desc} |`);
      } catch { /* skip unreadable files */ }
    }
  }

  // Also scan legacy flat path: .github/copilot/skills/*.md (skip duplicates)
  if (fs.existsSync(legacySkillsDir)) {
    for (const file of fs.readdirSync(legacySkillsDir)) {
      if (!file.endsWith('.md')) continue;
      try {
        const raw = fs.readFileSync(path.join(legacySkillsDir, file), 'utf-8');
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1]?.trim() ?? file.replace('.md', '');
        const desc = descMatch?.[1]?.trim() ?? '';
        if (!rows.some(r => r.includes(`\`${name}\``))) {
          rows.push(`| \`${name}\` | ${desc} |`);
        }
      } catch { /* skip unreadable files */ }
    }
  }

  if (rows.length === 0) return '';

  return [
    '',
    '## Available Skills',
    '',
    '| Skill | Trigger (auto-activates when prompt matches) |',
    '|---|---|',
    ...rows,
    '',
    '---',
    '',
  ].join('\n');
}

function fillTemplate(template: string, stack: DetectedStack, frameworkOverlay: string, outputDir: string): string {
  const s = sanitizeForInstructions;
  const frameworks = stack.frameworks.map(f => s(f.name)).join(', ') || s(stack.primaryLanguage.name);
  const linter = s(stack.patterns.linter ?? 'none detected');
  const formatter = s(stack.patterns.formatter ?? 'none detected');
  const testFramework = s(stack.patterns.testFramework ?? 'none detected');
  const testDir = s(stack.patterns.testDirectory ?? 'none detected');
  const buildCommandsSection = buildBuildCommandsSection(stack);
  const skillRoutingSection = buildSkillRoutingSection(outputDir);

  return template
    .replace(/{{PROJECT_NAME}}/g, s(stack.projectName))
    .replace(/{{PRIMARY_LANGUAGE}}/g, s(stack.primaryLanguage.name))
    .replace(/{{FRAMEWORKS}}/g, frameworks)
    .replace(/{{PACKAGE_MANAGER}}/g, s(stack.patterns.packageManager))
    .replace(/{{HAS_TYPESCRIPT}}/g, stack.patterns.hasTypeScript ? 'Yes' : 'No')
    .replace(/{{STACK_SUMMARY}}/g, buildStackSummary(stack))
    .replace(/{{NAMING_CONVENTION}}/g, s(stack.patterns.namingConvention))
    .replace(/{{LINTER}}/g, linter)
    .replace(/{{FORMATTER}}/g, formatter)
    .replace(/{{TEST_FRAMEWORK}}/g, testFramework)
    .replace(/{{TEST_DIRECTORY}}/g, testDir)
    .replace(/{{KEY_FILES}}/g, buildKeyFilesList(stack))
    .replace(/{{BUILD_COMMANDS}}/g, buildCommandsSection)
    .replace(/{{SKILL_ROUTING}}/g, skillRoutingSection)
    .replace(/{{PERSONA_DIRECTIVE}}/g, buildPersonaDirective(stack))
    .replace(/{{FRAMEWORK_OVERLAY}}/g, frameworkOverlay);
}

interface GenerateInstructionsOptions {
  refreshExisting?: boolean;
  /** When true, skip overwriting copilot-instructions.md if it already exists. */
  preserveContextFiles?: boolean;
  config?: AiOsConfig;
}

/** Enforce an 8 KB cap on copilot-instructions.md. Truncates at the last section boundary that fits. */
function enforceSizeCap(content: string, maxBytes = 8192): string {
  const encoded = Buffer.byteLength(content, 'utf-8');
  if (encoded <= maxBytes) return content;

  const TRIM_NOTICE = '\n\n<!-- [AI OS] content trimmed to stay within 8 KB Copilot budget -->\n';
  const noticeBytes = Buffer.byteLength(TRIM_NOTICE, 'utf-8');
  const budget = maxBytes - noticeBytes;

  // Find all section separator positions (handles both \n---\n and \r\n---\r\n)
  const SEP_RE = /\r?\n---\r?\n/g;
  const separators: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = SEP_RE.exec(content)) !== null) {
    separators.push(m.index);
  }

  // Pick the last separator whose preceding content fits within the budget
  for (let i = separators.length - 1; i >= 0; i--) {
    const slice = content.slice(0, separators[i]);
    if (Buffer.byteLength(slice, 'utf-8') <= budget) {
      return slice + TRIM_NOTICE;
    }
  }

  // Hard truncate as last resort (no separator found within budget)
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
function buildMonorepoSection(stack: DetectedStack): string {
  const profiles = stack.packageProfiles;
  if (!profiles || profiles.length <= 1 || !stack.patterns.monorepo) return '';

  const rows = profiles
    .filter(p => p.path !== '.')
    .map(p => {
      const fws = p.frameworks.map(f => sanitizeForInstructions(f.name)).join(', ') || (p.languages[0]?.name ?? 'Unknown');
      return `| \`${p.path}\` | ${fws} |`;
    });

  if (rows.length === 0) return '';

  return [
    '',
    '## Monorepo Packages',
    '',
    '| Package | Stack |',
    '|---|---|',
    ...rows,
    '',
    '> When modifying shared code, check all packages above for impact.',
  ].join('\n');
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

  let content = fillTemplate(base, stack, overlays || `## ${stack.primaryLanguage.name} Project\n\nNo specific framework template found. Follow the general rules above.`, outputDir);

  // Inject monorepo section if applicable
  const monorepoSection = buildMonorepoSection(stack);
  if (monorepoSection) {
    content = content + monorepoSection;
  }

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

  // Lean auto-activation: only unique content not already in copilot-instructions.md.
  // Duplicate sections (MCP table, memory protocol, guardrails, agentic safety) are
  // omitted to reduce token overhead on every Copilot request.
  const autoActivationContent = [
    '---',
    'applyTo: "**"',
    '---',
    '',
    `# AI OS — Active (${stack.projectName})`,
    '',
    'AI OS MCP tools are available. **Session start:** call `get_session_context` → `get_repo_memory` → `get_conventions` → `get_active_plan`.',
    '',
    '**Quick reference:** `search_codebase` · `get_file_summary` · `get_impact_of_change` · `get_dependency_chain` · `get_project_structure` · `get_stack_info` · `get_env_vars` · `check_for_updates` · `remember_repo_fact` · `suggest_improvements` · `get_recommendations`',
    '',
    '## Value Mode',
    '',
    '1. **Problem first:** derive constraints from repo context and memory before writing code.',
    '2. **Targeted tools:** prefer retrieval tools over full file reads; stop exploring when confident.',
    '3. **End-to-end:** implement + validate + surface tradeoffs, optimise for reduced user effort.',
    '',
    '## Update AI OS',
    '',
    'Run `npx -y github:marinvch/ai-os --refresh-existing` when `check_for_updates` signals a new version.',
  ].join('\n');

  const autoActivationPath = path.join(instructionsDir, 'ai-os.instructions.md');
  writeIfChanged(autoActivationPath, autoActivationContent);

  const outputFiles = [outputPath, autoActivationPath];

  // Generate path-specific instruction files if enabled
  if (config?.pathSpecificInstructions !== false) {
    const pathSpecificFiles = generatePathSpecificInstructions(stack, githubDir);
    outputFiles.push(...pathSpecificFiles);
  }

  // Generate Prompt Quality Pack unless explicitly disabled
  if (config?.promptQualityPack !== false) {
    const pqpPath = generatePromptQualityPack(stack, outputDir, githubDir, options?.preserveContextFiles);
    if (pqpPath) outputFiles.push(pqpPath);
  }

  return outputFiles;
}

function generatePromptQualityPack(stack: DetectedStack, outputDir: string, githubDir: string, preserveContextFiles?: boolean): string | null {
  const agentsDir = path.join(outputDir, '.github', 'agents');
  const canonicalSkillsDir = path.join(outputDir, '.github', 'skills');
  const legacySkillsDir = path.join(outputDir, '.github', 'copilot', 'skills');

  // Discover installed agents
  const agentRows: string[] = [];
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith('.agent.md')) continue;
      try {
        const raw = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const argHintMatch = raw.match(/^argument-hint:\s*"?(.+?)"?$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1]?.trim() ?? file.replace('.agent.md', '');
        const argHint = argHintMatch?.[1]?.trim() ?? '';
        const desc = descMatch?.[1]?.trim() ?? '';
        agentRows.push(`| \`${name}\` | ${desc} | ${argHint} |`);
      } catch {
        // skip unreadable agent files
      }
    }
  }

  // Discover installed skills — check canonical path and legacy path (#255)
  const skillRows: string[] = [];
  if (fs.existsSync(canonicalSkillsDir)) {
    for (const entry of fs.readdirSync(canonicalSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(canonicalSkillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;
      try {
        const raw = fs.readFileSync(skillMdPath, 'utf-8');
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const triggerMatch = raw.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1]?.trim() ?? entry.name;
        const trigger = triggerMatch?.[1]?.trim() ?? '';
        skillRows.push(`| \`${name}\` | ${trigger} |`);
      } catch {
        // skip unreadable skill files
      }
    }
  }
  if (fs.existsSync(legacySkillsDir)) {
    for (const file of fs.readdirSync(legacySkillsDir)) {
      if (!file.endsWith('.md')) continue;
      try {
        const raw = fs.readFileSync(path.join(legacySkillsDir, file), 'utf-8');
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const triggerMatch = raw.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1]?.trim() ?? file.replace('.md', '');
        const trigger = triggerMatch?.[1]?.trim() ?? '';
        if (!skillRows.some(r => r.includes(`\`${name}\``))) {
          skillRows.push(`| \`${name}\` | ${trigger} |`);
        }
      } catch {
        // skip unreadable skill files
      }
    }
  }

  const agentTable = agentRows.length > 0
    ? ['| Agent | Description | When to use |', '|---|---|---|', ...agentRows].join('\n')
    : '_No agents installed yet._';

  const skillTable = skillRows.length > 0
    ? ['| Skill | Trigger phrase / description |', '|---|---|', ...skillRows].join('\n')
    : '_No skills installed yet._';

  const frameworks = stack.frameworks.map(f => f.name).join(', ');
  const stackMetaLine = frameworks
    ? `> Stack: **${frameworks}** · Language: **${stack.primaryLanguage.name}** · Package manager: **${stack.patterns.packageManager}**`
    : `> Language: **${stack.primaryLanguage.name}** · Package manager: **${stack.patterns.packageManager}**`;
  const buildCmd = stack.buildCommands?.build ?? 'npm run build';
  const testCmd = stack.buildCommands?.test ?? 'npm test';
  const contextSyncCmd = 'npx -y github:marinvch/ai-os --refresh-existing';

  const content = [
    '---',
    'applyTo: "**"',
    '---',
    '',
    `# Prompt Quality Pack — ${stack.projectName}`,
    '',
    stackMetaLine,
    '',
    '## 1. Prompt Template',
    '',
    'Use this structure for best results:',
    '',
    '```',
    'Goal: <one sentence — what should be accomplished>',
    'Scope: #file:<path> or describe the affected area',
    'Constraints: <framework rules, must-nots, or size limits>',
    'Agent: <agent name if a specialist is needed>',
    'Skill: <skill keyword if domain-specific guidance is needed>',
    'Done-when: <acceptance criteria — how will we know it worked?>',
    '```',
    '',
    '## 2. Agent Routing Table',
    '',
    'Use `@<agent-name>` to invoke a specialist agent:',
    '',
    agentTable,
    '',
    '## 3. Model Routing',
    '',
    'Each phase of the development workflow uses a specific model. Apply these when invoking the `task` tool or specialist agents:',
    '',
    '| Phase | Task | Model |',
    '|---|---|---|',
    '| 1 — Brainstorm | Exploring ideas, clarifying requirements, writing design spec | `claude-sonnet-4.6` |',
    '| 2 — Validate spec | Reviewing design doc, spec consistency checks, spec self-review | `gpt-5.3-codex` |',
    '| 3 — Execute | Implementation, writing code, file changes, refactoring | `claude-sonnet-4.6` |',
    '| 4 — Validate implementation | Code review, verifying acceptance criteria, integration checks | `gpt-5.3-codex` |',
    '',
    '> **Why:** Sonnet 4.6 excels at creative problem-solving and generation; Codex models excel at rigorous code analysis and consistency verification. Alternating gives you the best of both.',
    '',
    '## 4. Skill Trigger Keywords',
    '',
    'Skills load automatically when your prompt matches their description:',
    '',
    skillTable,
    '',
    '## 5. MCP Health Check',
    '',
    'Verify the MCP server is connected before starting a session.',
    'If `get_session_context` or `get_repo_memory` returns no output, the server is not running.',
    'Restart it via the VS Code MCP panel or re-run the install.',
    '',
    '## 6. Plan-Mode Trigger',
    '',
    'Switch to **Plan mode** first when:',
    '- The task has 3 or more sequential steps',
    '- The change is irreversible (delete, drop, migrate, deploy)',
    '- Multiple files or systems are affected',
    '',
    '## 7. Post-Change Context Refresh',
    '',
    'After structural changes (new dependencies, new files, architecture moves), refresh AI OS context:',
    '',
    '```bash',
    contextSyncCmd,
    '```',
    '',
    '## 8. Anti-Patterns',
    '',
    '- **Mixing concerns** — one prompt should do one thing',
    `- **Vague \`#codebase\`** when a specific file path is known — use \`#file:<path>\``,
    '- **Accepting unsourced claims** — verify with `get_repo_memory` or `search_codebase`',
    '- **Skipping Plan mode** for irreversible changes',
    '- **Ignoring stale context** — run `check_for_updates` if output quality drops',
  ].join('\n');

  const instructionsDir = path.join(githubDir, 'instructions');
  if (!fs.existsSync(instructionsDir)) {
    fs.mkdirSync(instructionsDir, { recursive: true });
  }
  const outputPath = path.join(instructionsDir, 'prompt-quality.instructions.md');
  // Preserve existing prompt-quality.instructions.md in safe refresh mode (#255)
  if (preserveContextFiles && fs.existsSync(outputPath)) return outputPath;
  writeIfChanged(outputPath, content);
  return outputPath;
}
