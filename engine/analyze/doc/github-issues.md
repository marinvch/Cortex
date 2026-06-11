# AI OS — GitHub Issues Analysis

> Repository: marinvch/ai-os | Analysis Date: June 2025 | Issues Fetched: ~50

---

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Security | 3 | CRITICAL |
| Bugs / Reliability | 2 | NECESSARY |
| Tests | 2 | NECESSARY |
| CI/CD | 3 | RECOMMENDED |
| New Features | 6 | VARIES |
| Refactoring | 2 | RECOMMENDED (possibly done) |
| Documentation | 2 | RECOMMENDED |
| Optional / UX | 3 | OPTIONAL |
| Auto-generated / Bot | 2 | LOW |

---

## Critical Security Issues

### #105 — Shell Injection in `searchFiles` MCP Tool

**Status:** OPEN | **Label:** security, necessary | **Severity:** Critical

**Problem:** The `searchFiles` MCP tool passes user-controlled search terms directly to `execSync` or a shell command without proper escaping, enabling shell injection attacks.

**Impact:** Any caller of the `search_codebase` MCP tool (including AI agents) could inject shell commands through a crafted search pattern.

**Required fix:** Sanitize or escape the search term before use; switch to a programmatic grep library or at minimum use `execFile` with an argument array instead of `execSync` with a string.

**Relevant code:** `src/mcp-server/search.ts` (likely), `src/mcp-server/utils.ts`

---

### #106 — Audit and Harden Remaining `execSync` Callsites

**Status:** OPEN | **Label:** security, necessary

**Problem:** Multiple callsites in the codebase use the string form of `execSync(commandString)` rather than the safe `execFile(command, args[])` form. String-form `execSync` is vulnerable to shell injection if any variable is interpolated.

**Required fix:** Audit all `execSync` usage; convert string form → `execFile` with array args, or replace with Node.js API equivalents.

---

### #107 — Sanitize Stack-Derived Inputs Before Rendering Into Copilot Instructions

**Status:** OPEN | **Label:** security, necessary

**Problem:** The instructions generator uses stack-detected values (project name, framework names, detected patterns) directly in rendered Markdown without sanitization. A maliciously-crafted `package.json` name or repository name could inject prompt text into the generated Copilot instructions, leading to prompt injection attacks when Copilot processes the file.

**Required fix:** Sanitize all external-origin values (project name, package names, file paths, etc.) before interpolating into template output. Strip control characters and limit to expected character sets.

---

## Necessary Bugs & Reliability

### #110 — Atomic File Writes for Manifest/Config/Tools/Memory

**Status:** OPEN | **Label:** bug, necessary

**Problem:** All generated files (`manifest.json`, `config.json`, `tools.json`, `memory.jsonl`) are written non-atomically using direct `fs.writeFileSync`. An interrupted refresh (Ctrl-C, crash, power loss) leaves files in a corrupt intermediate state.

**Required fix:** Write to a `.tmp` file first, then atomic rename (`fs.renameSync`) to the target path.

---

### #109 — Schema-Validate JSON Artifacts

**Status:** OPEN | **Label:** necessary

**Problem:** `manifest.json`, `config.json`, `tools.json`, and memory files are written and read with no schema validation. Silent type errors (null fields, wrong shapes) cause hard-to-debug runtime failures.

**Required fix:** Add JSON Schema validation using `ajv` or Zod at read + write time for all AI OS JSON artifacts. Fail loudly with actionable error messages.

---

## Test Coverage

### #114 — Expand Unit Test Coverage to >40% on Critical Paths

**Status:** OPEN | **Label:** tests, necessary

**Problem:** Current unit test coverage is ~14% of files. Critical paths — `src/analyze.ts`, `src/generate.ts`, `src/generators/context-docs.ts`, `src/generators/instructions.ts`, most of `src/mcp-server/utils.ts` — have no unit tests.

**Required fix:** Add targeted Vitest tests for:
- Stack analysis result shape correctness
- Generator template rendering with edge-case inputs
- User block preservation (ID-match, anchor, conflict scenarios)
- Memory deduplication logic

---

### #124 — Add `examples/` Reference Repos with Snapshot Fixtures

**Status:** OPEN | **Label:** tests, recommended

**Problem:** The `examples/` directory has sample repo structures (nextjs-trpc-prisma, python-fastapi, etc.) but no deterministic test that verifies generated artifacts match expected snapshots.

**Required fix:** Add Vitest snapshot tests that run AI OS against each `examples/` directory and compare output against committed reference fixtures.

---

## CI/CD

