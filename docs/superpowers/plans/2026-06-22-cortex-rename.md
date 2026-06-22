# Cortex Rename Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-cut rename the engine from `ai-os` to `cortex` everywhere — package/CLI, `.github/ai-os/`→`.github/cortex/` paths, `AI_OS_*`→`CORTEX_*` env, MCP server name, workflows, and brand copy — with no compat layer.

**Architecture:** Introduce one `engine/src/brand.ts` module holding every brand constant (name, config dir, MCP server name, env-var names). Replace the ~735 scattered `ai-os` literals in `engine/src` with references to it, category by category. A guard test (fails while any forbidden literal remains in `engine/src`) is the TDD driver; existing tests are re-pointed to the new names as each category lands. Finally migrate this repo's own dogfood install + docs and rebundle.

**Tech Stack:** TypeScript ESM (Node ≥22), vitest, esbuild bundle.

## Global Constraints

- **Hard cut — NO backward-compat:** no `AI_OS_*` env fallbacks, no dual-path `.github/ai-os` reads, no `ai-os` CLI alias, no migration shim. (Spec: "Decisions".)
- **Single source of truth:** all brand strings come from `engine/src/brand.ts`. Core code must not contain bare `'ai-os'` / `'.github/ai-os'` / `'AI_OS_*'` literals after the rename (enforced by the guard test).
- **Authoritative naming map** (verbatim from spec):
  - package `name` + `bin` `ai-os` → `cortex`
  - `.github/ai-os/` → `.github/cortex/`
  - `AI_OS_ROOT`→`CORTEX_ROOT`, `AI_OS_PERSONAL_ROOT`→`CORTEX_PERSONAL_ROOT`, `AI_OS_CONFIG`→`CORTEX_CONFIG`, `AI_OS_ALLOW_RUN_TOOLS`→`CORTEX_ALLOW_RUN_TOOLS`, `AI_OS_MCP_DEBUG`→`CORTEX_MCP_DEBUG`
  - MCP server `name: 'ai-os'` → `'cortex'` (tools `mcp__ai-os__*` → `mcp__cortex__*`)
  - workflows `ai-os-*.yml` → `cortex-*.yml`
  - user-facing "AI OS"/"ai-os" copy → "Cortex"/"cortex"
- **Node ≥22**, ESM. Commits MUST be prefixed `SKIP_SIMPLE_GIT_HOOKS=1` (broken root pre-commit hook).
- **Branch:** all work on `feat/cortex-rename`. Run engine commands from `engine/`.
- **Green gate before each commit:** `npm run build && npm run lint && npm test` from `engine/`.

---

### Task 1: `brand.ts` — central brand constants

**Files:**
- Create: `engine/src/brand.ts`
- Test: `engine/src/tests/brand.test.ts`

**Interfaces:**
- Produces: `BRAND: 'cortex'`, `BRAND_TITLE: 'Cortex'`, `CONFIG_DIR: '.github/cortex'`, `MCP_SERVER_NAME: 'cortex'`, `ENV: { ROOT, PERSONAL_ROOT, CONFIG, ALLOW_RUN_TOOLS, MCP_DEBUG }` (string literal `CORTEX_*` values).

- [ ] **Step 1: Write the failing test**

```ts
// engine/src/tests/brand.test.ts
import { test } from 'node:test'; // NOTE: this repo uses vitest — use the project's test runner
```

