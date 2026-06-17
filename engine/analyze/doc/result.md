# AI OS — State-of-the-Art Gap Analysis & Roadmap

> Synthesis of: [vscode-copilot-updates.md](./vscode-copilot-updates.md) × [codebase-features.md](./codebase-features.md) × [github-issues.md](./github-issues.md)
>
> Goal: Identify what to **keep**, what to **add**, what to **change**, and what to **remove** so that AI OS is the definitive Copilot context framework — usable in any codebase, state-of-the-art as of mid-2025.

---

## Executive Summary

AI OS is architecturally sound and well-positioned relative to VS Code's direction. Its MCP-first approach, `.instructions.md` generation, and structured context docs are all deeply aligned with VS Code v1.99–v1.101 native features. However, **three critical security vulnerabilities** must be fixed before any public recommendation. Additionally, VS Code v1.100–v1.101 introduced new extension points (tool sets, custom chat modes, MCP prompts/resources) that AI OS does not yet generate, leaving real value on the table.

**Overall verdict:** Fix security → add three new generators → close already-done refactoring issues → then optimize for Copilot cloud agent usage.

---

## Section 1 — What to KEEP (Strong Alignment)

### Already State-of-the-Art

These AI OS features are either directly aligned with or ahead of VS Code's current direction:

**`.instructions.md` generation with `applyTo:` patterns**

- VS Code v1.100 made `.instructions.md` a first-class feature. AI OS already generates these files with correct `applyTo:` front matter.
- Current output: `frontend.instructions.md`, `backend.instructions.md`, `tests.instructions.md` with correct glob patterns.
- Status: **perfectly aligned** — no changes needed.

**MCP server with structured tools**

- VS Code v1.99 made MCP the primary extension point for agent mode. AI OS ships a full MCP server with 32 tools covering context, memory, planning, and recommendations.
- The partitioned `{ activeTools, availableButInactive }` format in `tools.json` is a thoughtful design that avoids polluting the agent's tool list.
- Status: **ahead of most implementations** — maintain and expand.

**Dual MCP config management (`.mcp.json` + `.vscode/mcp.json`)**

- AI OS correctly maintains both Copilot CLI format and VS Code format, preserving non-ai-os entries in both.
- Status: **correct behavior** — keep as-is.

**Memory system with TTL + deduplication**

- The JSONL memory store with Jaccard near-duplicate detection and TTL pruning is a solid foundation. The watchdog auto-checkpoint system prevents context loss in long agent sessions.
- Status: **keep and extend** (see Copilot cloud agent improvements below).

**Stack detection breadth**