### #119 — Add `npm audit --omit=dev` Gate in CI

**Status:** OPEN | **Label:** CI, necessary

**Problem:** No supply-chain security audit runs in CI. Published bundle dependencies are not checked for known CVEs.

**Required fix:** Add `npm audit --omit=dev --audit-level=high` as a CI step; fail build on high/critical vulnerabilities.

---

### #120 — Publish Bundle Provenance on Releases

**Status:** OPEN | **Label:** CI, recommended, security

**Problem:** Released bundles (`bundle/generate.js`, `bundle/server.js`) are not SLSA-attested. Users who install via `npx github:marinvch/ai-os` cannot verify supply chain integrity.

**Required fix:** Add GitHub Actions provenance attestation on release (`actions/attest-build-provenance`).

---

### #121 — Self-Host Scorecard Regression Check

**Status:** OPEN | **Label:** CI, recommended

**Problem:** Scorecard checks run manually; no automated regression guard exists.

**Required fix:** Add OpenSSF scorecard as a scheduled GitHub Actions workflow; fail on score drop.

---

## New Features

### #127 — Auto-Generate Prompt Quality Pack on `--refresh-existing`

**Status:** OPEN | **Label:** feature, recommended | **Author:** marinvch

**Problem:** Users get AI OS installed but have no structured prompt guidance. The Prompt Quality Pack (`prompt-quality.instructions.md`) must be written manually.

**Proposal:** Automatically generate `.github/instructions/prompt-quality.instructions.md` during `--refresh-existing` (and install) that includes:
- Agent routing table (which agent for what task)
- Skill trigger keywords
- MCP health check steps
- Plan-mode triggers
- Anti-patterns

**Notes:** This is the instruction file already present in this very repository (see `.github/instructions/prompt-quality.instructions.md`).

---

### #128 — Architecture Migrations Need Context Invalidation Workflow

**Status:** OPEN | **Label:** feature, recommended | **Author:** marinvch

**Problem:** When a project undergoes an architecture migration (e.g., Pages Router → App Router, REST → tRPC), existing AI guidance files become stale but there is no guided workflow to detect and remediate this.

**Proposal:** 3-phase migration protocol:
1. **Audit** — detect lingering references to replaced patterns
2. **Gate** — prevent agent from using stale context during migration
3. **Post-change context replacement** — auto-regenerate context docs after migration

**Notes:** The Architecture Migration agent in this repo (`Architecture Migration.agent.md`) partially addresses this but it's not fully integrated into the AI OS pipeline.

---

### #123 — Auto-Run `--doctor` at End of `install.sh`

**Status:** OPEN | **Label:** feature, recommended

**Problem:** Users install AI OS and may not realize critical checks failed (MCP binary missing, config file not created, etc.).

**Required fix:** Add `npm run doctor` call at the end of `install.sh`. If any critical check fails, print actionable fix commands and exit non-zero.

---

### #117 — Add Public `--uninstall` Action

**Status:** OPEN | **Label:** feature, necessary

**Problem:** Users cannot cleanly remove AI OS from a target repository. No documented uninstall path exists.

**Proposal:**
- Read `manifest.json` to identify all generated files
- Delete only generated files (preserve user blocks and custom artifacts)
- Remove AI OS entries from `.mcp.json` and `.vscode/mcp.json` (not other entries)
- Delete `.github/ai-os/` directory

**Notes:** `src/uninstall.ts` exists but may not be fully implemented or exposed.

---

### #104 — Add PHP/WordPress Stack Detection and Context Generation

**Status:** OPEN | **Label:** feature

**Problem:** PHP/WordPress projects are detected as "Unknown language" with no framework overlay, no skill recommendations, and no WordPress-specific best practices.

**Proposal:**
- Add PHP language detection
- Add WordPress detection (via `wp-config.php`, theme/plugin file patterns)
- Add WordPress-specific `copilot-instructions.md` overlay
- Add `wordpress` skill to skill registry
- Recommend WordPress-compatible MCP server if available

**Notes:** `examples/wordpress-site/` already exists in the repo but detection is not wired up.

---

### #118 — Add `--json` Output Mode for CI Consumers

**Status:** OPEN | **Label:** feature, optional

**Problem:** CI pipelines consuming AI OS output must parse human-readable terminal output. A structured JSON output format would enable reliable machine consumption.

**Proposal:** `--json` flag outputs structured JSON: `{ success, artifacts, errors, warnings, freshness }`.

---

## Refactoring Issues (Verify if Already Implemented)

### #113 — Split `src/generate.ts` (45 KB) into `cli/` and `actions/` Modules

