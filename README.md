# AI OS

> **Portable GitHub Copilot context engine** — scan any repository and auto-generate an optimized AI context package: instructions, agents, skills, MCP tools, and slash-command prompts.

## What it does

Run once in any repo. AI OS scans the codebase, detects your stack, and generates:

| Artifact             | Location                                          | What it is                                                                         |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Copilot instructions | `.github/copilot-instructions.md`                 | System prompt optimized for your stack                                             |
| Context docs         | `.github/ai-os/context/`                          | Token-efficient stack, architecture, conventions docs                              |
| MCP tools            | `.vscode/mcp.json` + `.ai-os/mcp-server/`         | 22 tools for code search, memory, session continuity, and more                     |
| Agents               | `.github/agents/*.agent.md`                       | Stack-specific chat agents (framework expert, DB expert, auth, payments, explorer) |
| Skills               | `.github/copilot/skills/ai-os-*.md`               | AI OS-named per-library playbooks (Next.js, tRPC, Prisma, Stripe, etc.)            |
| Slash commands       | `.github/copilot/prompts.json`                    | `/new-page`, `/new-trpc-procedure`, `/new-model`, `/rag-query`, etc.               |
| Manifest             | `.github/ai-os/manifest.json`                     | Tracks every file AI OS owns — used for pruning stale artifacts on refresh         |

AI OS now also initializes a persistent repository memory store at `.github/ai-os/memory/` so agents can retain verified facts and decisions across long sessions.
Detection is package-aware for monorepos/mixed stacks, and MCP context tools provide parity coverage for Node, Java/Spring, Python, Go, and Rust projects.

Generated instructions also enforce strict behavior guardrails: ambiguity-first clarification (no improvisation), explicit allowed/forbidden action boundaries, and an escalation flow for underspecified requests.

## Requirements

- Node.js ≥ 20 **or** Docker (Node.js-free fallback)
- Git
- GitHub Copilot (VS Code extension)

**Target repositories do not need Node.js** — the MCP server is a pre-built, self-contained bundle (`dist/server.js`) with no npm dependencies.

## Install on any repo

### Install from a specific release tag (recommended for testing)

```bash
# Example: install from a specific tag into the current repo
npx -y "github:marinvch/ai-os#v0.6.26"

# Refresh an existing AI OS install from a tag
npx -y "github:marinvch/ai-os#v0.6.26" --refresh-existing
```

If your environment blocks `npx github:...`, use the tagged bootstrap script:

```bash
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/v0.6.26/bootstrap.sh | bash
```

### Fast bootstrap (paste in any target repo terminal)

```bash
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash
```

With options:

```bash
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash -s -- --refresh-existing --install-skill-creator --install-find-skills
```

### Local clone workflow

```bash
# Clone ai-os somewhere on your machine (once)
git clone https://github.com/marinvch/ai-os ~/ai-os

# Then run from inside any target repo:
bash ~/ai-os/install.sh

# Or point it at a specific repo:
bash ~/ai-os/install.sh --cwd /path/to/your/repo

# Optional: also install Anthropic's skill-creator globally (via Git Bash)
bash ~/ai-os/install.sh --install-skill-creator

# Optional: also install Vercel's find-skills globally (via Git Bash)
bash ~/ai-os/install.sh --install-find-skills

# Optional: install both skills in one run
bash ~/ai-os/install.sh --install-skill-creator --install-find-skills

# Optional: refresh existing generated AI OS artifacts
bash ~/ai-os/install.sh --refresh-existing
```

### Docker (no Node.js required)

If Node.js is not available locally, AI OS automatically falls back to Docker when it is present. You can also run the Docker image directly:

```bash
# Build the image once from the cloned ai-os repo
docker build -t ai-os ~/ai-os

# Run AI OS against any target repo (mounts the current directory)
docker run --rm -v "$(pwd):/repo" ai-os

# With options (e.g., refresh existing artifacts)
docker run --rm -v "$(pwd):/repo" ai-os --cwd /repo --refresh-existing
```

