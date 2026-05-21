# AI OS User Guide

This is the advanced reference for power users of AI OS. Here you’ll find every CLI flag, agent and skill customization, MCP tool reference, memory management, CI integration, and upgrade strategy.

---

## CLI Flags Reference

| Flag | Description |
|------|-------------|
| `--bootstrap` | Full install + auto-install all recommended skills |
| `--profile minimal|standard|full` | Select install profile: minimal (instructions only), standard (default), full (all integrations) |
| `--dry-run` | Preview output without writing any files |
| `--full-diff` | Show unified diff of all changes (dry-run mode) |
| `--check-freshness` | Compute context freshness score (0–100) |
| `--check-drift` | Detect artifact drift (exits 1 if out of sync) |
| `--doctor` | Health check for MCP, config, and tools |
| `--compact-memory` | Run memory hygiene and deduplication |
| `--refresh-existing` | Regenerate all artifacts, prune stale files |
| `--clean-update` | Force full regeneration (major upgrades) |
| `--uninstall` | Remove all AI OS artifacts |
| `--cwd <path>` | Target directory for install/refresh |
| `--verbose` | Verbose output (debugging) |
| `--json` | Output results as JSON |
| `--plan` / `--preview` | Dry-run modes (no writes) |
| `--prune` | Remove stale generated files |

### Detailed Flag Explanations

- **`--bootstrap`**: Performs a full install and auto-installs all recommended skills for your stack.
- **`--profile minimal|standard|full`**: 
  - `minimal`: Only Copilot instructions and MCP wiring.
  - `standard`: Default; includes instructions, agents, skills, and tools.
  - `full`: All integrations, extra skills, advanced agents.
- **`--dry-run`**: Shows what would be generated/changed without writing files.
- **`--full-diff`**: Outputs a unified diff of all changes (useful for code review).
- **`--check-freshness`**: Computes a freshness score for your context artifacts, showing which are stale.
- **`--check-drift`**: Checks if your AI OS artifacts are out of sync with your codebase. Exits with code 1 if drift is detected.
- **`--doctor`**: Runs a health check on MCP server, config, and tools. Use after install or if something isn’t working.
- **`--compact-memory`**: Deduplicates and compacts repository memory entries.
- **`--refresh-existing`**: Re-scans and regenerates all artifacts, removing any that are no longer needed.
- **`--clean-update`**: Forces a full regeneration of all artifacts (recommended for major version upgrades).
- **`--uninstall`**: Removes all AI OS artifacts from your repo.
- **`--cwd <path>`**: Specify a different target directory (default: current directory).
- **`--verbose`**: Enables verbose logging for debugging.
- **`--json`**: Outputs all results in JSON format (for scripting/automation).
- **`--plan` / `--preview`**: Dry-run modes; show planned changes without writing.
- **`--prune`**: Removes any stale or orphaned generated files.

---

## Agent Customization

AI OS agents live in `.github/agents/*.agent.md`. Each agent file defines a specialist Copilot agent for a workflow (e.g., workspace, reviewer, planner).

**Required sections:**
- **Goal:** What the agent is for
- **Constraints:** What the agent must/must not do
- **Critical Files:** Key files the agent should know about

**Example:**

```markdown
# workspace.agent.md

## Goal
Assist with any project-wide task, enforcing repo conventions and memory.

## Constraints
- Never make changes outside the repo root
- Always use the MCP tools for file summaries

## Critical Files
- copilot-instructions.md
- .github/ai-os/context/conventions.md
- src/
```

You can create your own agents by copying and editing these files. Agents are auto-detected and appear in Copilot Chat.

---

## Writing Custom Skills

Skills are reusable playbooks for Copilot agents. They live in `.github/copilot/skills/`.

**Skill template:**

```markdown
# brainstorming.skill.md

## When to use
When you need to generate ideas or approaches for a new feature or problem.

## Steps
1. Clarify the problem
2. List at least 5 possible solutions
3. Evaluate pros/cons

## Example
"Brainstorm 3 ways to improve onboarding."
```

**To add a skill:**
- Place your `.md` file in `.github/copilot/skills/`
- Or run: `npx -y skills add <repo>/<skill>@<version>`

**To test a skill:**
- Reference it in Copilot Chat: `Use the brainstorming skill to ...`

---

## MCP Tool Reference

See [docs/mcp-tools.md](mcp-tools.md) for the full list of 27+ tools.

**5 most useful tools:**

- **`search_codebase`** — Search for patterns, symbols, or text across your codebase.
  - Example: `search_codebase("UserService")`
- **`get_project_structure`** — Get an annotated file tree of your project.
- **`get_conventions`** — See detected naming rules, file structure, and forbidden patterns.
- **`get_file_summary`** — Summarize a file’s exports, types, and functions.
- **`get_repo_memory`** — Retrieve persistent memory entries for architectural decisions.

---

## Protecting Custom Content (USER_BLOCKs)

**USER_BLOCKs** let you protect custom content from being overwritten. Syntax:

```markdown
<!-- AI-OS:USER_BLOCK:START id="my-block" -->
Your custom content here
<!-- AI-OS:USER_BLOCK:END id="my-block" -->
```

- **`protect.json`** tracks all USER_BLOCKs and their IDs.
- **Hybrid mode:** Only USER_BLOCKs are protected; other content is regenerated.
- **Full mode:** All manual edits are preserved (not recommended for most users).
- **Recovery:** If a USER_BLOCK is overwritten, restore from git history or re-add the block.

---

## Memory Management

- **`remember_repo_fact`** — Store a durable memory entry (deduped by content and TTL)
- **`get_repo_memory`** — Retrieve memory entries (optionally filtered)
- **`prune_memory`** — Compact and deduplicate memory
- **`memory.jsonl`** — Stores all memory entries (one JSON per line)
- **TTL** — Entries expire after a set time (configurable)
- **Dedup rules** — Newer entries with the same fact supersede older ones

---

## CI Integration

To enforce drift checks in CI, add a step to your workflow:

```yaml
- name: Check AI OS drift
  run: npx -y github:marinvch/ai-os --check-drift
```

- Fails the build if Copilot context is out of sync.
- Use `--check-freshness` for a freshness score.

---

## Upgrade Strategy

- To upgrade AI OS, re-run the installer:
  ```bash
  npx -y github:marinvch/ai-os
  ```
- For major version upgrades, use:
  ```bash
  npx -y github:marinvch/ai-os --clean-update
  ```
- Review the [Changelog](../CHANGELOG.md) for breaking changes.
- Artifacts are always regenerated safely; custom USER_BLOCKs are preserved.

---

For more, see [Getting Started →](GETTING-STARTED.md) or [MCP Tools Reference →](mcp-tools.md)