**Status:** OPEN | **Label:** refactor, recommended

**Proposal:** Extract CLI arg parsing to `src/cli/args.ts` and `src/cli/dispatch.ts`; extract action implementations to `src/actions/`.

**⚠️ LIKELY ALREADY DONE:** The codebase already contains:
- `src/cli/args.ts` ✓
- `src/cli/dispatch.ts` ✓
- `src/actions/apply.ts` ✓
- `src/actions/bootstrap.ts` ✓
- `src/actions/check-freshness.ts` ✓
- `src/actions/check-hygiene.ts` ✓
- `src/actions/compact-memory.ts` ✓
- `src/actions/doctor.ts` ✓
- `src/actions/plan.ts` ✓
- `src/actions/preview.ts` ✓

**Recommendation:** Verify `src/generate.ts` file size is now below 45 KB. If so, close this issue.

---

### #112 — Split `src/mcp-server/utils.ts` (72 KB) into Focused Modules

**Status:** OPEN | **Label:** refactor, recommended

**Proposal:** Extract freshness, memory, session, recommendations, search, and project introspection logic from the monolithic `utils.ts`.

**⚠️ LIKELY ALREADY DONE:** The codebase already contains:
- `src/mcp-server/freshness-bridge.ts` ✓
- `src/mcp-server/memory.ts` ✓
- `src/mcp-server/session.ts` ✓
- `src/mcp-server/recommendations-bridge.ts` ✓
- `src/mcp-server/search.ts` ✓
- `src/mcp-server/project-introspection.ts` ✓

**Recommendation:** Verify `src/mcp-server/utils.ts` is now below 72 KB (should only contain shared helpers). If so, close this issue.

---

## Documentation Issues

### #122 — Split `README.md` into `docs/` Subpages

**Status:** OPEN | **Label:** documentation, recommended

**Problem:** `README.md` is a single large file covering installation, all CLI flags, configuration, profiles, agents, memory, etc.

**Proposal:** Move content to `docs/` subdirectory; README becomes a quickstart pointing to docs.

**Notes:** A `docs/` directory already exists with: `architecture.md`, `cli.md`, `contributing.md`, `mcp-tools.md`, `README-full.md`. The split appears partially done.

---

### #111 — Auto-Generate the MCP Tool Reference

**Status:** OPEN | **Label:** documentation, recommended

**Problem:** `docs/mcp-tools.md` is maintained manually; it can drift from actual tool definitions.

**Proposal:** Generate `docs/mcp-tools.md` from `src/mcp-server/tool-definitions.ts` during `--refresh-existing`.

---

## Optional / UX Issues

### #116 — Show Real Diff in `--dry-run` Output

**Status:** OPEN | **Label:** UX, recommended

**Problem:** `--dry-run` shows which files would change, but not what the content diff would be.

**Proposal:** Generate content in memory and produce a unified diff (no disk writes).

---

## Recently Closed Issues

| Issue | Status | Summary |
|-------|--------|---------|
| #126 | CLOSED | Duplicate of #127 (Prompt Quality Pack) |
| #125 | CLOSED | AI OS update v0.11.0 → v0.12.1 (auto-bot) |
| #94 | CLOSED | Memory hygiene engine — IMPLEMENTED in v0.10.1 |
| #93 | CLOSED | Version-compatible skills install commands — IMPLEMENTED |

---

## Open Bot/Auto Issues

### #156 — AI OS Update Available: v0.13.0 → v0.14.0

**Status:** OPEN | **Author:** github-actions[bot]

Auto-generated by the update-check workflow. Indicates AI OS itself has an available update.

---

## Priority Order for Implementation

Based on issue analysis and codebase state:

### Immediate (Block Release)

1. **#105** — Fix shell injection in `searchFiles`
2. **#106** — Harden `execSync` callsites
3. **#107** — Sanitize template inputs against prompt injection
4. **#110** — Atomic file writes

### Near-term (Next Release)

5. **#109** — JSON schema validation
6. **#119** — npm audit CI gate
7. **#114** — Expand test coverage >40%
8. **#123** — Auto-run doctor in install.sh

### Recommended Additions

9. **#127** — Auto-generate Prompt Quality Pack
10. **#104** — PHP/WordPress stack support
11. **#117** — Public `--uninstall` action
12. **#128** — Architecture migration workflow

### Cleanup

13. **#113** — Verify generate.ts split is done; close if so
14. **#112** — Verify mcp-server/utils.ts split is done; close if so
15. **#122** — Verify docs/ split is done; close if so
16. **#111** — Auto-generate MCP tool reference docs