> **Note:** When installing via Docker the generated context files are written to your repo, but the MCP server runtime still requires Node.js ≥ 20 to run on your machine.

## Optional skill installs

AI OS can install the official `skill-creator` and `find-skills` skills.

```bash
npx -y skills add anthropics/skills@skill-creator -g -a github-copilot
npx -y skills add vercel-labs/skills@find-skills -g -a github-copilot
```

Notes:

- This install path is Git Bash-friendly and does not require Python.
- The install command above targets GitHub Copilot only.
- Some advanced `skill-creator` benchmarking workflows use Python scripts, but core skill usage/install does not.

## No Node.js?

AI OS works even if Node.js is not installed on your machine. When `install.sh` detects that Node.js is absent but Docker is available, it automatically:

1. Builds a local Docker image from the AI OS source (`Dockerfile` at repo root)
2. Runs the context generator inside the container with your target repo mounted

```bash
# This works with or without Node.js — Docker is used automatically if needed
bash ~/ai-os/install.sh --cwd /path/to/your/repo
```

> **Note:** The MCP server runtime requires Node.js to run locally. If you use the Docker fallback, install Node.js ≥ 20 afterward and re-run `install.sh` to also deploy the MCP tools.

## What gets detected

- **Languages:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Swift, Kotlin, and 30+ more
- **Frameworks:** Next.js, React, Vue, Angular, Svelte, Express, FastAPI, Django, Spring Boot, .NET, Laravel, Rails, Nuxt, Astro, Remix, tRPC, Prisma, and more
- **Tools:** ESLint, Prettier, Vitest, Jest, Playwright, Docker, GitHub Actions, package managers

## Generated MCP tools

| Tool                   | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `search_codebase`      | Ripgrep across project                   |
| `get_project_structure`| Annotated file tree                      |
| `get_conventions`      | Naming + architecture rules              |
| `get_stack_info`       | Full tech stack inventory                |
| `get_file_summary`     | Token-efficient file summary             |
| `get_prisma_schema`    | Full schema (if Prisma detected)         |
| `get_trpc_procedures`  | All tRPC procedures (if tRPC detected)   |
| `get_api_routes`       | All API routes with methods              |
| `get_env_vars`         | Required env vars (never values)         |
| `get_package_info`     | Installed package versions               |
| `get_impact_of_change` | Blast radius of changing a file          |
| `get_dependency_chain` | How a module connects to the rest        |
| `get_memory_guidelines`| Repository memory protocol               |
| `get_repo_memory`      | Retrieve durable project memory          |
| `remember_repo_fact`   | Persist verified memory entries          |
| `check_for_updates`    | Check if AI OS artifacts are stale       |
| `get_session_context`  | Reload MUST-ALWAYS rules and key context |
| `get_recommendations`  | Stack-appropriate tool and extension recs|
| `suggest_improvements` | Surface architectural and tooling gaps   |
| `get_active_plan`      | Read the current session goal and status |
| `upsert_active_plan`   | Create or update the active session plan |
| `append_checkpoint`    | Append a progress checkpoint             |
| `close_checkpoint`     | Mark a checkpoint as completed           |
| `record_failure_pattern`  | Track tool failures to avoid repeating   |
| `compact_session_context` | Summarize session state for continuity   |
| `set_watchdog_threshold`  | Configure auto-checkpoint interval       |

## Install Profiles

AI OS ships three install profiles to control context density:

| Profile | Description |
|---------|-------------|
| `minimal` | Essentials only — instructions + MCP wiring. No agents, recommendations, session context card, or update-check workflow. |
| `standard` | Balanced default — most features on, predefined skills off. Recommended for the majority of projects. |
| `full` | All stack-relevant integrations — generates agents, recommendations, session context card, update-check workflow, and predefined skills. |

To install with a profile:

