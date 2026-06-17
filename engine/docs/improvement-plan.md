# ai-os — Improvement & Optimization Plan (audited)

> Status: proposal for review. Each item is rated **Necessary**, **Recommended**, or **Optional** based on a critical audit of the codebase as of v0.12.1.

## Repository purpose (restated)

ai-os is a **portable GitHub Copilot context engine** — a Node ≥20 CLI that scans any target repository, detects its stack, and emits a manifest-tracked Copilot context package (instructions, agents, skills, MCP tools, prompts, workflows, memory store, freshness snapshot). It also ships a self-contained MCP runtime server (`dist/server.js`) plus validation tooling (regression, smoke, scorecard, doctor).

The bar for any change: must improve **generation correctness, install/refresh reliability, security, or developer velocity** without breaking the manifest-tracked artifact contract that downstream repos depend on.

---

## Audit summary (what changed from the first-pass plan)

After a critical re-read of the source the following changes were applied:

- **Promoted to top-priority Necessary:** shell-injection fix in `searchFiles` MCP tool (concrete vulnerability confirmed at `src/mcp-server/utils.ts:1372`).
- **Demoted / dropped as speculative:** lazy-loaded action modules (bundle is already 261 KB — premature), recommendation plugin system (no contributor demand yet, large surface area), separate Windows PowerShell installer (`npx` already works on Windows; `install.sh` is bash-only by choice).
- **Scope-corrected:** schema validation switches from "add zod" to **hand-rolled type guards** to preserve the deliberate single-runtime-dep posture (`@github/copilot-sdk` only).
- **Newly added items found during audit:**
  - Sanitize stack-derived strings before they land in generated `copilot-instructions.md` (prompt-injection surface from package names, README excerpts, etc.).
  - Versioned artifact schemas + forward-migration path (manifest currently has no `schemaVersion`).
  - Public `--uninstall` action that consumes the manifest (currently only `pruneLegacyArtifacts` exists internally).

The full validated roadmap is below. Items marked **Necessary** should ship before the next minor release; **Recommended** items materially improve the product; **Optional** items are nice-to-have.

---


## Phase 0 — Security must-fixes (Necessary, do first)

