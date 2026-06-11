/**
 * chatmodes.ts — generates .vscode/*.chatprompt.md custom chat mode files.
 *
 * Custom chat modes are a VS Code v1.101 Preview feature. They let you define
 * named modes (alongside Ask / Edit / Agent) with custom instructions and a
 * restricted tool list. Files are placed in .vscode/ so VS Code discovers them
 * automatically via the default `chat.promptFilesLocations` setting.
 *
 * @see https://code.visualstudio.com/updates/v1_101#_custom-chat-modes-preview
 */
import path from 'node:path';
import type { DetectedStack } from '../types.js';
import { writeIfChanged, sanitizeForInstructions } from './utils.js';

interface ChatMode {
  filename: string;
  description: string;
  tools: string[];
  instructions: string;
}

// ── Built-in VS Code tools usable in chat mode tool lists ──────────────────────
//    https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode#_built-in-tools
const BUILTIN_READ_ONLY = ['codebase', 'fetch', 'findTestFiles', 'githubRepo', 'search', 'usages'];

// ── Mode definitions ───────────────────────────────────────────────────────────

function getPlanMode(stack: DetectedStack): ChatMode {
  const fw = stack.primaryFramework ? sanitizeForInstructions(stack.primaryFramework.name) : sanitizeForInstructions(stack.primaryLanguage.name);
  return {
    filename: 'ai-os-plan.chatprompt.md',
    description: `Generate an implementation plan for ${fw} features or refactoring tasks (read-only, no edits)`,
    tools: [
      ...BUILTIN_READ_ONLY,
      'get_session_context',
      'get_conventions',
      'get_repo_memory',
      'get_project_structure',
      'get_file_summary',
      'get_stack_info',
      'get_impact_of_change',
      'get_dependency_chain',
      'get_active_plan',
      'upsert_active_plan',
    ],
    instructions: `# AI OS — Planning Mode

You are in **planning mode**. Your task is to produce an implementation plan.
Do **not** make any code edits — generate a plan document only.

Use the AI OS context tools to load conventions and repo memory before planning.
Always call \`get_session_context\` first to reload MUST-ALWAYS rules.

## Plan format

Return a Markdown document with:

- **Goal** — one-sentence objective
- **Constraints** — must-nots, framework rules, size limits
- **Acceptance Criteria** — how we know the task is done
- **Implementation Steps** — ordered, with file paths and function names
- **Testing** — what tests need to pass or be added
- **Risk / Rollback** — what could go wrong and how to undo it
`,
  };
}

function getReviewMode(stack: DetectedStack): ChatMode {
  const lang = sanitizeForInstructions(stack.primaryLanguage.name);
  return {
    filename: 'ai-os-review.chatprompt.md',
    description: `Code review mode for ${lang} — no edits, returns structured review with severity levels`,
    tools: [
      'codebase',
      'search',
      'usages',
      'findTestFiles',
      'get_session_context',
      'get_conventions',
      'get_repo_memory',
      'get_file_summary',
      'get_impact_of_change',
      'get_dependency_chain',
    ],
    instructions: `# AI OS — Review Mode

You are in **code review mode**. Analyse the requested code and return a
structured review. Do **not** make any edits directly — return findings only.

Always call \`get_session_context\` and \`get_conventions\` first to reload
project-specific rules before reviewing.

## Review format

Return a Markdown document with findings grouped by severity:

| Severity | Meaning |
|---|---|
| 🔴 Critical | Security vulnerability, data loss risk, crash |
| 🟠 High | Logic bug, broken contract, performance hazard |
| 🟡 Medium | Code smell, missing test, brittle pattern |
| 🔵 Low | Style issue, minor clarity improvement |
| ℹ️ FYI | Observation with no action required |

For each finding include: **file:line**, **severity**, **description**, and
**suggested fix** (no code edits, just guidance).
`,
  };
}

function getExploreMode(): ChatMode {
  return {
    filename: 'ai-os-explore.chatprompt.md',
    description: 'Read-only codebase exploration — answers "how does X work?" questions without editing files',
    tools: [
      ...BUILTIN_READ_ONLY,
      'get_session_context',
      'get_project_structure',
      'get_file_summary',
      'get_stack_info',
      'search_codebase',
      'get_dependency_chain',
      'get_impact_of_change',
      'get_api_routes',
      'get_env_vars',
    ],
    instructions: `# AI OS — Explore Mode

You are in **read-only exploration mode**. Answer questions about the codebase
without making any edits.

Use AI OS navigation tools to answer "how does X work?" questions efficiently:
- Call \`get_project_structure\` before exploring unfamiliar directories
- Call \`get_file_summary\` instead of reading full files when possible
- Call \`search_codebase\` to find symbols, patterns, or usage examples
- Call \`get_dependency_chain\` to trace how a module connects to the rest

Return clear, grounded answers with file paths and line references.
`,
  };
}

// ── Serialiser ─────────────────────────────────────────────────────────────────

function renderChatMode(mode: ChatMode): string {
  const toolList = mode.tools.map((t) => `'${t}'`).join(', ');
  // Quote description to prevent YAML parse failures on framework names
  // that contain colons, brackets, or other YAML-special characters.
  const safeDescription = mode.description.replace(/"/g, "'");
  return `---
description: "${safeDescription}"
tools: [${toolList}]
---
${mode.instructions}`;
}

// ── Main generator ─────────────────────────────────────────────────────────────

export function generateChatModes(stack: DetectedStack, outputDir: string): string[] {
  const managed: string[] = [];
  const vscodePath = path.join(outputDir, '.vscode');

  const modes: ChatMode[] = [
    getPlanMode(stack),
    getReviewMode(stack),
    getExploreMode(),
  ];

  for (const mode of modes) {
    const filePath = path.join(vscodePath, mode.filename);
    writeIfChanged(filePath, renderChatMode(mode));
    managed.push(filePath);
  }

  return managed;
}