```bash
# Fresh install with a profile
bash install.sh --profile minimal
bash install.sh --profile standard
bash install.sh --profile full

# Or via npx
npx -y "github:marinvch/ai-os" --profile minimal

# Refresh with a different profile
bash install.sh --refresh-existing --profile full
```

The chosen profile is persisted in `.github/ai-os/config.json` under the `"profile"` key and re-applied on subsequent refreshes (unless overridden by a new `--profile` flag). The active profile is shown in the install summary.

To override individual flags after install, edit the feature toggles in `.github/ai-os/config.json` directly and run `--refresh-existing` — manual overrides are preserved through refreshes unless a new `--profile` flag is passed.

## Re-running (idempotent)

Safe to run multiple times:

- Existing **agents** and **skills** are never overwritten in safe mode
- Existing **prompts** are kept; only new IDs are added
- **write-if-changed**: every generator compares content before writing — files with identical content are skipped, so re-runs produce zero git noise
- **manifest tracking**: `.github/ai-os/manifest.json` records every file AI OS owns after each run
- **pruning**: in `--refresh-existing` mode, files in the previous manifest that are no longer generated (e.g. a skill for a framework you removed) are deleted automatically
- MCP runtime writes `.ai-os/mcp-server/runtime-manifest.json` with a SHA-256 hash of the bundle; re-runs skip the copy when the hash is unchanged

To also update existing generated agents, skills, prompts, and MCP config from latest templates:

- `bash install.sh --refresh-existing`
- `npm run generate:refresh -- --cwd /path/to/target-repo`

To force pruning even without a full refresh:

- `npm run generate -- --cwd /path/to/target-repo --prune`

To completely remove all AI OS artifacts tracked in the manifest:

- `bash install.sh --uninstall`

If MCP runtime diagnostics are needed:

- `AI_OS_MCP_DEBUG=1 node .ai-os/mcp-server/index.js --healthcheck`

To validate post-install health and get actionable fix commands:

- `npm run doctor`
- `npm run generate -- --cwd /path/to/target-repo --doctor`

The doctor checks:
- MCP runtime binary exists and passes healthcheck
- `.vscode/mcp.json` present with correct `servers["ai-os"]` entry
- MCP server command path resolves on disk
- `.github/ai-os/config.json` and `tools.json` present and valid
- AI OS skills deployed

Critical failures exit non-zero; warnings exit 0.

Generated skill files use `ai-os-*.md` naming and stale ones are auto-pruned on refresh.

## Protecting custom edits from refresh

AI OS stores protection rules in `.github/ai-os/protect.json`.  Two modes are supported:

### Whole-file protection (`protected`)

Files in the `protected` list are **never overwritten or pruned** — even if they overlap with a managed path:

```json
{
  "protected": [
    ".github/agents/my-custom-agent.md",
    ".github/copilot-instructions.md"
  ]
}
```

### Block-level hybrid mode (`hybrid`) — _new in v0.10.1_

Files in the `hybrid` list are refreshed normally, but user-authored sections marked with special comment delimiters are re-inserted after each regeneration:

```markdown
# Generated content above

<!-- AI-OS:USER_BLOCK:START id="my-rules" -->
## My Custom Rules
- Always use tabs
- Never silence errors
<!-- AI-OS:USER_BLOCK:END id="my-rules" -->

# More generated content below
```

Configure which files use hybrid mode in `protect.json`:

```json
{
  "hybrid": [
    ".github/copilot-instructions.md",
    ".github/ai-os/context/conventions.md"
  ]
}
```

**Merge strategy (in priority order):**

1. **ID-match** — If the newly generated file still contains the same `START`/`END` markers, the user's block content replaces the default content in-place.
2. **Anchor-based** — If the generated file no longer has the markers but the line _immediately before_ the block in the old file still exists, the block is re-inserted after that anchor line.
3. **Conflict** — If neither strategy succeeds, the block is appended at the bottom of the file inside `<!-- AI-OS:CONFLICT -->` wrappers and a warning is printed.  Manually move the block to the correct location and remove the conflict markers.