(Use the project's existing test style — vitest `describe/it/expect`, matching neighboring files in `engine/src/tests/`.) Test body:

```ts
import { describe, it, expect } from 'vitest';
import { BRAND, BRAND_TITLE, CONFIG_DIR, MCP_SERVER_NAME, ENV } from '../brand.js';

describe('brand', () => {
  it('exposes the canonical Cortex constants', () => {
    expect(BRAND).toBe('cortex');
    expect(BRAND_TITLE).toBe('Cortex');
    expect(CONFIG_DIR).toBe('.github/cortex');
    expect(MCP_SERVER_NAME).toBe('cortex');
    expect(ENV).toEqual({
      ROOT: 'CORTEX_ROOT',
      PERSONAL_ROOT: 'CORTEX_PERSONAL_ROOT',
      CONFIG: 'CORTEX_CONFIG',
      ALLOW_RUN_TOOLS: 'CORTEX_ALLOW_RUN_TOOLS',
      MCP_DEBUG: 'CORTEX_MCP_DEBUG',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/tests/brand.test.ts`
Expected: FAIL — cannot resolve `../brand.js`.

- [ ] **Step 3: Write the module**

```ts
// engine/src/brand.ts
/** Single source of truth for Cortex brand strings. No bare 'ai-os' literals elsewhere. */
export const BRAND = 'cortex';
export const BRAND_TITLE = 'Cortex';
export const CONFIG_DIR = '.github/cortex';
export const MCP_SERVER_NAME = 'cortex';
export const ENV = {
  ROOT: 'CORTEX_ROOT',
  PERSONAL_ROOT: 'CORTEX_PERSONAL_ROOT',
  CONFIG: 'CORTEX_CONFIG',
  ALLOW_RUN_TOOLS: 'CORTEX_ALLOW_RUN_TOOLS',
  MCP_DEBUG: 'CORTEX_MCP_DEBUG',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/tests/brand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/src/brand.ts engine/src/tests/brand.test.ts
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(brand): central Cortex brand constants module"
```

---

### Task 2: Env vars `AI_OS_*` → `CORTEX_*` (via `ENV`)

**Files:**
- Modify: every `engine/src` file reading `process.env.AI_OS_*` — find with the grep below. Known: `actions/apply.ts`, `actions/compact-memory.ts`, `doctor.ts`, `generators/context-docs.ts`, `mcp-server/*` (and any others the grep surfaces).
- Test: re-point env-var assertions in the relevant test files (e.g. `tests/promotion.test.ts`, `tests/doctor.test.ts`, anything asserting `AI_OS_*`).

**Interfaces:** Consumes `ENV` from `brand.ts` (Task 1).

- [ ] **Step 1: Enumerate the surface**

Run: `cd engine && grep -rn "AI_OS_" src` — note every file/line. These are the only env reads/writes to change.

- [ ] **Step 2: Replace each usage**

For each occurrence, replace the bare string with the `ENV` constant and the new value:
- `process.env.AI_OS_ROOT` → `process.env[ENV.ROOT]` (import `ENV` from `../brand.js` with the correct relative depth)
- `AI_OS_PERSONAL_ROOT` → `ENV.PERSONAL_ROOT`; `AI_OS_CONFIG` → `ENV.CONFIG`; `AI_OS_ALLOW_RUN_TOOLS` → `ENV.ALLOW_RUN_TOOLS`; `AI_OS_MCP_DEBUG` → `ENV.MCP_DEBUG`.
- Any generated text that *documents* an env var (e.g. context-docs emitting `AI_OS_CONFIG=...`) → emit `CORTEX_CONFIG` (use `ENV.CONFIG`).

- [ ] **Step 3: Re-point env tests**

Update any test that sets/asserts `AI_OS_*` (e.g. tests that `process.env.AI_OS_PERSONAL_ROOT = ...`) to the `CORTEX_*` name. Search: `cd engine && grep -rn "AI_OS_" src/tests`.

- [ ] **Step 4: Verify**

Run: `cd engine && grep -rn "AI_OS_" src ; echo "count=$(grep -rc 'AI_OS_' src | grep -v ':0' | wc -l)"`
Expected: **zero** `AI_OS_` occurrences in `src`.
Run: `cd engine && npm run build && npx vitest run` — Expected: green.

- [ ] **Step 5: Commit**

```bash
git add engine/src
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "refactor(brand): AI_OS_* env vars -> CORTEX_* via brand.ENV"
```

---

### Task 3: Config-dir paths `.github/ai-os` → `CONFIG_DIR`

**Files:**
- Modify: every `engine/src` file with a `.github/ai-os` literal (~277 occurrences — find with grep). Heaviest in `generators/*`, `actions/*`, `mcp-server/*`, `detectors/*`, `doctor.ts`.
- Test: re-point path assertions across `tests/*` that hardcode `.github/ai-os`.

**Interfaces:** Consumes `CONFIG_DIR` from `brand.ts`.

- [ ] **Step 1: Enumerate**

Run: `cd engine && grep -rn "\.github/ai-os" src | wc -l` and list with `grep -rl "\.github/ai-os" src`.

- [ ] **Step 2: Replace**

Replace `'.github/ai-os'` string literals with `CONFIG_DIR` (import from `brand.js`). For `path.join(...,'.github','ai-os', ...)` style, replace the two segments with `CONFIG_DIR` split appropriately, or `path.join(cwd, CONFIG_DIR, ...)`. For interpolations in generated docs/templates that print the path, use `CONFIG_DIR`. Do NOT touch `.github/ai-os/` strings that are *example output inside test fixtures you are simultaneously re-pointing* — update those to `.github/cortex/` too.

- [ ] **Step 3: Re-point path tests**

Run: `cd engine && grep -rln "\.github/ai-os" src/tests` — update each to `.github/cortex`.

- [ ] **Step 4: Verify**

Run: `cd engine && grep -rn "\.github/ai-os" src` → Expected: **zero**.
Run: `cd engine && npm run build && npx vitest run` → green.

- [ ] **Step 5: Commit**

```bash
git add engine/src
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "refactor(brand): .github/ai-os -> .github/cortex via brand.CONFIG_DIR"
```

---

### Task 4: MCP server name `ai-os` → `cortex`

**Files:**
- Modify: `engine/src/mcp-server/sdk-server.ts:81` (`name: 'ai-os'` → `name: MCP_SERVER_NAME`), any other MCP name reference (`mcp-server/index.ts`).
- Test: `tests/mcp-tools.test.ts`, `tests/mcp-server-modules.test.ts`, `tests/mcp-tool-definitions.test.ts` — re-point any `ai-os` server-name / `mcp__ai-os__` assertions to `cortex` / `mcp__cortex__`.

**Interfaces:** Consumes `MCP_SERVER_NAME` from `brand.ts`.

- [ ] **Step 1: Re-point the test first (RED)**

Update the MCP test(s) to expect server name `cortex`. Run: `cd engine && npx vitest run src/tests/mcp-tools.test.ts` → Expected: FAIL (server still named `ai-os`).

- [ ] **Step 2: Replace the name**

`engine/src/mcp-server/sdk-server.ts:81`: `new McpServer({ name: 'ai-os', version: pkgVersion })` → `new McpServer({ name: MCP_SERVER_NAME, version: pkgVersion })` (import `MCP_SERVER_NAME`). Grep `mcp-server/` for any other `'ai-os'`.

- [ ] **Step 3: Verify**

Run: `cd engine && npx vitest run src/tests/mcp-tools.test.ts src/tests/mcp-server-modules.test.ts src/tests/mcp-tool-definitions.test.ts` → green.

- [ ] **Step 4: Commit**

```bash
git add engine/src
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "refactor(brand): MCP server name ai-os -> cortex (mcp__cortex__*)"
```

---

### Task 5: Package, bin, and brand copy

**Files:**
- Modify: `engine/package.json` (`name`→`cortex`, `bin`→`{ "cortex": "./bundle/generate.js" }`, description), root `package.json` (`name`→`cortex`, `bin`→`{ "cortex": "./engine/bundle/generate.js" }`, description), `engine/src/cli/dispatch.ts:28` banner, `engine/src/actions/apply.ts` next-steps copy, and any remaining `ai-os`/"AI OS" brand strings in `src` (banner/help/comments-in-output).
- Test: re-point any test asserting banner text or the `ai-os` command name.

**Interfaces:** Consumes `BRAND`, `BRAND_TITLE`.

- [ ] **Step 1: Find remaining brand strings**

Run: `cd engine && grep -rni "ai-os\|ai os" src | grep -viE "AI_OS_|\.github/ai-os"` — these are the copy/identifier occurrences left after Tasks 2-4.

- [ ] **Step 2: Replace**

- `package.json` (both): `name: "cortex"`, `bin: { "cortex": ... }`, description → "Cortex — portable AI-assistant context engine ...".
- Banner (`dispatch.ts:28`) → "Cortex — portable AI-assistant context engine".
- User-facing strings in generators/apply/doctor → `BRAND_TITLE` / `BRAND` as appropriate.
- The `bin/generate.js` invocation name in help/usage text → `cortex`.

- [ ] **Step 3: Verify**

Run: `cd engine && npm run build && npm run lint && npx vitest run` → green. Then `node bundle/generate.js --help 2>/dev/null | head -3` (after rebundle in Task 6) shows "Cortex".

- [ ] **Step 4: Commit**

```bash
git add engine/package.json package.json engine/src
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "refactor(brand): package name/bin + banner/copy -> cortex"
```

---

### Task 6: Guard test + rebundle (lock the rename)

**Files:**
- Create: `engine/src/tests/no-legacy-brand.test.ts`
- Modify: `engine/scripts/bundle.mjs` (banner/manifest brand), rebuild `engine/bundle/generate.js`, `engine/dist/server.js`, `engine/dist/bundle-manifest.json`.

**Interfaces:** none.

- [ ] **Step 1: Write the guard test**

```ts
// engine/src/tests/no-legacy-brand.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

describe('no legacy ai-os brand literals remain in src', () => {
  it('has no AI_OS_ / .github/ai-os / ai-os-brand literals', () => {
    // ripgrep the source tree (exclude this guard file and brand.ts comments allow-list).
    const out = execSync(
      `git grep -nIE "AI_OS_|\\.github/ai-os|'ai-os'|\\"ai-os\\"" -- src ':!src/tests/no-legacy-brand.test.ts' || true`,
      { cwd: process.cwd().endsWith('engine') ? process.cwd() : 'engine', encoding: 'utf8' },
    ).trim();
    expect(out, `Found legacy brand literals:\n${out}`).toBe('');
  });
});
```

(Adjust the cwd handling to the repo's vitest working directory; the intent: `git grep` over `engine/src` excluding the guard test finds **zero** legacy literals.)

- [ ] **Step 2: Run it — Expected PASS**

Run: `cd engine && npx vitest run src/tests/no-legacy-brand.test.ts`
Expected: PASS (Tasks 2-5 removed all literals). If it FAILS, fix the remaining literals it prints, then re-run.

- [ ] **Step 3: Rebundle**

Update `engine/scripts/bundle.mjs` banner string and any brand in the manifest to Cortex. Run: `cd engine && npm run bundle`. Confirm `bundle/generate.js`, `dist/server.js`, `dist/bundle-manifest.json` updated.

- [ ] **Step 4: Full green gate**

Run: `cd engine && npm run build && npm run lint && npm test`
Expected: all tests pass (including brand + guard), 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add engine/src engine/scripts/bundle.mjs engine/bundle engine/dist
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "test(brand): guard against legacy ai-os literals; rebundle as cortex"
```

---

### Task 7: Migrate this repo's dogfood install + workflows

**Files:**
- Rename: `.github/ai-os/` → `.github/cortex/` (config.json, memory/, mcp-server/, context/). Use `git mv`.
- Rename: `.github/workflows/ai-os-{drift-check,index,update-check,validate}.yml` → `cortex-*.yml`; update their bodies (paths to `.github/cortex/`, `engine/` working-dirs unchanged, the update-check reads `.github/cortex/config.json`).
- Modify: root `.mcp.json` (server key `ai-os`→`cortex`, args path `.github/cortex/mcp-server/index.js`, env `CORTEX_ROOT`), `.claude/settings.local.json` (`mcp__ai-os__*`→`mcp__cortex__*`, `enabledMcpjsonServers: ['cortex']`).

**Interfaces:** none (config/CI only).

- [ ] **Step 1: Move the config dir + workflows**

```bash
git mv .github/ai-os .github/cortex
for f in drift-check index update-check validate; do git mv ".github/workflows/ai-os-$f.yml" ".github/workflows/cortex-$f.yml"; done
```

- [ ] **Step 2: Update file contents**

Edit the 4 workflow bodies: replace `.github/ai-os` → `.github/cortex`, any `ai-os` step/job copy → `cortex`. Edit `.mcp.json` and `.claude/settings.local.json` per the Files list. Edit `.github/cortex/config.json` if it stores a brand/path field.

- [ ] **Step 3: Validate**

```bash
node -e "JSON.parse(require('fs').readFileSync('.mcp.json','utf8'));JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8'));console.log('json ok')"
grep -rn "\.github/ai-os\|ai-os-\(drift\|index\|update\|validate\)\|mcp__ai-os" .github .mcp.json .claude || echo "no legacy refs"
```
Expected: `json ok` and `no legacy refs`.

- [ ] **Step 4: Commit**

```bash
git add -A
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "chore(brand): migrate dogfood install + workflows to .github/cortex"
```

---

### Task 8: Docs + final sweep

**Files:**
- Modify: root `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SETUP.md`, `references/*`, `engine/README.md`, `engine/docs/*` — replace `ai-os` brand/command/path references with Cortex; update `npx github:marinvch/ai-os` → `npx github:marinvch/cortex` (GitHub redirects keep the old working).
- Regenerate: `engine/docs/mcp-tools.md` (so the CI freshness check passes).

**Interfaces:** none.

- [ ] **Step 1: Sweep docs**

Run: `grep -rln "ai-os\|AI OS\|AI_OS_\|\.github/ai-os" README.md AGENTS.md CLAUDE.md GEMINI.md SETUP.md references engine/README.md engine/docs` and update each to Cortex equivalents. Keep one explicit note that `github:marinvch/ai-os` still resolves via GitHub redirect.

- [ ] **Step 2: Regenerate generated docs**

Run: `cd engine && npm run gen-mcp-docs` (regenerates `engine/docs/mcp-tools.md`). Confirm it reflects `mcp__cortex__*` naming.

- [ ] **Step 3: Final whole-repo verification**

```bash
cd engine && npm run build && npm run lint && npm test   # all green
cd .. && git grep -nIE "AI_OS_|\.github/ai-os|mcp__ai-os" -- ':!docs/superpowers' ':!*.md' || echo "clean"
```
Expected: green tests; only intentional doc/redirect references (and the superpowers specs) remain.

- [ ] **Step 4: Commit**

```bash
git add -A
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "docs(brand): rename ai-os -> cortex across docs; regenerate mcp-tools"
```

---

## Self-Review

**Spec coverage:** naming map → Tasks 2-5 (env, paths, MCP, package/copy) ✓; centralize via brand.ts → Task 1 ✓; hard cut / no compat → enforced by guard test Task 6 ✓; dogfood migration (.github/cortex, .mcp.json, workflows, .claude) → Task 7 ✓; tests re-pointed → Tasks 2-5 each ✓; rebundle → Task 6 ✓; docs + mcp-tools regen → Task 8 ✓; manual GitHub repo rename → noted in Task 8 (owner action). Gap: none for in-code scope.

**Placeholder scan:** brand.ts + guard test + brand.test.ts show full code. Category tasks specify exact from→to transforms + grep verification (the "code" for a mechanical sweep is the mapping + the grep-count→0 gate, which is concrete). No "handle edge cases"/"TBD".

**Type/name consistency:** `brand.ts` exports (`BRAND`, `BRAND_TITLE`, `CONFIG_DIR`, `MCP_SERVER_NAME`, `ENV.{ROOT,PERSONAL_ROOT,CONFIG,ALLOW_RUN_TOOLS,MCP_DEBUG}`) are used identically in Tasks 2-5 and asserted in Task 1's test. Env values match the spec's naming map exactly.

**Note for executor:** the test runner is **vitest** (`npx vitest run <file>`), not `node:test`. Match the existing `engine/src/tests/*.test.ts` style. The guard test (Task 6) is the safety net — if any category task missed a literal, the guard fails loudly with the file:line list.
