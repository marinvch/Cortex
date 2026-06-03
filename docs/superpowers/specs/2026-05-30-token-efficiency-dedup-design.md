# Token-Efficiency De-Duplication — Design Spec

> Date: 2026-05-30 · Status: approved for planning · Approach: single-source-of-truth de-duplication (lowest risk)

## 1. Problem

Every Copilot turn in a target repo silently loads a large, duplicated instruction payload — roughly **14 KB (~3,500 tokens)** — before the user's actual request is even processed. This cost compounds across every turn, every session, in every repo where AI OS is installed.

### Always-loaded surfaces (measured in this repo)

| File | Size | Loads when |
|---|---|---|
| `.github/copilot-instructions.md` (rendered from `src/templates/base-instructions.md`, capped 8 KB by `enforceSizeCap`) | ~7.5 KB | every request |
| `.github/instructions/prompt-quality.instructions.md` (frontmatter `applyTo:"**"`) | ~4.5 KB | every request |
| `.github/instructions/ai-os.instructions.md` (`applyTo:"**"`) | ~0.9 KB | every request |
| `.github/COPILOT_CONTEXT.md` (returned by `get_session_context`) | ~1.7 KB | session start |

### Confirmed duplication across always-loaded surfaces

- **MCP tool catalog** — a 16-row table in `copilot-instructions.md`, a quick-reference list in `ai-os.instructions.md`, an MCP-health note in `prompt-quality.instructions.md`, and a standalone `context/mcp-tools.md` (12.3 KB). Four copies.
- **Session Restart Protocol** — in `base-instructions.md`, in `COPILOT_CONTEXT.md`, AND in a hardcoded `SESSION_BOOTSTRAP` string that `getSessionContext()` (`src/mcp-server/utils.ts:22-67`) appends to `COPILOT_CONTEXT.md` — so the tool output states the protocol twice.
- **Context Budget Policy** — in `base-instructions.md`, in `context/context-budget.md`, and summarized in `COPILOT_CONTEXT.md`.
- **AI OS Value Mode** — in `base-instructions.md` AND `ai-os.instructions.md`.

### MCP output verbosity

- `get_stack_info` returns `context/stack.md`, which contains a **Mermaid diagram** that agents cannot render — pure token waste in tool output.
- (Verified non-issue) `formatMemory()` in `src/mcp-server/memory.ts:369-397` already omits `Created/Updated` timestamps; any timestamps observed in a live session come from a **stale installed runtime bundle**, not current source. No source change needed; a rebuild/reinstall resolves it.

## 2. Goal & non-goals

**Goal:** reduce the always-loaded payload by **~35–40% (~1,200–1,400 tokens/turn)** without losing any behavior, and add a regression guard so the bloat cannot silently return.

**Non-goals:**
- No lazy-loading architecture change (deferred; would be a separate, higher-risk effort).
- No removal of safety-critical guidance from always-loaded files — only de-duplication.
- No telemetry, no new runtime dependencies (preserve the single-runtime-dep posture).

## 3. Design principle

> Every content block has exactly **one canonical home**. Other always-loaded surfaces keep a **minimum-viable inline rule + pointer**, never a bare pointer for safety-critical behavior.

The "minimum-viable inline rule + pointer" pattern preserves compliance: the mandatory action stays inline; only the elaboration moves to the canonical doc.

Example: `Before editing protected blocks, preserve marked regions exactly. Full rules: context/protected-blocks.md.`

## 4. Canonical-home assignments

| Content block | Canonical home | Other locations become |
|---|---|---|
| Project identity, stack, build commands, conventions, General Rules, Strict Guardrails, Agentic Task Safety, Memory Workflow, Protected Blocks (min-rule) | `copilot-instructions.md` | — |
| Full MCP tool catalog (16 rows) | `context/mcp-tools.md` (on-demand) | `copilot-instructions.md` keeps only the 4 session-start tools + **1 offline-fallback line** + pointer; `ai-os.instructions.md` drops its quick-ref list; `prompt-quality.instructions.md` drops the MCP-health/tool reference |
| Session Restart Protocol + MUST-ALWAYS rules | `COPILOT_CONTEXT.md` (via `get_session_context`) | `base-instructions.md` keeps a 1-line pointer |
| Context Budget Policy (full body) | `context/context-budget.md` | `base-instructions.md` keeps a 3-bullet summary + pointer |
| AI OS Value Mode | `ai-os.instructions.md` | `base-instructions.md` keeps **one compact line** (so `multi-editor.ts` / Cursor outputs do not lose it) |
| Prompt template, Agent Routing table, Model Routing table | `prompt-quality.instructions.md` | — |

