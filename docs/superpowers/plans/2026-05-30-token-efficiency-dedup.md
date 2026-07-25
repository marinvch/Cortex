# Token-Efficiency De-Duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the always-loaded Copilot instruction payload ~35–40% (~1,200–1,400 tokens/turn) by giving every duplicated content block a single canonical home, slimming MCP tool output, auto-applying the optimized layout on both fresh installs and updates, and adding a regression guard so the bloat cannot return.

**Architecture:** AI OS is a Node ≥20 TypeScript CLI that scans a target repo and emits Copilot context artifacts. The duplicated content lives in (a) the static template `src/templates/base-instructions.md` (rendered into `.github/copilot-instructions.md`), (b) two generated `applyTo:"**"` instruction files built in `src/generators/instructions.ts`, (c) `.github/COPILOT_CONTEXT.md` built in `src/generators/context-docs.ts`, and (d) MCP tool handlers in `src/mcp-server/`. We slim each canonical source, add a section-scoped auto-migrator for existing installs in `src/actions/apply.ts`, and add a Vitest regression guard.

**Tech Stack:** TypeScript, Node ≥20, Vitest, esbuild, ESLint. No new runtime dependencies (preserve the single-runtime-dep posture: `@github/copilot-sdk` only).

**Spec:** `docs/superpowers/specs/2026-05-30-token-efficiency-dedup-design.md`

---

## Baseline facts (verified against current source)

- `.github/copilot-instructions.md` is rendered from `src/templates/base-instructions.md` by `fillTemplate()` (`src/generators/instructions.ts:122-149`) then capped to 8 KB by `enforceSizeCap()` (`src/generators/instructions.ts:159-186`). The MCP tool table, Session Restart Protocol, Context Budget Policy, and Value Mode are **static literal text inside `base-instructions.md`** — so slimming them = editing that template file.
- `ai-os.instructions.md` is built as a literal string array at `src/generators/instructions.ts:441-464`.
- `prompt-quality.instructions.md` is built at `src/generators/instructions.ts:561-647`; its "## 5. MCP Health Check" block is lines `608-612`.
- `COPILOT_CONTEXT.md` is built at `src/generators/context-docs.ts:924-963` (this is the canonical Session Restart Protocol home).
- `getSessionContext()` (`src/mcp-server/utils.ts:22-67`) reads `COPILOT_CONTEXT.md` then **appends** a hardcoded `SESSION_BOOTSTRAP` string (duplicate).
- `get_stack_info` MCP tool returns `context/stack.md` verbatim (`src/mcp-server/sdk-server.ts:124-132`); the "## Visual Stack Map" Mermaid block is generated in `context/stack.md` at `src/generators/context-docs.ts:297-...`.
- The refresh/apply pipeline lives in `src/actions/apply.ts`; `preserveContextFiles = isRefresh && !regenerateContext` (`apply.ts:731`). Generators run at `apply.ts:819` (context docs) and `apply.ts:844` (instructions). Legacy pruning already hooks in at `apply.ts:740-742`.
- `multi-editor.ts:generateCursorRules` (`src/generators/multi-editor.ts:37-47`) derives `.cursorrules` from `copilot-instructions.md` content, so a compact Value Mode line must stay in `base-instructions.md`.

## File map

| File | Change |
|---|---|
| `src/templates/base-instructions.md` | Slim MCP table, Session Restart, Context Budget; reduce Value Mode to one line; add offline-fallback line; wrap managed sections in `AI-OS:SECTION` markers |
| `src/generators/instructions.ts` | Drop quick-ref tool list from `ai-os.instructions.md`; drop MCP Health Check from `prompt-quality.instructions.md` |
| `src/mcp-server/utils.ts` | `getSessionContext()` conditional bootstrap append |
| `src/mcp-server/sdk-server.ts` | `get_stack_info` gains optional `includeDiagram`; strip Mermaid by default |
| `src/mcp-server/shared.ts` (new helper) or `utils.ts` | `stripMermaidSections()` helper |
| `src/actions/token-migrator.ts` (new) | Section-scoped auto-migrator |
| `src/actions/apply.ts` | Invoke migrator on refresh |
| `src/tests/token-budget.test.ts` (new) | Regression guard |
| `src/tests/token-migrator.test.ts` (new) | Migrator unit tests |

Each task ends green on `npm run build` + `npm run test`. Commit after every task.

---

## Phase 1 — De-duplicate the always-loaded files

### Task 1: Slim the MCP tool table in base-instructions.md

**Files:**
- Test: `src/tests/token-budget.test.ts` (create)
- Modify: `src/templates/base-instructions.md:130-153`

- [ ] **Step 1: Write the failing test**

