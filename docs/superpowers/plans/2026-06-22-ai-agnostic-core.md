# AI-Agnostic Core (Demote Copilot) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demote Copilot from privileged default to one ordinary adapter: make `AGENTS.md` the canonical primary artifact, auto-detect which assistants a repo uses, and remove the dead `@github/copilot-sdk` coupling — without breaking any existing adapter.

**Architecture:** Introduce a small assistant-adapter registry; refactor `multi-model.ts`/`multi-editor.ts` into registry entries (Copilot becomes one entry). Add a detector that picks the active adapter set from repo markers. Promote `AGENTS.md` to the primary rendering with assistant-native files as adapter views. Remove the unused `--copilot` SDK bridge.

**Tech Stack:** TypeScript ESM (the engine is already Node-≥20 ESM, post-Cortex-rename), vitest, esbuild bundle. Brand is already **Cortex** (the rename sub-project shipped) — this plan does NO renaming.

## Global Constraints

- **Demote, do NOT delete Copilot.** Copilot stays a fully working adapter; only the dead `--copilot` in-process SDK bridge + the `@github/copilot-sdk` dependency are removed. `.github/copilot-instructions.md` keeps being generated (as the Copilot adapter's output) — GitHub Copilot requires that exact path.
- **`AGENTS.md` is the canonical primary** per-project artifact; assistant-native files (`copilot-instructions.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, …) are adapter views of the same neutral source. `AGENTS.md` + MCP are ALWAYS emitted.
- **Default behavior = auto-detect** installed assistants; explicit `--model`/`--editor`/`config.json` override detection. No markers → universal baseline (`AGENTS.md` + MCP) + a hint.
- **No new platform adapters** for slash-commands/chatmodes (YAGNI — separate future sub-project). Keep Copilot's `prompts.json`/chatmodes as-is.
- **Preserve user-authored `AGENTS.md` regions** (reuse the existing protected-block behavior; engine content in marked regions).
- **No `@github/copilot-sdk` import may remain** in `engine/src` after Task 1 (a test asserts this).
- ESM, vitest. Commits prefixed `SKIP_SIMPLE_GIT_HOOKS=1`. Branch: `feat/ai-agnostic-core-v2`. Engine cmds from `engine/`. Green gate before each commit: `npm run build && npm run lint && npm test`.

---

### Task 1: Remove the dead `--copilot` SDK bridge + `@github/copilot-sdk`

**Files:**
- Modify: `engine/src/mcp-server/index.ts` (delete the `--copilot` branch + stub in-process bridge; keep stdio `StdioServerTransport` as the sole transport)
- Modify: `engine/package.json` (remove `@github/copilot-sdk` from `dependencies`), `engine/scripts/bundle.mjs` (remove it from esbuild `external`)
- Modify: `engine/package-lock.json` (regenerate; KEEP the `@emnapi` optional records)
- Test: `engine/src/tests/no-copilot-sdk.test.ts` (new)

**Interfaces:** Produces nothing consumed by later tasks (independent cleanup).

- [ ] **Step 1: Write the failing test**

```ts
// engine/src/tests/no-copilot-sdk.test.ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('no @github/copilot-sdk usage', () => {
  it('has no import of @github/copilot-sdk in src and no dep entry', () => {
    const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const grep = spawnSync('git', ['grep', '-nI', '@github/copilot-sdk', '--', 'src'], { cwd: engineRoot, encoding: 'utf8' });
    expect((grep.stdout || '').trim(), `found copilot-sdk refs:\n${grep.stdout}`).toBe('');
    const pkg = JSON.parse(spawnSync('cat', ['package.json'], { cwd: engineRoot, encoding: 'utf8' }).stdout);
    expect(pkg.dependencies?.['@github/copilot-sdk']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — Expected FAIL** (`--copilot` code + dep still present).
Run: `cd engine && npx vitest run src/tests/no-copilot-sdk.test.ts` → FAIL.

- [ ] **Step 3: Remove the bridge + dep**

In `engine/src/mcp-server/index.ts`: delete the `if (process.argv.includes('--copilot')) { … }` branch and the in-process transport stub + the dynamic `@github/copilot-sdk` import; keep the default stdio path (`new StdioServerTransport()` wiring) as the only transport. Remove now-unused imports.
In `engine/package.json`: delete the `"@github/copilot-sdk": "…"` line from `dependencies`.
In `engine/scripts/bundle.mjs`: remove `'@github/copilot-sdk'` from the esbuild `external` array.

- [ ] **Step 4: Regenerate lockfile (keep @emnapi) + verify**

Run: `cd engine && npm install` then confirm `node_modules/@emnapi/core` records remain in `package-lock.json` (the lock must still contain `"node_modules/@emnapi/core"` + `"node_modules/@emnapi/runtime"` package entries — if `npm install` pruned them, restore those two records). Then `npm run build && npx vitest run src/tests/no-copilot-sdk.test.ts` → PASS, and `npm run bundle` to rebuild without the external.

- [ ] **Step 5: Full gate + commit**

Run: `cd engine && npm run build && npm run lint && npm test` → green.
```bash
git add engine/src engine/package.json engine/package-lock.json engine/scripts/bundle.mjs engine/bundle engine/dist
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "refactor(adapters): remove dead --copilot SDK bridge + @github/copilot-sdk dep"
```

---

### Task 2: Assistant detector + `'auto'` default

**Files:**
- Create: `engine/src/generators/detect-assistants.ts`
- Modify: `engine/src/types.ts` (add `'auto'` to the model concept), `engine/src/cli/args.ts:91` + `engine/src/actions/init.ts:87` (default `'copilot'` → `'auto'`)
- Test: `engine/src/tests/detect-assistants.test.ts`

**Interfaces:**
- Produces: `type AdapterId = 'copilot'|'claude'|'gemini'|'local'|'cursor'|'jetbrains'|'neovim'`; `detectAssistants(cwd: string): AdapterId[]` — markers → adapter ids (always conceptually plus AGENTS.md+MCP, handled by the registry in Task 3). Empty array = none detected.

- [ ] **Step 1: Write the failing test**

```ts
// engine/src/tests/detect-assistants.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAssistants } from '../generators/detect-assistants.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'cortex-det-')); }

describe('detectAssistants', () => {
  it('detects claude from CLAUDE.md, cursor from .cursorrules, copilot from .github/copilot-instructions.md', () => {
    const d = tmp();
    writeFileSync(join(d, 'CLAUDE.md'), '#');
    writeFileSync(join(d, '.cursorrules'), '#');
    mkdirSync(join(d, '.github'), { recursive: true });
    writeFileSync(join(d, '.github', 'copilot-instructions.md'), '#');
    const ids = detectAssistants(d).sort();
    expect(ids).toContain('claude');
    expect(ids).toContain('cursor');
    expect(ids).toContain('copilot');
  });
  it('returns [] when no markers present', () => {
    expect(detectAssistants(tmp())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — Expected FAIL** (module missing). `cd engine && npx vitest run src/tests/detect-assistants.test.ts`.

- [ ] **Step 3: Implement the detector**

```ts
// engine/src/generators/detect-assistants.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type AdapterId = 'copilot' | 'claude' | 'gemini' | 'local' | 'cursor' | 'jetbrains' | 'neovim';

const MARKERS: Array<{ id: AdapterId; paths: string[] }> = [
  { id: 'claude', paths: ['CLAUDE.md', '.claude'] },
  { id: 'cursor', paths: ['.cursor', '.cursorrules'] },
  { id: 'copilot', paths: ['.github/copilot-instructions.md', '.github/copilot'] },
  { id: 'gemini', paths: ['GEMINI.md', '.gemini'] },
  { id: 'jetbrains', paths: ['.idea'] },
];

/** Return the adapter ids whose marker files/dirs exist in `cwd`. */
export function detectAssistants(cwd: string): AdapterId[] {
  const found: AdapterId[] = [];
  for (const m of MARKERS) {
    if (m.paths.some((p) => existsSync(join(cwd, p)))) found.push(m.id);
  }
  return found;
}
```

- [ ] **Step 4: Wire the `'auto'` default**

In `engine/src/types.ts`: extend the model union so `'auto'` is accepted (add `| 'auto'` to the `model?:` type and `ModelTarget` if present). In `cli/args.ts:91` and `actions/init.ts:87`: change `let model: ModelTarget = 'copilot'` → `'auto'`. Where the model is consumed to choose outputs (apply pipeline / Task 3), `'auto'` means "run `detectAssistants(cwd)`; if empty, baseline." For THIS task, just make `'auto'` resolve to `detectAssistants` results at the call site, falling back to the existing copilot behavior only when detection is empty AND no explicit flag — keep tests green.

- [ ] **Step 5: Run + commit**

Run: `cd engine && npm run build && npx vitest run src/tests/detect-assistants.test.ts && npm test` → green.
```bash
git add engine/src
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(adapters): assistant detector + 'auto' default"
```

---

### Task 3: Assistant-adapter registry (Copilot is one entry)

**Files:**
- Create: `engine/src/generators/adapters/registry.ts`
- Modify: `engine/src/generators/multi-model.ts`, `engine/src/generators/multi-editor.ts` (expose their per-target logic as adapter `emit` functions registered in the registry), and the apply call site that currently special-cases copilot
- Test: `engine/src/tests/adapter-registry.test.ts`

**Interfaces:**
- Consumes: `AdapterId` (Task 2), the existing `adaptInstructionsForModel`/`getModelOutputPath` (multi-model) and editor emitters (multi-editor).
- Produces: `interface AssistantAdapter { id: AdapterId; emit(ctx: RenderContext): GeneratedFile[] }`; `ADAPTERS: AssistantAdapter[]`; `adaptersFor(ids: AdapterId[]): AssistantAdapter[]`. `RenderContext` = `{ cwd: string; githubDir: string; instructions: string; stack: DetectedStack }` (reuse existing types); `GeneratedFile = { path: string; content: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// engine/src/tests/adapter-registry.test.ts
import { describe, it, expect } from 'vitest';
import { ADAPTERS, adaptersFor } from '../generators/adapters/registry.js';

describe('adapter registry', () => {
  it('has a copilot adapter among equals and no copilot special-casing in selection', () => {
    const ids = ADAPTERS.map((a) => a.id);
    expect(ids).toContain('copilot');
    expect(ids).toContain('claude');
    expect(ids).toContain('cursor');
  });
  it('adaptersFor returns only the requested ids', () => {
    const sel = adaptersFor(['claude']).map((a) => a.id);
    expect(sel).toEqual(['claude']);
  });
  it('the copilot adapter emits .github/copilot-instructions.md', () => {
    const copilot = ADAPTERS.find((a) => a.id === 'copilot')!;
    const files = copilot.emit({ cwd: '/x', githubDir: '/x/.github', instructions: '# rules', stack: { primaryLanguage: 'TypeScript' } as any });
    expect(files.some((f) => f.path.endsWith('.github/copilot-instructions.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — Expected FAIL** (registry missing). `cd engine && npx vitest run src/tests/adapter-registry.test.ts`.

- [ ] **Step 3: Implement the registry** by wrapping existing emitters

Create `adapters/registry.ts` defining `AssistantAdapter`, `RenderContext`, `GeneratedFile`, and `ADAPTERS` where each entry's `emit` delegates to the EXISTING logic (do not rewrite the rendering): the copilot/claude/gemini/local entries call `adaptInstructionsForModel(ctx.instructions, id)` + `getModelOutputPath(id, ctx.githubDir)`; the cursor/jetbrains/neovim entries call the existing `generateEditorConfigs` per-target helpers (extract the per-editor body into exported functions if needed). Add `adaptersFor(ids)`. Then change the apply call site to select adapters via `adaptersFor(resolvedIds)` instead of the current copilot-default branch — `resolvedIds` = explicit flags, else `detectAssistants(cwd)`, else `[]` (baseline). Keep `AGENTS.md` + MCP emission outside the registry (always-on).

- [ ] **Step 4: Run + commit**

Run: `cd engine && npm run build && npm run lint && npm test` → green (re-point any multi-model/multi-editor test that asserted the old call shape).
```bash
git add engine/src
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(adapters): assistant-adapter registry; copilot is one entry"
```

---

### Task 4: `AGENTS.md` as canonical primary

**Files:**
- Modify: `engine/src/actions/apply.ts` (emit `AGENTS.md` as the primary artifact from the neutral source; ensure it's always written + MCP always written), `engine/src/generators/instructions.ts` (the neutral instructions feed AGENTS.md; copilot-instructions.md is produced by the copilot adapter, not as "the canonical")
- Modify: `engine/src/detectors/drift.ts`, `engine/src/detectors/freshness.ts`, `engine/src/doctor.ts` (re-point the "primary artifact" reference from `copilot-instructions.md` to `AGENTS.md`; when a copilot adapter file exists, check it as an adapter)
- Test: re-point `tests/generators.test.ts`, `tests/generators-extended.test.ts`, `tests/examples.test.ts`, `tests/doctor.test.ts`, `tests/drift.test.ts`, `tests/freshness.test.ts`; add `tests/agents-canonical.test.ts`

**Interfaces:** Consumes the registry (Task 3) + the existing AGENTS.md shim generator (`generateAgentsShim`/agents-canonical primitive already in the codebase).

- [ ] **Step 1: Write the failing test**

```ts
// engine/src/tests/agents-canonical.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyToProject } from '../actions/apply.js'; // use the real apply entry; adjust to actual export name

describe('AGENTS.md canonical', () => {
  it('always writes AGENTS.md as the primary artifact', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cortex-ag-'));
    await applyToProject(d, { model: 'auto' } as any); // adjust to the real apply signature
    expect(existsSync(join(d, 'AGENTS.md')), 'AGENTS.md should be written').toBe(true);
  });
});
```

(Adjust the import/signature to the actual `apply` entry point — read `apply.ts` to find the exported function and its options shape before writing this test.)

- [ ] **Step 2: Run — Expected FAIL** (AGENTS.md not yet primary). `cd engine && npx vitest run src/tests/agents-canonical.test.ts`.

- [ ] **Step 3: Promote AGENTS.md**

In `apply.ts`: render the neutral instruction source, write it to `AGENTS.md` (root) as the primary via the existing AGENTS shim/canonical generator (preserve user-authored regions). Always emit `AGENTS.md` + MCP regardless of detected adapters. The copilot/claude/etc. native files come from the registry (Task 3). Re-point `drift.ts`/`freshness.ts`/`doctor.ts` "primary" checks to `AGENTS.md` (treat `copilot-instructions.md` as an adapter when present, not the canonical).

- [ ] **Step 4: Run + commit**

Run: `cd engine && npm run build && npm run lint && npm test` → green (re-point the listed tests).
```bash
git add engine/src
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(agents): AGENTS.md is the canonical primary; copilot file is an adapter view"
```

---

### Task 5: Docs + freshness regen + final verification

**Files:**
- Modify: `engine/README.md`, `engine/docs/*` (describe the assistant-agnostic / auto-detect model; Copilot as one adapter), root `README.md` "engine" section if it implies Copilot-centric
- Regenerate: `engine/docs/mcp-tools.md` (so the freshness check passes)

- [ ] **Step 1: Update docs** to reflect: AGENTS.md primary, auto-detected adapters, Copilot demoted, `--copilot` removed. Run `cd engine && npm run gen-mcp-docs`.

- [ ] **Step 2: Final gate**

Run: `cd engine && npm run build && npm run lint && npm test` → all green.

- [ ] **Step 3: Commit**

```bash
git add -A
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "docs(adapters): document assistant-agnostic core (AGENTS.md primary, auto-detect)"
```

---

## Self-Review

**Spec coverage:** remove copilot-sdk/--copilot → Task 1 ✓; auto-detect default → Task 2 ✓; adapter registry (copilot one entry) → Task 3 ✓; AGENTS.md canonical + drift/freshness/doctor re-point → Task 4 ✓; docs + mcp-tools regen → Task 5 ✓; "no new platform adapters" (YAGNI) honored — not in any task ✓; preserve user-authored AGENTS.md → Task 4 ✓; branding already Cortex (rename shipped) so NO rename here ✓.

**Placeholder scan:** Tasks 1-3 ship complete code (test + impl). Tasks 4-5 require reading the real `apply.ts`/generator signatures before writing (flagged inline) — the executor must open those files to bind exact names; that is honest (the apply entry's exact export/options must be read, not guessed) rather than a fabricated signature.

**Type/name consistency:** `AdapterId` defined in Task 2, consumed in Task 3 registry + Task 4 selection. `AssistantAdapter`/`RenderContext`/`GeneratedFile` defined in Task 3, used in its tests. `detectAssistants` defined Task 2, used Task 3 selection + Task 4 `'auto'`.

**Note for executor:** runner is **vitest**. Before Tasks 3-4, READ `engine/src/generators/multi-model.ts`, `multi-editor.ts`, and `actions/apply.ts` to bind the exact existing function names/signatures the registry wraps and the apply entry the canonical test calls — the plan names the intent; the code's real exports govern.