**Conflict resolution:**

When a conflict is reported, the file looks like this:

```markdown
<!-- AI-OS:CONFLICT block="my-rules" — anchor lost; please reconcile manually -->
<!-- AI-OS:USER_BLOCK:START id="my-rules" -->
...your content...
<!-- AI-OS:USER_BLOCK:END id="my-rules" -->
<!-- AI-OS:CONFLICT:END -->
```

Move the user block to the correct location and delete both `AI-OS:CONFLICT` wrappers.



```bash
npm install
# Bundle the MCP server (produces dist/server.js — committed to the repo)
npm run bundle
# Run generator on a target repo
npm run generate -- --cwd /path/to/target-repo
# Dry run (shows detected stack, no files written)
npm run generate:dry -- --cwd /path/to/target-repo
# Onboarding plan only (no writes)
npm run generate -- --cwd /path/to/target-repo --plan
# Preview actions (no writes)
npm run generate -- --cwd /path/to/target-repo --preview
# Apply changes explicitly
npm run generate -- --cwd /path/to/target-repo --apply
# Verbose mode — show per-file write/skip/prune reasons
npm run generate -- --cwd /path/to/target-repo --verbose
# Install with a profile (minimal | standard | full)
npm run generate -- --cwd /path/to/target-repo --profile standard
# Refresh mode — update existing artifacts + prune stale files
npm run generate:refresh -- --cwd /path/to/target-repo
# Prune stale artifacts without full refresh
npm run generate -- --cwd /path/to/target-repo --prune
# Codebase-aware bootstrap (generates all AI OS files + auto-installs skills)
npm run bootstrap -- --cwd /path/to/target-repo
# Bootstrap dry-run — preview what would be applied, nothing changes
npm run bootstrap:dry -- --cwd /path/to/target-repo
# Check hygiene (detect stale node_modules, missing manifests, etc.)
npm run check-hygiene
# Validate post-install health and emit actionable fix commands
npm run doctor
# Check context freshness (detect drift between source changes and context artifacts)
npm run check-freshness
# Run unit tests
npm test
# Fast validation (build + unit tests only)
npm run validate:fast
# Full validation (build + unit tests + regression suite)
npm run validate:full
# Run regression suite (fixture matrix for all supported stacks — exits non-zero on failure)
npm run validate
```

## Session Continuity

AI OS ships a full session continuity model so agents can maintain goal alignment across long multi-tool interactions.

### How it works

1. **Active plan** — Use `upsert_active_plan` at session start to declare objective, acceptance criteria, and current step. Read it back any time with `get_active_plan`.
2. **Checkpoints** — Use `append_checkpoint` after each major completed step. Close them with `close_checkpoint`. Checkpoints cap at 100 entries and auto-trim oldest on overflow.
3. **Failure ledger** — Use `record_failure_pattern` to capture failed approaches so the agent avoids repeating them. Capped at 50 entries.
4. **Compact context** — Run `compact_session_context` any time context gets long. Writes a single recovery artifact (`compact-context.md`) with current goal, open checkpoints, and recent failures.
5. **Watchdog** — Every N tool calls (default: 8), AI OS automatically appends a checkpoint prompting re-alignment with the active plan. Adjust with `set_watchdog_threshold`.

### Session memory files

All session files live under `.github/ai-os/memory/session/`:

| File                  | Purpose                              |
| --------------------- | ------------------------------------ |
| `active-plan.json`    | Current objective and progress       |
| `checkpoints.jsonl`   | Progress log (capped at 100 entries) |
| `failure-ledger.jsonl`| Known failure patterns (capped at 50)|
| `compact-context.md`  | Latest recovery summary              |
| `runtime-state.json`  | Watchdog counter and threshold       |

> **Tip:** Add `.github/ai-os/memory/session/` to `.gitignore` to prevent session state from being committed.

## Keeping projects up to date

When a new AI OS release ships, update your projects with one of the following approaches.