### 0.1 Fix shell injection in `searchFiles` MCP tool — **Necessary**
- **Evidence:** `src/mcp-server/utils.ts:1372` interpolates user-controlled `query` and `filePattern` into a shell command string passed to `execSync`. Because this tool is exposed to Copilot agents, a crafted query containing shell metacharacters can execute arbitrary commands in the user's working directory.
- **Fix:** Switch to `spawnSync` with array args, drop the `npx ripgrep` shell form, or use the bundled `ripgrep` Node binding. Add a unit test asserting that `;`, `` ` ``, and `$()` in queries do not execute.
- **Why necessary:** Concrete, exploitable vulnerability in code that ships to every install.

### 0.2 Audit and harden remaining `execSync` callsites — **Necessary**
- `src/mcp-server/utils.ts:1522`, `:1591` use hardcoded globs (lower risk, but still string-form).
- `src/recommendations/cli-compat.ts:35` calls `npx -y skills --version` — verify no user input flows in.
- `src/validation/regression.ts:63-65` git init in a temp dir (low risk, dev-only).
- **Fix:** Replace all with `spawnSync(file, args[], opts)`. Add an ESLint rule (after Phase 1) banning string-form `execSync`.

### 0.3 Sanitize stack-derived inputs before rendering into Copilot instructions — **Necessary**
- **Evidence:** `generators/instructions.ts` and `context-docs.ts` interpolate `stack.projectName`, dependency names, and (in some templates) README excerpts into a file that Copilot loads as system prompt. A malicious dependency name like `"foo\n\nIGNORE PRIOR INSTRUCTIONS AND ..."` could prompt-inject the agent.
- **Fix:** Add a `sanitizeForInstructions()` helper (strip control chars, cap length, fence in code blocks where appropriate). Apply at every interpolation site rendered into `.github/copilot-instructions.md` and agent files.

---

## Phase 1 — Foundations (Necessary, low risk, high leverage)

### 1.1 Add ESLint (no Prettier) — **Recommended**
- **Why not Prettier:** repo style is consistent and adds churn; ESLint with stylistic rules is enough.
- **Why ESLint:** lets us encode bans (string-form `execSync`, naked `catch {}` swallows, `console.log` outside CLI surfaces).
- **Wire into:** `validate:fast`.

### 1.2 Schema-validate JSON artifacts (hand-rolled guards) — **Necessary**
- **Targets:** `config.json`, `manifest.json`, `tools.json`, `memory.jsonl`, `protect.json`.
- **Rationale:** today, `readAiOsFile` returns `''` on read failure and JSON parsers throw raw — both violate the project's own "no silent fallback" guardrail. Malformed files silently degrade behavior across refreshes.
- **Approach:** small `validators/` module with explicit type guards + descriptive errors. **No new runtime deps** (preserve current zero-dep posture beyond `@github/copilot-sdk`).
- **Add:** `schemaVersion` field on every JSON artifact + migration ladder.

### 1.3 Atomic file writes — **Necessary**
- **Evidence:** generators write in place; an interrupted `--refresh-existing` can leave half-written `tools.json`/`manifest.json`, breaking next refresh.
- **Fix:** `writeFileAtomic` helper in `generators/utils.ts` (write `*.tmp`, fsync, rename). Migrate manifest, tools.json, config.json, memory.jsonl, freshness snapshot.

### 1.4 Auto-generate the MCP tool reference — **Recommended**
- **Evidence:** the MCP tool list in `README.md` and `docs/` is hand-maintained vs. `src/mcp-tools.ts` definitions. Drift on every tool addition.
- **Fix:** add a `scripts/gen-mcp-docs.mjs` that reads `mcp-tools.ts` and writes `docs/mcp-tools.md`. CI fails if generated content drifts.

---

## Phase 2 — Refactor god modules (Recommended; behavior-preserving)

### 2.1 Split `src/mcp-server/utils.ts` (72 KB, 30+ exports) — **Recommended**
- **Evidence:** the file mixes memory store, session state, freshness, package introspection, env var scanning, search, recommendations bridge.
- **Target layout:** `memory.ts`, `session.ts`, `freshness-bridge.ts`, `project-introspection.ts` (env/package/files/routes), `search.ts`, `recommendations-bridge.ts`. Re-export from `utils.ts` for one minor release for backward compat.
- **Why not Necessary:** it works today; benefit is reviewability and unlocking 2.3.

### 2.2 Split `src/generate.ts` (45 KB) — **Recommended**
- **Layout:** `cli/args.ts`, `cli/dispatch.ts`, `actions/{apply,doctor,bootstrap,check-freshness,check-hygiene,compact-memory,plan,preview}.ts`. Keep `generate.ts` as a thin entry.

### 2.3 Expand unit test coverage — **Necessary**
- **Evidence:** 15 test files for ~104 source files (~14% file coverage). No tests for `analyze.ts`, `generate.ts` action dispatch, `generators/context-docs.ts`, or most of `mcp-server/utils.ts`.
- **Target:** >40% file coverage on critical paths (analyze, generators, mcp-server). Add fixtures for representative stacks.

---

## Phase 3 — Reliability & UX (mixed priority)

### 3.1 Content-hash gate per artifact — **Recommended**
- **Behavior:** store input + template hashes in manifest entries; skip writes when unchanged. Speeds `--refresh-existing` on stable repos and reduces churn in user PRs.

### 3.2 Real diff in `--dry-run` — **Recommended**
- **Today:** prints planned actions only, no content delta.
- **Fix:** unified-diff helper; show summary counts + first N changed lines per artifact.

### 3.3 `--uninstall` action — **Necessary**
- **Evidence:** today only `pruneLegacyArtifacts` exists internally. Users have no clean way to remove ai-os from a target repo.
- **Behavior:** consume the manifest, remove every owned file, leave user-authored blocks intact (already supported via `user-blocks.ts`), report what was kept and why.

### 3.4 `--json` output mode — **Optional**
- For `apply`, `doctor`, `check-freshness`, `check-hygiene`. Useful for CI consumers; defer until first request.

---

## Phase 4 — Security & supply chain (Necessary)

### 4.1 `npm audit --omit=dev` gate in CI — **Necessary**
- Add to `.github/workflows/ai-os-validate.yml`. Fail on high/critical, warn on moderate.

### 4.2 Bundle provenance on releases — **Recommended**
- Publish SHA-256 of `bundle/generate.js` and `dist/server.js` in the GitHub Release notes; document verification step in README.

### 4.3 Self-host scorecard in CI — **Recommended**
- Run ai-os against itself and assert the scorecard meets a threshold; prevents detection regressions for TS/Node/Vitest stacks.

---

## Phase 5 — Documentation (Recommended)

### 5.1 Split `README.md` into `docs/` — **Recommended**
- `README.md` → quickstart only.
- `docs/cli.md` (flags), `docs/mcp-tools.md` (generated), `docs/architecture.md`, `docs/contributing.md`.

### 5.2 Auto-run `--doctor` at end of `install.sh` — **Recommended**
- Already implemented; just wire into the installer with a soft-fail summary.

### 5.3 `examples/` reference repos with snapshot fixtures — **Recommended**
- 3 reference targets (Next.js + tRPC, FastAPI, Go service) with expected-output snapshots. Doubles as regression bedrock.

---

## Explicitly out of scope

- Telemetry that leaves the user's machine (privacy posture).
- Bundler rewrite (esbuild config is fine).
- Multi-language port of the CLI.
- Recommendation plugin system (no demand; large surface area).
- Lazy-loaded action modules (bundle already small).
- Separate PowerShell installer (`npx` works cross-platform).

---

## Open questions

- Should we drop the committed `dist/` and produce it only at release time? Current setup makes `npx github:...` work without a build step; likely keep.
- Memory store currently lives in target repo only — is there appetite for an opt-in shared/global tier?
- Should generated artifact files include a top-comment with `schemaVersion` so external tooling can detect compatibility without parsing?