- 14 languages, 30+ frameworks, full pattern detection — one of the most comprehensive detection engines in this category.
- Status: **keep** — add PHP/WordPress (#104).

**Context freshness detection**

- `context-snapshot.json` + weekly GitHub Actions workflow is a unique differentiator. No other Copilot context tool does automated drift detection.
- Status: **keep and promote** in documentation.

**User block preservation (`<!-- AI-OS:USER_BLOCK -->` markers)**

- Enables hybrid human+AI maintained files — a sophisticated feature not found in competing tools.
- Status: **keep and document better** in the generated instructions.

**Prompt lifecycle files** (`/define`, `/plan`, `/build`, `/verify`, `/review`, `/ship`)

- These prompt files provide structured workflows that align well with VS Code's `.prompt.md` with `mode:` front matter.
- Status: **keep** — migrate to `.prompt.md` format (see changes below).

---

## Section 2 — What to ADD (New Opportunities from VS Code v1.100–v1.101)

### High Priority — Generate Tool Sets File (VS Code v1.101)

**What:** VS Code v1.101 added `.toolsets.json` — a way to group related tools that users can reference with `#toolsetname`.

**Gap:** AI OS does not generate a `.toolsets.json` file. Its 32 MCP tools are powerful but hard to discover.

**Proposed action:** Add `generators/toolsets.ts` to generate `.github/copilot/toolsets.json`:

```json
{
  "ai-os-context": {
    "description": "AI OS core context tools — run at session start",
    "tools": [
      { "toolName": "get_session_context" },
      { "toolName": "get_repo_memory" },
      { "toolName": "get_conventions" }
    ]
  },
  "ai-os-explore": {
    "description": "AI OS code exploration tools",
    "tools": [
      { "toolName": "search_codebase" },
      { "toolName": "get_file_summary" },
      { "toolName": "get_impact_of_change" },
      { "toolName": "get_dependency_chain" }
    ]
  },
  "ai-os-memory": {
    "description": "AI OS memory and planning tools",
    "tools": [
      { "toolName": "get_active_plan" },
      { "toolName": "upsert_active_plan" },
      { "toolName": "remember_repo_fact" },
      { "toolName": "get_repo_memory" }
    ]
  }
}
```

**Value:** Reduces friction for users to invoke the right AI OS tools. Surfaces AI OS capabilities naturally in VS Code's Chat UI.

---

### High Priority — Generate Custom Chat Modes (VS Code v1.101)

**What:** VS Code v1.101 added custom chat modes via `*.chatprompt.md` files with `description:` and `tools:` front matter.

**Gap:** AI OS generates prompt files but not custom chat mode files.

**Proposed action:** Add generation of at minimum 2 custom modes:

**`ai-os-plan.chatprompt.md`** — read-only planning mode:

```markdown
---
description: "AI OS Planning Mode — read-only research and task decomposition"
tools:
  - get_session_context
  - get_repo_memory
  - get_project_structure
  - get_conventions
  - get_stack_info
  - get_file_summary
  - get_impact_of_change
  - search_codebase
  - upsert_active_plan
---
You are in planning mode. Do NOT write or modify files.
Use AI OS context tools to research before recommending any change.
Always call get_session_context and get_repo_memory first.
```

**`ai-os-review.chatprompt.md`** — code review mode:

```markdown
---
description: "AI OS Code Review Mode — security, conventions, and quality analysis"
tools:
  - get_conventions
  - get_repo_memory
  - get_stack_info
  - search_codebase
  - get_impact_of_change
---
You are in code review mode. Do NOT modify files.
Apply conventions from get_conventions. Flag security issues first.
```

**Value:** Enables project-specific agent behaviors without users needing to manage prompt files manually. These modes make AI OS "the way you start every session."

---

### High Priority — Migrate Prompt Files to `.prompt.md` Format (VS Code v1.100)

**What:** VS Code v1.100 formalized `.prompt.md` with `mode:` and `tools:` front matter. AI OS currently generates `prompts.json` which is a proprietary format.

**Gap:** AI OS prompts exist but are not in the VS Code-native `.prompt.md` format, so they don't appear in `Chat: Use Prompt` or autocomplete in VS Code chat.

**Proposed action:**
- Add `generators/prompt-files.ts` to generate `.github/copilot/prompts/*.prompt.md` files
- Convert the lifecycle prompts (`/define`, `/plan`, `/build`, `/verify`, `/review`, `/ship`) to `.prompt.md` format
- Keep `prompts.json` for backwards compatibility (or deprecate with migration note)

**Example:**

```markdown
---
description: "Structure feature intent and scope before any implementation"
mode: ask
tools: [get_session_context, get_repo_memory, get_conventions]
---
# /define — Feature Definition

Before any code is written, clarify: ...
```

---

### Medium Priority — Add MCP Prompts as Slash Commands (VS Code v1.101)

**What:** VS Code v1.101 added MCP prompt support. MCP prompts become slash commands: `/mcp.ai-os.promptname`.

**Gap:** AI OS MCP server has no prompt definitions — users can't invoke common workflows as slash commands.

**Proposed action:** Add 3–5 prompt definitions to `src/mcp-server/index.ts`:

| Prompt | Slash Command | Purpose |
|--------|--------------|---------|
| `session_start` | `/mcp.ai-os.session_start` | Load context, memory, conventions in one shot |
| `pre_commit_check` | `/mcp.ai-os.pre_commit_check` | Check changed files against conventions + memory |
| `architecture_review` | `/mcp.ai-os.architecture_review` | Structured architecture analysis workflow |

**Value:** Makes AI OS workflows discoverable via `/` in chat — dramatically lowers the "first use" barrier.

---

### Medium Priority — Add PHP/WordPress Stack Support (Issue #104)

**What:** PHP/WordPress projects get no context from AI OS currently.

**Proposed action:**
- Language detector: detect `.php` files, `composer.json`, `wp-config.php`
- Framework detector: detect `functions.php`, plugin headers, theme structure
- Add `templates/frameworks/wordpress.md` overlay
- Add `templates/skills/wordpress.md`
- Wire up to recommendation registry

**Impact:** Unlocks AI OS for the largest CMS segment on the web.

---

### Medium Priority — Generate Prompt Quality Pack Automatically (Issue #127)

**What:** The Prompt Quality Pack (`prompt-quality.instructions.md`) in this repo is a valuable guide but must be manually created in target repos.

**Proposed action:** Generate `.github/instructions/prompt-quality.instructions.md` during `--refresh-existing` with:
- Agent routing table (populated from generated agents)
- Skill trigger keywords (from installed skills)
- MCP health check steps
- Plan-mode triggers
- Anti-patterns

**Value:** Every AI OS install immediately documents "how to use Copilot effectively in this repo."

---

### Lower Priority — Expose Context Docs as MCP Resources (VS Code v1.101)

**What:** VS Code v1.101 added MCP resource support — servers can expose files/data that users can browse and attach.

**Gap:** AI OS has rich context docs (`stack.md`, `architecture.md`, `conventions.md`) but they're only accessible via `get_stack_info`, `get_conventions`, etc.

**Proposed action:** Register AI OS context docs as MCP resources in `src/mcp-server/index.ts`:

```typescript
server.resource("ai-os://context/stack", "Current stack and dependencies")
server.resource("ai-os://context/architecture", "Architecture overview")
server.resource("ai-os://context/conventions", "Coding conventions")
server.resource("ai-os://memory", "Repository memory (read-only)")
```

**Value:** Users can attach any AI OS context doc as a chat resource directly in VS Code's resource picker.

---

### Lower Priority — Auto-Run Doctor in install.sh (Issue #123)

Simple UX improvement: add `npm run doctor` at the end of `install.sh`. No architecture changes needed.

---

## Section 3 — What to CHANGE (Improvements to Existing Features)

### Change: Fix Security Vulnerabilities First (Issues #105, #106, #107)

**These are blockers.** No other enhancements should be merged until these are fixed.

**Priority order:**

1. **Shell injection in `searchFiles`** (#105) — replace string `execSync` with `execFile(command, [args])` or programmatic grep
2. **execSync callsite audit** (#106) — grep for `execSync(` in all TypeScript files, convert string-form calls to array-form `execFile`
3. **Template input sanitization** (#107) — add `sanitizeForMarkdown(value)` util; apply to project name, framework names, package names, path names before template interpolation

**Sanitization should:**
- Strip characters not in `[a-zA-Z0-9\s\-_./]`
- Limit string length (project name: max 100 chars)
- Remove markdown formatting characters (`*`, `#`, `[`, `]`, `` ` ``) from values used in template rendering

---

### Change: Atomic File Writes (Issue #110)

Replace all `fs.writeFileSync(path, content)` calls on manifest/config/tools/memory with:

```typescript
const tmpPath = path + '.tmp';
fs.writeFileSync(tmpPath, content);
fs.renameSync(tmpPath, path);
```

This is a low-effort, high-reliability improvement. Should be done as a utility wrapper: `atomicWriteFile(path, content)`.

---

### Change: Add JSON Schema Validation (Issue #109)

Add Zod schemas for:
- `config.json` → `AiOsConfigSchema`
- `manifest.json` → `ManifestSchema`
- `tools.json` → `ToolsFileSchema`
- Memory entries → `MemoryEntrySchema`

Validate on read (with friendly errors); validate before write (defensive). This catches the class of "silent type error causes confusing runtime failure" bugs.

---

### Change: Strengthen for Copilot Cloud Agent Usage

VS Code v1.101 introduced the Copilot Coding Agent and cloud agent integration. AI OS's memory and context system becomes a **critical dependency** for cloud agent quality — the agent has no interactive access to the user, so it relies entirely on pre-configured context.

**Changes needed:**
- `active-plan.json` should store acceptance criteria in machine-checkable form (not just prose)
- `failure-ledger.jsonl` should include structured retry strategy fields
- `compact_session_context` MCP tool should output a format optimized for cloud agent context window (concise, prioritized)
- Session start protocol should be documented as part of the generated `copilot-instructions.md` (currently only in `ai-os.instructions.md`)

---

### Change: Migrate to `.prompt.md` from `prompts.json`

The current `prompts.json` is a proprietary AI OS format. VS Code v1.100 standardized `.prompt.md` files. Migration plan:

1. Keep `prompts.json` for v0.x compatibility
2. Add `.prompt.md` generation in parallel
3. Deprecate `prompts.json` in v1.0

---

### Change: Expand Test Coverage to >40% (Issue #114)

The ~14% coverage leaves critical paths untested. Priority additions:

1. `src/generators/instructions.ts` — test 8KB enforcement, framework overlay rendering, sanitization
2. `src/generators/context-docs.ts` — test Mermaid diagram generation, placeholder resolution
3. `src/mcp-server/search.ts` — test that shell metacharacters in queries are safely handled
4. `src/analyze.ts` — test stack shape for each `examples/` directory
5. Add snapshot tests for each `examples/` repo → fixture comparison (#124)

---

## Section 4 — What to REMOVE

### Remove: Close Already-Implemented Refactoring Issues

Two open issues track refactoring work that appears to already be complete:

**Issue #113** (split `src/generate.ts`) — The `src/cli/` and `src/actions/` modules already exist. Verify `src/generate.ts` is now < 10 KB (orchestration only). If so, **close issue #113**.

**Issue #112** (split `src/mcp-server/utils.ts`) — The split modules (`freshness-bridge.ts`, `memory.ts`, `session.ts`, `recommendations-bridge.ts`, `search.ts`, `project-introspection.ts`) already exist. Verify `src/mcp-server/utils.ts` is now a small shared-helpers file. If so, **close issue #112**.

Leaving closed-work issues open pollutes the backlog and misleads contributors.

---

### Remove: `prompts.json` Generator (Eventually)

Once `.prompt.md` files are generated, the `prompts.json` generator should be deprecated. It's a non-standard format that requires custom parsing rather than using VS Code's native prompt discovery.

Timeline: deprecate in next minor release, remove in v1.0.

---

### Remove: Legacy Context Directory Detection (if cleaned)

`src/actions/check-hygiene.ts` scans for `.ai-os/context/` (pre-v0.3.0 artifacts). Once the user base has migrated (v0.10+ has been out for several releases), this scanner can be removed to reduce code complexity.

---

## Section 5 — Consolidated Priority Roadmap

### Patch (Immediate — Security)

| Item | Type | Source |
|------|------|--------|
| Fix shell injection in `searchFiles` | Bug/Security | #105 |
| Harden `execSync` callsites | Bug/Security | #106 |
| Sanitize template inputs | Bug/Security | #107 |
| Atomic file writes | Bug | #110 |

### Minor Release (v0.14.x)

| Item | Type | Source |
|------|------|--------|
| JSON schema validation on artifacts | Reliability | #109 |
| npm audit CI gate | CI | #119 |
| Auto-run doctor in install.sh | UX | #123 |
| Generate Prompt Quality Pack | Feature | #127 |
| Expand test coverage to 40% | Tests | #114 |
| Add examples/ snapshot tests | Tests | #124 |
| Close #112 and #113 if done | Cleanup | #112, #113 |

### Next Feature Release (v0.15.x)

| Item | Type | Source |
|------|------|--------|
| Generate `.toolsets.json` | Feature | VS Code v1.101 |
| Generate custom chat modes (`.chatprompt.md`) | Feature | VS Code v1.101 |
| Migrate to `.prompt.md` (parallel, not replacing) | Feature | VS Code v1.100 |
| PHP/WordPress stack support | Feature | #104 |
| MCP prompts (slash commands) | Feature | VS Code v1.101 |
| Architecture migration workflow | Feature | #128 |

### v1.0 Target

| Item | Type | Source |
|------|------|--------|
| Expose context docs as MCP resources | Feature | VS Code v1.101 |
| Cloud agent optimization (plan/memory schema) | Feature | Copilot Agent GA |
| Deprecate `prompts.json` | Cleanup | — |
| Bundle provenance attestation | Security/CI | #120 |
| Public `--uninstall` action | Feature | #117 |
| Auto-generate MCP tool reference docs | Docs | #111 |
| Split README.md into docs/ | Docs | #122 |
| `--json` output mode | Feature | #118 |

---

## Section 6 — Alignment Score Card

| Area | Current State | Target State | Gap |
|------|--------------|--------------|-----|
| `.instructions.md` with `applyTo:` | ✅ Fully implemented | Same | None |
| MCP server with 32 tools | ✅ Fully implemented | Add prompts/resources | Medium |
| Tool sets (`.toolsets.json`) | ❌ Not generated | Should generate | Add |
| Custom chat modes (`.chatprompt.md`) | ❌ Not generated | Should generate | Add |
| Prompt files (`.prompt.md`) | ⚠ Custom `prompts.json` format | Migrate to native | Migrate |
| MCP prompts / slash commands | ❌ Not implemented | Add 3-5 prompts | Add |
| MCP resources | ❌ Not implemented | Expose context docs | Add |
| Security (shell injection) | ❌ 3 open CVEs | Fixed | Fix first |
| Atomic writes | ❌ Non-atomic | Atomic helper | Fix |
| JSON schema validation | ❌ None | Zod schemas | Add |
| Test coverage | ⚠ ~14% | >40% | Expand |
| PHP/WordPress support | ❌ Undetected | Full support | Add |
| Freshness detection | ✅ Unique feature | Keep + promote | None |
| Memory with TTL + dedup | ✅ Solid | Cloud agent opt. | Minor |
| User block preservation | ✅ Unique feature | Keep | None |
| Copilot cloud agent optimization | ⚠ Basic support | Plan/memory schema | Improve |

---

## Conclusion

AI OS has a strong foundation that is well-aligned with where VS Code and GitHub Copilot are heading. The core architecture is sound; the main gaps are:

1. **Security** — three issues that must be fixed before recommending AI OS to teams
2. **New VS Code surface area** — tool sets, custom chat modes, MCP prompts, `.prompt.md` migration
3. **Stack gaps** — PHP/WordPress is the largest uncovered segment
4. **Quality** — test coverage is too low for a tool that writes files to users' repos
5. **Stale backlog** — two large refactoring issues are likely already done; closing them signals project health

Addressing these in the order listed above would make AI OS the unambiguous state-of-the-art Copilot context framework for any language or framework.