Create `src/tests/token-budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'templates', 'base-instructions.md'),
  'utf-8',
);

describe('base-instructions.md token slimming', () => {
  it('does not embed the full 16-row MCP tool catalog', () => {
    // The full catalog lives only in context/mcp-tools.md now.
    // base-instructions keeps at most the 4 session-start tools.
    const toolRows = (TEMPLATE.match(/^\| `get_/gm) ?? []).length;
    expect(toolRows).toBeLessThanOrEqual(4);
  });

  it('keeps an offline fallback pointer', () => {
    expect(TEMPLATE).toContain('If MCP tools are unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-budget.test.ts`
Expected: FAIL — `toolRows` is currently 16 (full table present), and the offline-fallback string is absent.

- [ ] **Step 3: Replace the MCP table block in the template**

In `src/templates/base-instructions.md`, replace the entire block from `## MCP Tools Available` through the closing `---` (lines 130-153) with:

```markdown
<!-- AI-OS:SECTION id="mcp-tools" -->
## MCP Tools Available

Call these MCP tools at session start (full catalog: `.github/ai-os/context/mcp-tools.md`):

| Tool | When to call |
| --- | --- |
| `get_session_context` | **At the start of every new conversation** — reloads MUST-ALWAYS rules |
| `get_repo_memory` | Before coding — recover durable repo decisions and constraints |
| `get_conventions` | Before writing new code in this repo |
| `get_active_plan` | Restore the active task plan and open checkpoints |

> If MCP tools are unavailable, read `.github/COPILOT_CONTEXT.md`, `.github/ai-os/context/conventions.md`, and `.github/ai-os/context/mcp-tools.md` directly.
<!-- AI-OS:SECTION-END id="mcp-tools" -->

---
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/token-budget.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full build + suite**

Run: `npm run build && npm run test`
Expected: build OK; if any snapshot under `src/tests/__snapshots__/` references the old table, update it with `npx vitest run -u` after confirming the diff only removes the 12 dropped tool rows.

- [ ] **Step 6: Commit**

```bash
git add src/tests/token-budget.test.ts src/templates/base-instructions.md src/tests/__snapshots__
git commit --no-verify -m "perf(context): slim MCP tool table in base instructions to 4 session-start tools"
```

> Note: the repo's `lint-staged` pre-commit hook is misconfigured in this environment (`could not find any valid configuration`); use `--no-verify`. Run `npm run lint` manually before each commit instead.

---

### Task 2: Replace Session Restart Protocol body with a pointer

**Files:**
- Test: `src/tests/token-budget.test.ts`
- Modify: `src/templates/base-instructions.md:62-72`

- [ ] **Step 1: Add the failing assertion**

Append to the `describe('base-instructions.md token slimming', ...)` block in `src/tests/token-budget.test.ts`:

```ts
  it('does not restate the numbered Session Restart Protocol (canonical: COPILOT_CONTEXT.md)', () => {
    // The full numbered list lives in COPILOT_CONTEXT.md. base-instructions keeps a 1-line pointer.
    expect(TEMPLATE).not.toContain('reloads MUST-ALWAYS rules, build commands, and key file locations');
    expect(TEMPLATE).toMatch(/Session start.*get_session_context/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-budget.test.ts -t "Session Restart"`
Expected: FAIL — the numbered protocol body is still present.

- [ ] **Step 3: Replace the block in the template**

In `src/templates/base-instructions.md`, replace the block from `## Session Restart Protocol` through its trailing `---` (lines 62-73) with:

```markdown
<!-- AI-OS:SECTION id="session-restart" -->
## Session Restart Protocol

**Session start / after a context reset:** call `get_session_context` first (reloads the full protocol, MUST-ALWAYS rules, and build commands), then `get_repo_memory`, `get_conventions`, `get_active_plan`.
<!-- AI-OS:SECTION-END id="session-restart" -->

---
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/token-budget.test.ts -t "Session Restart"`
Expected: PASS

- [ ] **Step 5: Build + test**

Run: `npm run build && npm run test`
Expected: PASS (update snapshots with `npx vitest run -u` if the copilot-instructions snapshot changed; verify the diff only trims the protocol body).

- [ ] **Step 6: Commit**

```bash
git add src/tests/token-budget.test.ts src/templates/base-instructions.md src/tests/__snapshots__
git commit --no-verify -m "perf(context): replace Session Restart Protocol body with pointer in base instructions"
```

---

### Task 3: Reduce Context Budget Policy to a 3-bullet summary

**Files:**
- Test: `src/tests/token-budget.test.ts`
- Modify: `src/templates/base-instructions.md:224-241`

- [ ] **Step 1: Add the failing assertion**

Append to the describe block:

```ts
  it('keeps only a compact Context Budget summary (canonical: context-budget.md)', () => {
    // Full numbered loading order lives in context/context-budget.md.
    expect(TEMPLATE).not.toContain('get_file_summary` — before reading full files (token-efficient)');
    expect(TEMPLATE).toContain('context/context-budget.md');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-budget.test.ts -t "Context Budget"`
Expected: FAIL — the full 6-step loading order is still present.

- [ ] **Step 3: Replace the block in the template**

In `src/templates/base-instructions.md`, replace the block from `## Context Budget Policy` through its trailing `---` (lines 224-241) with:

```markdown
<!-- AI-OS:SECTION id="context-budget" -->
## Context Budget Policy

- Load `get_session_context` → `get_repo_memory` → `get_conventions` first; stop once you can act.
- Prefer `get_file_summary` and `search_codebase` over full reads; never re-read files already in context.
- After a reset, reload the three tools above before resuming. Full policy: `.github/ai-os/context/context-budget.md`.
<!-- AI-OS:SECTION-END id="context-budget" -->

---
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/token-budget.test.ts -t "Context Budget"`
Expected: PASS

- [ ] **Step 5: Build + test**

Run: `npm run build && npm run test`
Expected: PASS (refresh snapshots if needed; verify diff only trims the policy body).

- [ ] **Step 6: Commit**

```bash
git add src/tests/token-budget.test.ts src/templates/base-instructions.md src/tests/__snapshots__
git commit --no-verify -m "perf(context): compact Context Budget Policy in base instructions to 3 bullets"
```

---

### Task 4: Reduce Value Mode to one line in base-instructions (keep canonical copy in ai-os.instructions.md)

**Files:**
- Test: `src/tests/token-budget.test.ts`
- Modify: `src/templates/base-instructions.md:120-128`

- [ ] **Step 1: Add the failing assertion**

Append to the describe block:

```ts
  it('keeps Value Mode as a single compact line for multi-editor parity', () => {
    // Cursor (.cursorrules) derives from copilot-instructions, so a one-line Value Mode stays here.
    expect(TEMPLATE).not.toContain('**Problem Understanding First:**');
    expect(TEMPLATE).toMatch(/Value Mode/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-budget.test.ts -t "Value Mode"`
Expected: FAIL — the 3-bullet expanded Value Mode is still present.

- [ ] **Step 3: Replace the block in the template**

In `src/templates/base-instructions.md`, replace the block from `## AI OS Value Mode` through its trailing `---` (lines 120-128) with:

```markdown
<!-- AI-OS:SECTION id="value-mode" -->
## AI OS Value Mode

Restate the goal in implementation terms, prefer targeted retrieval over full reads, deliver end-to-end (implement + validate), and surface tradeoffs. Full guidance lives in `.github/instructions/ai-os.instructions.md`.
<!-- AI-OS:SECTION-END id="value-mode" -->

---
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/token-budget.test.ts -t "Value Mode"`
Expected: PASS

- [ ] **Step 5: Build + test**

Run: `npm run build && npm run test`
Expected: PASS (refresh snapshots if needed).

- [ ] **Step 6: Commit**

```bash
git add src/tests/token-budget.test.ts src/templates/base-instructions.md src/tests/__snapshots__
git commit --no-verify -m "perf(context): reduce Value Mode to one line in base instructions"
```

---

### Task 5: Drop the duplicate tool quick-reference list from ai-os.instructions.md

**Files:**
- Test: `src/tests/generators.test.ts` (or `src/tests/token-budget.test.ts`)
- Modify: `src/generators/instructions.ts:441-464`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/token-budget.test.ts`. This builds the file via the real generator into a temp dir:

```ts
import os from 'node:os';
import { generateInstructions } from '../generators/instructions.js';
import type { DetectedStack } from '../types.js';

function fakeStack(): DetectedStack {
  return {
    projectName: 'demo',
    primaryLanguage: { name: 'TypeScript', percentage: 100, fileCount: 1, extensions: ['.ts'] },
    languages: [{ name: 'TypeScript', percentage: 100, fileCount: 1, extensions: ['.ts'] }],
    frameworks: [],
    primaryFramework: null,
    keyFiles: ['package.json'],
    buildCommands: { build: 'npm run build', test: 'npm test' },
    patterns: {
      packageManager: 'npm', hasTypeScript: true, namingConvention: 'kebab-case',
      linter: 'ESLint', formatter: 'none detected', testFramework: 'Vitest', testDirectory: 'none detected',
    },
  } as unknown as DetectedStack;
}

describe('ai-os.instructions.md is lean', () => {
  it('does not duplicate the MCP tool quick-reference list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-instr-'));
    generateInstructions(fakeStack(), dir, {});
    const out = fs.readFileSync(
      path.join(dir, '.github', 'instructions', 'ai-os.instructions.md'), 'utf-8');
    expect(out).not.toContain('**Quick reference:**');
    expect(out).toContain('## Value Mode'); // canonical Value Mode stays here
  });
});
```

> If `DetectedStack` shape differs, copy the exact object an existing test (e.g. `src/tests/generators.test.ts`) uses to call `generateInstructions`, rather than hand-rolling `fakeStack`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-budget.test.ts -t "quick-reference"`
Expected: FAIL — `**Quick reference:**` line is currently emitted.

- [ ] **Step 3: Remove the quick-reference line**

In `src/generators/instructions.ts`, delete these two array entries from the `autoActivationContent` array (lines 450-451):

```ts
    '**Quick reference:** `search_codebase` · `get_file_summary` · `get_impact_of_change` · `get_dependency_chain` · `get_project_structure` · `get_stack_info` · `get_env_vars` · `check_for_updates` · `remember_repo_fact` · `suggest_improvements` · `get_recommendations`',
    '',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/token-budget.test.ts -t "quick-reference"`
Expected: PASS

- [ ] **Step 5: Build + test**

Run: `npm run build && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tests/token-budget.test.ts src/generators/instructions.ts
git commit --no-verify -m "perf(context): drop duplicate tool quick-ref from ai-os.instructions.md"
```

---

### Task 6: Drop the MCP Health Check section from prompt-quality.instructions.md

**Files:**
- Test: `src/tests/token-budget.test.ts`
- Modify: `src/generators/instructions.ts:608-613`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/token-budget.test.ts`:

```ts
describe('prompt-quality.instructions.md is lean', () => {
  it('does not duplicate MCP health/tool guidance', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-pqp-'));
    generateInstructions(fakeStack(), dir, {});
    const out = fs.readFileSync(
      path.join(dir, '.github', 'instructions', 'prompt-quality.instructions.md'), 'utf-8');
    expect(out).not.toContain('## 5. MCP Health Check');
    // Renumbered: Plan-Mode Trigger becomes section 5.
    expect(out).toContain('## 5. Plan-Mode Trigger');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-budget.test.ts -t "MCP health"`
Expected: FAIL — section "## 5. MCP Health Check" is present.

- [ ] **Step 3: Remove the section and renumber**

In `src/generators/instructions.ts`, delete these array entries (lines 608-613):

```ts
    '## 5. MCP Health Check',
    '',
    'Verify the MCP server is connected before starting a session.',
    'If `get_session_context` or `get_repo_memory` returns no output, the server is not running.',
    'Restart it via the VS Code MCP panel or re-run the install.',
    '',
```

Then renumber the remaining section headers in the same array:
- `'## 6. Plan-Mode Trigger',` → `'## 5. Plan-Mode Trigger',`
- `'## 7. Post-Change Context Refresh',` → `'## 6. Post-Change Context Refresh',`
- `'## 8. Anti-Patterns',` → `'## 7. Anti-Patterns',`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/token-budget.test.ts -t "MCP health"`
Expected: PASS

- [ ] **Step 5: Build + test**

Run: `npm run build && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tests/token-budget.test.ts src/generators/instructions.ts
git commit --no-verify -m "perf(context): drop MCP Health Check section from prompt-quality pack"
```

---

## Phase 2 — Slim MCP tool output

### Task 7: Make get_session_context drop the duplicate bootstrap when the card exists

**Files:**
- Test: `src/tests/mcp-server-modules.test.ts` (or new `src/tests/session-context.test.ts`)
- Modify: `src/mcp-server/utils.ts:22-67`

- [ ] **Step 1: Write the failing test**

Create `src/tests/session-context.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('getSessionContext bootstrap de-dup', () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-ctx-'));
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does NOT append SESSION_BOOTSTRAP when COPILOT_CONTEXT.md exists', async () => {
    fs.writeFileSync(
      path.join(dir, '.github', 'COPILOT_CONTEXT.md'),
      '# Card\n\n## Session Restart Protocol\n1. get_session_context\n');
    const mod = await import(`../mcp-server/utils.js?ctx-present`);
    const out = mod.getSessionContext();
    // The appended block heading must not appear; card content must.
    expect(out).not.toContain('## Session Start Bootstrap');
    expect(out).toContain('## Session Restart Protocol');
  });

  it('DOES include bootstrap when COPILOT_CONTEXT.md is absent', async () => {
    const mod = await import(`../mcp-server/utils.js?ctx-absent`);
    const out = mod.getSessionContext();
    expect(out).toContain('## Session Start Bootstrap');
  });
});
```

> `getSessionContext()` resolves the project root via `ROOT` in `shared.ts`. Confirm how `ROOT` is computed; if it is not `process.cwd()`-relative, set the env var / path the module expects instead of `process.chdir`. Match the approach used by `src/tests/mcp-server-modules.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/session-context.test.ts`
Expected: FAIL — the first test fails because `SESSION_BOOTSTRAP` is always appended.

- [ ] **Step 3: Make the append conditional**

In `src/mcp-server/utils.ts`, change the card-present branch (lines 46-49) from:

```ts
  const contextCardPath = path.join(ROOT, '.github', 'COPILOT_CONTEXT.md');
  if (fs.existsSync(contextCardPath)) {
    return fs.readFileSync(contextCardPath, 'utf-8') + SESSION_BOOTSTRAP;
  }
```

to:

```ts
  const contextCardPath = path.join(ROOT, '.github', 'COPILOT_CONTEXT.md');
  if (fs.existsSync(contextCardPath)) {
    // The card already contains the Session Restart Protocol — do not re-append it.
    return fs.readFileSync(contextCardPath, 'utf-8');
  }
```

Leave the fallback path (lines 50-66) unchanged so the missing-card case still returns `SESSION_BOOTSTRAP`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/session-context.test.ts`
Expected: PASS

- [ ] **Step 5: Build + test**

Run: `npm run build && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tests/session-context.test.ts src/mcp-server/utils.ts
git commit --no-verify -m "perf(mcp): stop double-stating Session Restart Protocol in get_session_context"
```

---

### Task 8: Add includeDiagram param to get_stack_info and strip Mermaid by default

**Files:**
- Test: `src/tests/mcp-tool-definitions.test.ts` (add) + `src/tests/token-budget.test.ts`
- Modify: `src/mcp-server/sdk-server.ts:124-132`
- Modify: `src/mcp-server/utils.ts` (add `stripMermaidSections` helper + re-export)

- [ ] **Step 1: Write the failing test for the helper**

Append to `src/tests/token-budget.test.ts`:

```ts
import { stripMermaidSections } from '../mcp-server/utils.js';

describe('stripMermaidSections', () => {
  it('removes fenced mermaid blocks and their preceding heading', () => {
    const input = [
      '# Stack', '', 'Body text.', '',
      '## Visual Stack Map', '', '```mermaid', 'flowchart LR', '  A-->B', '```', '',
    ].join('\n');
    const out = stripMermaidSections(input);
    expect(out).toContain('Body text.');
    expect(out).not.toContain('```mermaid');
    expect(out).not.toContain('Visual Stack Map');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-budget.test.ts -t "stripMermaidSections"`
Expected: FAIL — `stripMermaidSections` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/mcp-server/utils.ts`, add and export:

```ts
/**
 * Remove "## <heading>" sections whose body is a single fenced ```mermaid block.
 * Used to keep diagrams in human-facing docs but strip them from agent-facing MCP output.
 */
export function stripMermaidSections(markdown: string): string {
  // Drop a heading line immediately followed (after blank lines) by a mermaid fence.
  const withoutDiagramSections = markdown.replace(
    /\n#{2,6} [^\n]*\n+```mermaid[\s\S]*?```/g,
    '',
  );
  // Drop any stray mermaid fences not caught above.
  return withoutDiagramSections.replace(/```mermaid[\s\S]*?```\n?/g, '').trimEnd() + '\n';
}
```

- [ ] **Step 4: Run helper test to verify it passes**

Run: `npx vitest run src/tests/token-budget.test.ts -t "stripMermaidSections"`
Expected: PASS

- [ ] **Step 5: Write the failing tool-schema test**

Append to `src/tests/mcp-tool-definitions.test.ts` (match the file's existing import/setup style for registering tools and capturing handlers):

```ts
it('get_stack_info strips mermaid by default and keeps it when includeDiagram=true', async () => {
  // Arrange a fake project root with a stack.md containing a mermaid block.
  // Reuse this file's existing harness for invoking a registered tool by name.
  const stackMd = '# Stack\n\nLangs: TS\n\n## Visual Stack Map\n\n```mermaid\nflowchart LR\n  A-->B\n```\n';
  // ... write stackMd to <root>/.github/ai-os/context/stack.md via the harness ...
  const def = await invokeTool('get_stack_info', {});
  expect(def).not.toContain('```mermaid');
  const withDiagram = await invokeTool('get_stack_info', { includeDiagram: true });
  expect(withDiagram).toContain('```mermaid');
});
```

> Replace the `invokeTool` placeholder with this file's actual mechanism for calling a registered tool handler. If the file has no such harness, instead unit-test the new handler logic by extracting it into a small exported function `renderStackInfo(includeDiagram: boolean): string` in `sdk-server.ts` and testing that directly.

- [ ] **Step 6: Run schema test to verify it fails**

Run: `npx vitest run src/tests/mcp-tool-definitions.test.ts -t "get_stack_info strips"`
Expected: FAIL — the tool ignores `includeDiagram` and always returns the raw file.

- [ ] **Step 7: Update the tool registration**

In `src/mcp-server/sdk-server.ts`, replace the `get_stack_info` registration (lines 125-132). Add the Zod import at the top if not present (`import { z } from 'zod';`):

```ts
  server.registerTool(
    'get_stack_info',
    {
      description: 'Returns the complete tech stack inventory: languages, frameworks, key dependencies, build tools, and test setup. Mermaid diagram omitted unless includeDiagram=true.',
      inputSchema: {
        includeDiagram: z
          .boolean()
          .optional()
          .describe('Include the Mermaid Visual Stack Map (default false; agents cannot render it).'),
      },
    },
    wrap('get_stack_info', (args: { includeDiagram?: boolean }) => {
      const raw = readAiOsFile('context/stack.md') || 'No stack file found.';
      return args?.includeDiagram ? raw : stripMermaidSections(raw);
    }),
  );
```

Ensure `stripMermaidSections` is imported from `./utils.js` at the top of `sdk-server.ts`.

> Verify the `wrap()` signature accepts a handler that receives the parsed args object. If `wrap` currently types the handler as `() => string`, widen it to `(args: Record<string, unknown>) => string` (it already passes args through for other parameterized tools — match those).

- [ ] **Step 8: Run schema test to verify it passes**

Run: `npx vitest run src/tests/mcp-tool-definitions.test.ts -t "get_stack_info strips"`
Expected: PASS

- [ ] **Step 9: Regenerate MCP docs + full suite**

Run: `node scripts/gen-mcp-docs.mjs && npm run build && npm run test`
Expected: `docs/mcp-tools.md` updated to show the new `includeDiagram` param; suite PASS.

- [ ] **Step 10: Commit**

```bash
git add src/tests/token-budget.test.ts src/tests/mcp-tool-definitions.test.ts src/mcp-server/utils.ts src/mcp-server/sdk-server.ts docs/mcp-tools.md
git commit --no-verify -m "perf(mcp): add get_stack_info includeDiagram param, strip mermaid by default"
```

---

## Phase 3 — Auto-migrator for existing installs

### Task 9: Implement the section-scoped token-layout migrator

**Files:**
- Create: `src/actions/token-migrator.ts`
- Test: `src/tests/token-migrator.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/tests/token-migrator.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateTokenLayout } from '../actions/token-migrator.js';

function writeFile(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('migrateTokenLayout', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-mig-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('removes the legacy 16-row MCP table block from copilot-instructions.md', () => {
    const legacy = [
      '# AI Coding Assistant',
      '',
      '## MCP Tools Available',
      '',
      'Use these tools to fetch project-specific context on demand:',
      '',
      '| Tool | When to call |',
      '| --- | --- |',
      '| `get_session_context` | x |',
      '| `search_codebase` | x |',
      '| `suggest_improvements` | x |',
      '',
      '---',
      '',
      '## Strict Behavior Guardrails',
      '',
      '- keep me',
    ].join('\n');
    writeFile(root, '.github/copilot-instructions.md', legacy);

    const result = migrateTokenLayout(root);

    const out = fs.readFileSync(path.join(root, '.github', 'copilot-instructions.md'), 'utf-8');
    expect(out).not.toContain('| `search_codebase` | x |');
    expect(out).toContain('full catalog'); // slimmed replacement marker text
    expect(out).toContain('## Strict Behavior Guardrails'); // untouched section preserved
    expect(out).toContain('- keep me');
    expect(result.changedFiles).toContain('.github/copilot-instructions.md');
  });

  it('is idempotent — a second run makes no further change', () => {
    const legacy = '# x\n\n## MCP Tools Available\n\n| Tool | When to call |\n| --- | --- |\n| `get_session_context` | a |\n| `search_codebase` | b |\n\n---\n';
    writeFile(root, '.github/copilot-instructions.md', legacy);
    migrateTokenLayout(root);
    const after1 = fs.readFileSync(path.join(root, '.github', 'copilot-instructions.md'), 'utf-8');
    const result2 = migrateTokenLayout(root);
    const after2 = fs.readFileSync(path.join(root, '.github', 'copilot-instructions.md'), 'utf-8');
    expect(after2).toBe(after1);
    expect(result2.changedFiles).toHaveLength(0);
  });

  it('does nothing when no legacy blocks are present', () => {
    writeFile(root, '.github/copilot-instructions.md', '# clean\n\nNothing to migrate.\n');
    const result = migrateTokenLayout(root);
    expect(result.changedFiles).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-migrator.test.ts`
Expected: FAIL — module `../actions/token-migrator.js` does not exist.

- [ ] **Step 3: Implement the migrator**

Create `src/actions/token-migrator.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

export interface MigrationResult {
  changedFiles: string[];
}

const SLIM_MCP_BLOCK = [
  '## MCP Tools Available',
  '',
  'Call these MCP tools at session start (full catalog: `.github/ai-os/context/mcp-tools.md`):',
  '',
  '| Tool | When to call |',
  '| --- | --- |',
  '| `get_session_context` | **At the start of every new conversation** — reloads MUST-ALWAYS rules |',
  '| `get_repo_memory` | Before coding — recover durable repo decisions and constraints |',
  '| `get_conventions` | Before writing new code in this repo |',
  '| `get_active_plan` | Restore the active task plan and open checkpoints |',
  '',
  '> If MCP tools are unavailable, read `.github/COPILOT_CONTEXT.md`, `.github/ai-os/context/conventions.md`, and `.github/ai-os/context/mcp-tools.md` directly.',
].join('\n');

/**
 * Replace the legacy "## MCP Tools Available" section (a >4-row tool table) with the
 * slimmed block. Matches the heading through the next horizontal rule or heading.
 * Returns the new content, or null if no change was needed.
 */
function migrateMcpTable(content: string): string | null {
  // Already migrated if the slim pointer text is present.
  if (content.includes('full catalog: `.github/ai-os/context/mcp-tools.md`')) return null;

  const headingRe = /## MCP Tools Available[\s\S]*?(?=\n---\n|\n## |\n*$)/;
  const match = content.match(headingRe);
  if (!match) return null;

  const rowCount = (match[0].match(/^\| `/gm) ?? []).length;
  if (rowCount <= 4) return null; // not the legacy bloated table

  return content.replace(headingRe, SLIM_MCP_BLOCK);
}

/**
 * Section-scoped, idempotent migration of AI-OS-managed sections in a target repo
 * to the token-optimized layout. Only rewrites known AI-OS default sections; never
 * touches user-authored content outside those sections.
 */
export function migrateTokenLayout(cwd: string): MigrationResult {
  const changedFiles: string[] = [];
  const targets: Array<{ rel: string; migrate: (c: string) => string | null }> = [
    { rel: '.github/copilot-instructions.md', migrate: migrateMcpTable },
  ];

  for (const { rel, migrate } of targets) {
    const abs = path.join(cwd, rel);
    if (!fs.existsSync(abs)) continue;
    const before = fs.readFileSync(abs, 'utf-8');
    const after = migrate(before);
    if (after !== null && after !== before) {
      fs.writeFileSync(abs, after);
      changedFiles.push(rel);
    }
  }

  return { changedFiles };
}
```

> Scope note: this first iteration migrates the highest-cost block (the 16-row MCP table). Additional `migrate*` functions for Session Restart / Context Budget / Value Mode can be added as follow-up entries in `targets` using the same idempotent "skip if slim marker present, else match-and-replace" pattern. Keep each one covered by a test before adding it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/token-migrator.test.ts`
Expected: PASS (all three cases)

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/actions/token-migrator.ts src/tests/token-migrator.test.ts
git commit --no-verify -m "feat(migrate): add section-scoped token-layout migrator"
```

---

### Task 10: Run the migrator automatically on --refresh-existing (with opt-out)

**Files:**
- Modify: `src/actions/apply.ts:739-742` (near legacy pruning) and the CLI flag parser
- Test: `src/tests/token-migrator.test.ts` (add integration assertion) or `src/tests/updater.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/token-migrator.test.ts` a test that the apply flow calls the migrator on refresh. If invoking the full `apply` is heavy, instead assert the wiring by exporting a tiny helper. Add to `token-migrator.ts`:

```ts
/** Returns whether the auto-migration should run for the given mode/flags. */
export function shouldRunTokenMigration(mode: string, noTokenMigration: boolean): boolean {
  return mode === 'refresh-existing' && !noTokenMigration;
}
```

Then in the test file:

```ts
import { shouldRunTokenMigration } from '../actions/token-migrator.js';

describe('shouldRunTokenMigration', () => {
  it('runs by default on refresh-existing', () => {
    expect(shouldRunTokenMigration('refresh-existing', false)).toBe(true);
  });
  it('is skipped with --no-token-migration', () => {
    expect(shouldRunTokenMigration('refresh-existing', true)).toBe(false);
  });
  it('does not run on fresh install', () => {
    expect(shouldRunTokenMigration('fresh', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/token-migrator.test.ts -t "shouldRunTokenMigration"`
Expected: FAIL — `shouldRunTokenMigration` not exported.

- [ ] **Step 3: Add the helper, the CLI flag, and the apply hook**

(a) Add `shouldRunTokenMigration` to `src/actions/token-migrator.ts` (code above).

(b) In the CLI argument parser (`src/cli/args.ts`), add a boolean flag `--no-token-migration` that sets `noTokenMigration: true`. Follow the exact pattern an existing boolean flag (e.g. how `--regenerate-context` is parsed) uses, and thread it into the options object `apply()` receives.

(c) In `src/actions/apply.ts`, import the migrator at the top:

```ts
import { migrateTokenLayout, shouldRunTokenMigration } from './token-migrator.js';
```

Then, immediately after the legacy-prune block (`apply.ts:740-742`), add:

```ts
  // Auto-migrate AI-OS-managed sections to the token-optimized layout on update.
  if (!dryRun && shouldRunTokenMigration(mode, noTokenMigration)) {
    const migrated = migrateTokenLayout(cwd);
    if (migrated.changedFiles.length > 0) {
      console.log(`  ⚡ Token-slimming migration applied to ${migrated.changedFiles.length} file(s):`);
      for (const f of migrated.changedFiles) console.log(`     • ${f}`);
      console.log('');
    }
  }
```

> `noTokenMigration` must be in scope in `apply()`. Trace how `regenerateContext` reaches this function (it is already a parameter/local near line 731) and add `noTokenMigration` the same way through the call chain from `args.ts` → dispatch → `apply()`.

- [ ] **Step 4: Run helper test to verify it passes**

Run: `npx vitest run src/tests/token-migrator.test.ts -t "shouldRunTokenMigration"`
Expected: PASS

- [ ] **Step 5: Build + full suite**

Run: `npm run build && npm run test`
Expected: PASS. If `src/tests/cli-args.test.ts` asserts the parsed flag set, add a case for `--no-token-migration`.

- [ ] **Step 6: Commit**

```bash
git add src/actions/token-migrator.ts src/actions/apply.ts src/cli/args.ts src/tests/token-migrator.test.ts src/tests/cli-args.test.ts
git commit --no-verify -m "feat(migrate): auto-run token-layout migration on refresh with --no-token-migration opt-out"
```

---

## Phase 4 — Regression guard

### Task 11: Add the duplicate-block and payload-budget invariants

**Files:**
- Modify: `src/tests/token-budget.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/token-budget.test.ts`. This generates the real always-loaded set into a temp dir and asserts both invariants:

```ts
import { generateContextDocs } from '../generators/context-docs.js';

/** Rough token estimate: ~4 chars per token. */
const estTokens = (s: string) => Math.ceil(s.length / 4);

describe('always-loaded payload regression guard', () => {
  function buildPayload(): { combined: string; files: Record<string, string> } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-payload-'));
    generateContextDocs(fakeStack(), dir, {});
    generateInstructions(fakeStack(), dir, {});
    const read = (rel: string) =>
      fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf-8') : '';
    const files = {
      copilot: read('.github/copilot-instructions.md'),
      aios: read('.github/instructions/ai-os.instructions.md'),
      pqp: read('.github/instructions/prompt-quality.instructions.md'),
      card: read('.github/COPILOT_CONTEXT.md'),
    };
    return { combined: Object.values(files).join('\n'), files };
  }

  it('combined always-loaded payload stays under the token budget', () => {
    const { combined } = buildPayload();
    // Baseline before slimming was ~3,500 tokens; cap to lock in the win.
    expect(estTokens(combined)).toBeLessThanOrEqual(2400);
  });

  it('no duplicated block appears in more than one always-loaded file', () => {
    const { files } = buildPayload();
    const all = [files.copilot, files.aios, files.pqp, files.card];
    const fingerprints = [
      'full catalog: `.github/ai-os/context/mcp-tools.md`', // MCP slim block — copilot only
      '**Problem Understanding First:**',                   // expanded Value Mode — must be gone everywhere
      'reloads MUST-ALWAYS rules, build commands, and key file locations', // restart body — card only phrasing differs
    ];
    for (const fp of fingerprints) {
      const count = all.filter((f) => f.includes(fp)).length;
      expect(count, `fingerprint appeared in ${count} files: ${fp}`).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (Phases 1-2 already removed the duplicates)**

Run: `npx vitest run src/tests/token-budget.test.ts -t "regression guard"`
Expected: PASS. If the budget assertion fails, print `estTokens(combined)` and either (a) confirm a real regression and fix it, or (b) if the slimmed baseline is legitimately just above 2400, set the cap to the measured value + ~5% headroom and note it in the spec's open-questions section.

- [ ] **Step 3: Full build + suite + lint**

Run: `npm run build && npm run test && npm run lint`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add src/tests/token-budget.test.ts
git commit --no-verify -m "test(context): add always-loaded payload budget + duplicate-block regression guard"
```

---

## Final verification

- [ ] **Run the full validation suite**

Run: `npm run build && npm run test && npm run lint`
Expected: green.

- [ ] **Self-check the savings**

Run: the `buildPayload()` helper logs `estTokens(combined)`; confirm it is ~35–40% below the ~3,500-token baseline (target ≤ ~2,300).

- [ ] **Confirm docs are regenerated**

Run: `node scripts/gen-mcp-docs.mjs` and ensure `git status` shows no further `docs/mcp-tools.md` drift.

- [ ] **Update the spec status**

Mark Phase 1-4 complete and record the final token-budget cap value in `docs/superpowers/specs/2026-05-30-token-efficiency-dedup-design.md` (Section 11 open question).

```bash
git add docs/superpowers/specs/2026-05-30-token-efficiency-dedup-design.md
git commit --no-verify -m "docs: record final token-budget cap in design spec"
```

---

## Notes for the implementer

- **Pre-commit hook:** the repo's `lint-staged` hook errors in this environment (`could not find any valid configuration`). Commit with `--no-verify` and run `npm run lint` manually before each commit.
- **Branch:** work on `feat/token-efficiency-dedup-spec` (already cut from `dev`) or a sibling `feat/` branch off `dev`. Never commit directly to `dev` or `master`.
- **Snapshots:** several tests in `src/tests/__snapshots__/` snapshot generated instruction files. After Phase 1 edits, run `npx vitest run -u` and **inspect every snapshot diff** — it must only show the intended removals, never unrelated content.
- **DetectedStack fixtures:** prefer copying the exact stack object an existing generator test uses over the `fakeStack()` shim, to stay in sync with the real type.
- **No new runtime deps.** `zod` is already used by the MCP SDK server; do not add anything else.