### Offline fallback (always-loaded, ~1 line)

To avoid dead pointers when the MCP server is unavailable, `copilot-instructions.md` retains a single line:

> If MCP tools are unavailable, read `.github/COPILOT_CONTEXT.md`, `.github/ai-os/context/conventions.md`, and `.github/ai-os/context/mcp-tools.md` directly.

## 5. MCP output slimming (backward-compatible)

All MCP schema changes are **additive optional params only**; default behavior preserved where it does not duplicate.

1. **`get_session_context`** (`src/mcp-server/utils.ts:22-67`): drop the `SESSION_BOOTSTRAP` append **only when `COPILOT_CONTEXT.md` exists** (the card already contains the protocol). The missing-card fallback path **keeps** the bootstrap so startup guidance is never lost.
2. **`get_stack_info`**: keep the Mermaid diagram in `context/stack.md` (human-facing docs), but strip it from tool output by default. Add `includeDiagram?: boolean` (default `false`) to the tool schema; update the SDK Zod schema, the shared tool catalog, `mcp-tool-definitions.test.ts`, and the generated `mcp-tools.md`.

## 6. Applying the optimized layout — fresh installs AND updates

The optimized layout must reach **both** paths automatically:

- **Fresh install / full regeneration** — the slimmed generators (Phase 1) emit the optimized files directly. No extra step.
- **Update of an existing install (`--refresh-existing`)** — runs the **auto-migration** described below **by default**, so simply updating AI OS on a repo upgrades its files to the optimized version without any opt-in flag.

This is a deliberate change from the original draft, which gated migration behind `--regenerate-context`. We can run it automatically because the migrator is **section-scoped** and provably non-destructive to user content (see below). This narrows — but does not violate — the existing "safe refresh preserves curated files" guarantee: whole-file user customizations are preserved; only the AI-OS-managed default sections are rewritten in place.

**Section-scoped auto-migrator:**
- Runs automatically during every `--refresh-existing` (the standard update path), before/within the normal generation flow.
- Operates **only on AI-OS-managed sections**, matched by stable section markers/headers; never touches user-authored blocks (reuse `user-blocks.ts` boundaries). If a managed section cannot be unambiguously located (e.g. a user heavily edited it), it is **left untouched** and a one-line notice is emitted instead of guessing.
- Rewrites known duplicated sections (MCP tool table, Session Restart Protocol body, Context Budget Policy body, Value Mode) to their slimmed canonical form in place.
- **Idempotent:** running on an already-optimized repo is a no-op (no churn in user PRs).
- **Versioned:** keyed off an artifact `schemaVersion`/layout marker so the migration runs once per repo and is skipped thereafter.
- **Safety escape hatch:** a `--no-token-migration` flag (or config key) lets a user opt **out** if they have unusual customizations; the default is opt-**in** (automatic).

**Marker bootstrapping:** existing installs predate the stable section markers, so the migrator matches the **old duplicated default sections by their known content/headers** for the first pass, replaces them with marker-wrapped slimmed sections, and relies on the markers for all subsequent refreshes.

## 7. Regression guard (prevents re-bloat)

New test module (e.g. `src/tests/token-budget.test.ts`):