### Update a single project

```bash
# From inside the target repo
npx -y github:marinvch/ai-os --update

# Or from outside
npx -y github:marinvch/ai-os --update --cwd /path/to/your-repo
```

The `--update` flag is equivalent to `--refresh-existing` but also prints an explicit version bump message.

### Update all projects at once

Use the bundled `update-projects.sh` script (requires Node.js ≥ 20 and `npx`):

```bash
# Update a specific project
bash scripts/update-projects.sh /path/to/my-project

# Find and update all AI OS repos under ~/Projects
bash scripts/update-projects.sh --search-dir ~/Projects

# Preview without making changes
bash scripts/update-projects.sh --search-dir ~/Projects --dry-run

# Limit search depth (default: 5)
bash scripts/update-projects.sh --search-dir ~/Projects --depth 3
```

The script finds every directory with `.github/ai-os/manifest.json` and runs `npx -y github:marinvch/ai-os --update --cwd <repo>` on each one. Non-zero exit code if any update fails.

### Pin to a specific release

```bash
npx -y "github:marinvch/ai-os#v0.9.0" --update --cwd /path/to/your-repo
```

## Session Bootstrap Checklist

Use this at the start of every new Copilot conversation in a target repo using AI OS.

1. `get_session_context` to reload must-always rules and key commands.
2. `get_repo_memory` to recover durable project decisions.
3. `get_conventions` to enforce local coding style.
4. `get_impact_of_change` for each shared source file before edits.
5. Build/test after substantial implementation changes.

## Context Freshness Scoring

AI OS tracks context drift after structural code changes. After each generation run a
snapshot of artifact file hashes is written to `.github/ai-os/context-snapshot.json`.

### Check freshness from the CLI

```bash
# One-shot freshness check (exits non-zero when stale, safe on CI)
npm run check-freshness

# Or pass --check-freshness directly
npx -y github:marinvch/ai-os --check-freshness
```

Output example:

```
## Context Freshness Report

⚠️ **Status:** DRIFTED  |  **Score:** 72/100

- **Snapshot captured:** 2025-01-20T14:00:00.000Z
- **Last AI OS run:** 2025-01-20T14:00:00.000Z

### Stale Context Artifacts
- `.github/ai-os/context/conventions.md`

### Changed Source / Config Files
- `package.json`

### Recommendations
- Source changes detected in: package.json. Re-run `npx -y github:marinvch/ai-os --refresh-existing` to rebuild context artifacts.
```

### Check freshness via MCP tool

Use the `get_context_freshness` MCP tool in any Copilot session to instantly inspect
drift without leaving the editor:

```
get_context_freshness
```

### How scores are computed

| Score   | Status    | Meaning                                        |
|---------|-----------|------------------------------------------------|
| 90–100  | `fresh`   | Context artifacts match the last generation snapshot |
| 60–89   | `drifted` | Some source files or artifacts have changed    |
| 0–59    | `stale`   | Significant drift — re-run `--refresh-existing` |
| n/a     | `unknown` | No baseline snapshot found yet                 |

The score is `(unchanged_sources + intact_artifacts) / (total_tracked_files)`.

### CI integration

Set `CI=true` (or run in GitHub Actions where `GITHUB_ACTIONS=true`) — the
`--check-freshness` flag will exit with code 1 when the context is `stale`,
allowing you to gate deployments or PRs on context health.

## Knowledge Vault Workflow

AI OS now includes an Obsidian-style documentation workflow for durable, linked context.

- Workflow guide: `.github/ai-os/context/knowledge-vault.md`
- Reusable templates: `.github/ai-os/context/templates/`

Use these files to capture decision notes, prompt patterns, failure patterns, tool recipes, and task-scoped context packs.

## VS Code Tasks

For faster local validation, run these tasks from the VS Code task runner:

- `ai-os: test`
- `ai-os: build`
- `ai-os: validate`
- `ai-os: smoke`
- `ai-os: scorecard-check`
- `ai-os: quality-check`

## Weekly Quality Scorecard

Track weekly AI OS quality signals in `.github/ai-os/metrics/scorecard.json`.

Create or update a weekly entry:

```bash
npm run scorecard:update -- --week=2026-04-14 --first-pass=82 --tool-success=95 --rework=18 --time-to-fix=30 --context-hit=70 --notes="baseline after context-vault rollout"
```

Show the latest weekly entry:

```bash
npm run scorecard:show
```

Check that the latest weekly entry is fresh enough for ops gates (default: 14 days):

```bash
npm run scorecard:check
```

Use a custom age threshold:

```bash
npm run scorecard:check -- --max-age-days=10
```

Rate fields accept either 0-1 or 0-100 values.

## Smoke Test

Run a quick end-to-end smoke test for recent AI OS enhancements:

```bash
npm run validate:smoke
```

This validates core files, persistent rules, scorecard freshness, generated skill and agent contract sections, and generator `--plan`/`--preview` flows.

CI integration:

- `.github/workflows/ai-os-validate.yml` now runs `validate:ops` and `validate:smoke` for pull requests.
- Push validation also runs `validate:full` followed by `validate:smoke`.

## Automated Releases

AI OS uses `.github/workflows/release-automation.yml` to automate release tagging and GitHub releases.

- **Versioning policy:** The release tag is derived directly from the `version` field in `package.json`. Bump the version in your PR to master to control the release tag.
- **Trigger:** Releases are created after the `AI OS Validate` workflow succeeds on `master` (not on every push).
- **Safe no-op:** If a tag for the current `package.json` version already exists, the workflow skips release creation.
- **Post-release:** CI opens a PR to `dev` bumping `package.json` to the next patch version for future development.
- **Release notes:** Generated via GitHub release notes plus a commit-SHA summary section.

### View what changed in a release tag

Use these commands when a release page looks empty and you want to inspect the diff directly.

```bash
# Show commits included in a tag (replace versions as needed)
git log --oneline v0.6.25..v0.6.26

# Show changed files between two tags
git diff --name-status v0.6.25..v0.6.26

# Open GitHub compare page in browser format:
# https://github.com/marinvch/ai-os/compare/v0.6.25...v0.6.26
```

If you use GitHub CLI, these are useful too:

```bash
# View release details
gh release view v0.6.26

# Generate and print release notes body
gh api repos/marinvch/ai-os/releases/generate-notes -f tag_name=v0.6.26 --jq .body
```

### --verbose flag

Pass `--verbose` (or `-v`) to see per-file decisions during generation:

```text
  ✏️  write   /repo/.github/copilot-instructions.md
  ⏭️  skip    /repo/.github/ai-os/context/stack.md  (unchanged)
  🗑️  prune   .github/copilot/skills/ai-os-old-skill.md  (stale — not in current generation)
```

This is useful for debugging why a file was or was not updated.

### --bootstrap flag — Codebase-Aware Bootstrap

Pass `--bootstrap` to run a **full baseline setup in one command**:

1. Analyzes the repo (language / framework / package manager)
2. Generates all AI OS context files, agents, skills, MCP wiring, and prompts
3. Auto-installs stack-relevant agent skills via the skills CLI (requires `npx` + internet)
4. Prints an **apply report** showing every action taken and why it was triggered

```bash
# Full bootstrap — generates + installs skills
npx -y "github:marinvch/ai-os" --bootstrap

# Dry-run — shows what would happen, nothing is written or installed
npx -y "github:marinvch/ai-os" --bootstrap --dry-run
```

Example dry-run output:

```text
  ╔════════════════════════════════════════╗
  ║  Bootstrap Plan (DRY RUN) — my-app     ║
  ╚════════════════════════════════════════╝

  Detected Stack:
    Language:    TypeScript
    Frameworks:  Next.js, React
    Pkg Manager: npm
    TypeScript:  Yes

  Bootstrap Plan:

  🔲 [skill]    nextjs                 ← triggered by: Next.js
       Install: npx -y skills add vercel-labs/agent-skills@nextjs -g -a github-copilot
  🔲 [skill]    vercel-react-best-prac ← triggered by: Next.js
       Install: npx -y skills add vercel-labs/agent-skills@vercel-react-best-practices -g -a github-copilot
  🔲 [skill]    context7               ← universal — recommended for every project
       Install: npx -y skills add intellectronica/agent-skills@context7 -g -a github-copilot
  🔲 [vscode]   bradlc.vscode-tailwindcss ← triggered by: Next.js
       Install: code --install-extension bradlc.vscode-tailwindcss

  Summary: 4 action(s) planned (dry-run — nothing applied)
```

**Apply report icons:**
| Icon | Meaning |
| ---- | ------- |
| ✅  | Skill installed via skills CLI |
| 📋  | Informational — manual action required (MCP servers, VS Code extensions) |
| ❌  | Install attempted but failed (check error message) |
| 🔲  | Planned action (dry-run only) |

Skills with a **known source** are auto-installed. Skills without a registered source are shown as `📋 skipped` with the install command for manual use. MCP servers and VS Code extensions are always informational — see `recommendations.md` for the full list.

## MCP server modes

The MCP server (`src/mcp-server/index.ts`) supports two explicit modes:

| Mode                      | How to invoke        | Use case                        |
| ------------------------- | -------------------- | ------------------------------- |
| Standalone JSON-RPC stdio | default (no flag)    | VS Code Copilot MCP integration |
| Copilot SDK client        | `--copilot` flag     | Copilot CLI integration         |
| Health check              | `--healthcheck` flag | Post-install validation         |

The standalone mode is the default for VS Code. Passing `--copilot` is required to use the Copilot SDK client. If `--copilot` is passed and `@github/copilot-sdk` is unavailable, the server exits with an explicit diagnostic — it never silently falls back to a different mode.

**Bundle architecture**: `npm run bundle` uses esbuild to produce a single self-contained `dist/server.js`. The `@github/copilot-sdk` is a dynamic import loaded only when `--copilot` is passed, so the bundle has zero npm dependencies for the default standalone mode. This file is committed to the repository and deployed as-is — no `npm install` required in target repos.

## Rollout guide

### Applying to a new repo

```bash
# Bootstrap from anywhere (in target repo):
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash
```

### Updating an existing AI OS installation

```bash
bash install.sh --refresh-existing
# or:
npm run generate:refresh -- --cwd /path/to/repo
```

### Rollback

If an install or refresh causes issues:

1. Use `--uninstall` for a clean guided removal: `bash install.sh --uninstall` reads the manifest, shows all files to remove, prompts for confirmation, and cleans AI OS entries from `.gitignore`.
2. To remove all AI OS artifacts manually: `rm -rf .github/ai-os .github/copilot .github/agents .github/copilot-instructions.md`.
3. The `.github/ai-os/memory/` directory contains your repository memory — back it up before removal if needed.

### Verifying an install

```bash
# Health check the MCP server:
AI_OS_ROOT=. node .ai-os/mcp-server/index.js --healthcheck

# Full regression suite (ai-os dev repo only):
npm run validate
```

## Supported framework skill templates

`nextjs` · `react` · `trpc` · `prisma` · `stripe` · `auth-nextauth` · `rag-pgvector` · `supabase` · `go` · `express` · `python-fastapi` · `java-spring` · `bun` · `deno` · `solid` · `remix`

## Supported framework instruction templates

`nextjs` · `react` · `nuxt` · `vue` · `svelte` · `angular` · `astro` · `express` · `nestjs` · `trpc` · `prisma` · `drizzle` · `python-fastapi` · `python-django` · `java-spring` · `dotnet` · `php-laravel` · `ruby-rails` · `go` · `rust` · `react-native` · `expo` · `bun` · `deno` · `solid` · `vite` · `remix`

## License

MIT