1. **Duplicate-block invariant** — assert each known duplicated block (MCP 16-row table, Session Restart Protocol body, Context Budget Policy body, Value Mode) appears in **≤ 1** always-loaded file. Match by **content fingerprint / section ID**, not bare headings; whitelist generic headings (`## Build & Test`, `## Key Files`, etc.) to avoid false positives.
2. **Payload-budget invariant** — assert the combined always-loaded payload (`copilot-instructions.md` + `*.instructions.md` with `applyTo:"**"` + `COPILOT_CONTEXT.md`) stays under a token-budget cap (target ≤ ~2,300 tokens; exact cap set during implementation against the slimmed baseline).
3. **Generation coverage** — `get_session_context` with and without `COPILOT_CONTEXT.md`; safe-refresh preservation vs. regenerate-context migration; multi-editor output still contains the minimum required guidance (incl. Value Mode line); MCP schemas remain backward-compatible (old calls still valid).

## 8. Affected files (implementation surface)

- `src/templates/base-instructions.md` — remove duplicated sections; add pointers + min-rules + Value Mode line.
- `src/generators/instructions.ts` — `ai-os.instructions.md` builder (drop quick-ref list), `prompt-quality` builder (drop MCP health/tool dup), tool-table slimming.
- `src/generators/context-docs.ts` — `COPILOT_CONTEXT.md` builder (confirm it is the canonical Session Restart home).
- `src/mcp-server/utils.ts` — `getSessionContext()` conditional bootstrap append.
- `src/mcp-server/project-introspection.ts` (or wherever `get_stack_info` renders) — `includeDiagram` param.
- `src/mcp-server/sdk-server.ts` + shared tool catalog — `get_stack_info` schema.
- `src/generators/multi-editor.ts` — verify Value Mode / minimum guidance retained.
- Migrator: `src/updater.ts` (or a new `src/actions/` step) — section-scoped rewrite.
- Tests: new `token-budget.test.ts`; update `generators.test.ts`, `mcp-tool-definitions.test.ts`, `multi-model.test.ts`, `multi-editor.test.ts`, and snapshots in `src/tests/__snapshots__/` **after** adding focused assertions (update snapshots by contract, not blind regeneration).
- Docs: regenerate `docs/mcp-tools.md` via `scripts/gen-mcp-docs.mjs` if `get_stack_info` schema changes.

## 9. Phasing

1. **Phase 1 — De-dup generators/templates.** Slim `base-instructions.md`, `ai-os.instructions.md`, `prompt-quality.instructions.md`; assign canonical homes + pointers + min-rules + offline-fallback line. (Biggest win; fresh-install benefit immediately.)
2. **Phase 2 — MCP output slimming.** `getSessionContext()` conditional append; `get_stack_info` `includeDiagram` param + contract/test updates.
3. **Phase 3 — Section-scoped auto-migrator** that runs by default on every `--refresh-existing`, upgrading existing installs to the optimized layout without an opt-in flag (with `--no-token-migration` escape hatch). Section-scoped + idempotent + version-keyed so it never clobbers user content and never re-runs needlessly.
4. **Phase 4 — Regression-guard tests** (duplicate-block + payload-budget invariants + coverage).

Each phase ends with `npm run build` + `npm run test` green.

## 10. Acceptance criteria

- Combined always-loaded payload reduced ~35–40% vs. the current ~14 KB baseline, verified by the payload-budget test.
- No always-loaded surface contains a duplicated block flagged by the duplicate-block invariant.
- All safety-critical rules (guardrails, protected blocks, memory workflow, session start) remain actionable inline (min-rule present even where details moved).
- `get_stack_info` default output contains no Mermaid; diagram still present in `context/stack.md`.
- `get_session_context` never loses bootstrap guidance when `COPILOT_CONTEXT.md` is absent.
- Both code paths converge on the optimized layout: **fresh installs** emit it directly, and **updates (`--refresh-existing`) auto-migrate** existing repos to it by default — verified by tests for both paths.
- The auto-migrator is idempotent (no-op on already-optimized repos), version-keyed (runs once), section-scoped (rewrites only AI-OS-managed sections), and preserves all user-authored blocks; `--no-token-migration` opts out.
- MCP tool schema changes are additive/optional; pre-existing calls remain valid.
- `npm run build`, `npm run test`, and `npm run lint` all pass.

## 11. Open questions

- Exact token-budget cap value — set empirically against the Phase-1 slimmed baseline.
- Whether the migrator should also de-duplicate `context/mcp-tools.md` consumers, or leave that doc as the single catalog (current plan: leave as the single catalog).
