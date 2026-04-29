# AI OS — CLI Reference

## Flags and Actions

| Flag | Description |
|---|---|
| `--cwd <path>` | Target repository (default: current directory) |
| `--dry-run` | Show detected stack and planned changes without writing files |
| `--plan` | Print onboarding plan only (no writes) |
| `--preview` | Preview planned actions (no writes) |
| `--apply` | Explicitly apply changes |
| `--refresh-existing` | Update existing artifacts + prune stale files |
| `--update` | Alias for `--refresh-existing` with version bump message |
| `--prune` | Prune stale artifacts without full refresh |
| `--uninstall` | Remove all AI OS-owned files (reads manifest) |
| `--bootstrap` | Full baseline setup: generate + auto-install skills |
| `--bootstrap --dry-run` | Preview bootstrap plan, nothing written |
| `--doctor` | Post-install health validation |
| `--check-freshness` | Check context drift (exits non-zero when stale in CI) |
| `--compact-memory` | Remove stale memory entries and print summary |
| `--verbose` / `-v` | Show per-file write/skip/prune reasons |
| `--profile <level>` | Install profile: `minimal` \| `standard` \| `full` |
| `--json` | Emit structured JSON output (CI consumers) |

## Common Workflows

```bash
# Dry run — inspect detection, no writes
npm run generate:dry -- --cwd /path/to/repo

# Fresh install
npm run generate -- --cwd /path/to/repo

# Refresh existing install
npm run generate:refresh -- --cwd /path/to/repo

# Bootstrap (generate + auto-install skills)
npm run bootstrap -- --cwd /path/to/repo

# Doctor check
npm run doctor

# Context freshness check
npm run check-freshness

# Compact memory
npm run compact-memory

# Prune stale artifacts
npm run generate -- --cwd /path/to/repo --prune
```

## Install Profiles

| Profile | Description |
|---|---|
| `minimal` | Instructions + MCP wiring only. No agents, recommendations, or workflows. |
| `standard` | Balanced default (recommended for most projects). |
| `full` | All stack-relevant integrations, predefined skills, and recommendations. |

The chosen profile is persisted to `.github/ai-os/config.json` and re-applied on subsequent refreshes unless overridden.

## `--dry-run` Output Format

```
  ✏️  write   /repo/.github/copilot-instructions.md
  ⏭️  skip    /repo/.github/ai-os/context/stack.md  (unchanged)
  🗑️  prune   .github/copilot/skills/ai-os-old-skill.md  (stale)
```

## `--bootstrap` Output

```
  ╔════════════════════════════════════════╗
  ║  Bootstrap Plan (DRY RUN) — my-app     ║
  ╚════════════════════════════════════════╝
  ...
  🔲 [skill]    nextjs  ← triggered by: Next.js
  Summary: 4 action(s) planned (dry-run — nothing applied)
```

Apply report icons:

| Icon | Meaning |
|---|---|
| ✅ | Skill installed via skills CLI |
| 📋 | Manual action required (MCP servers, VS Code extensions) |
| ❌ | Install attempted but failed |
| 🔲 | Planned action (dry-run only) |

## Environment Variables

| Variable | Effect |
|---|---|
| `AI_OS_MCP_DEBUG=1` | Enable MCP server debug logging |
| `CI=true` / `GITHUB_ACTIONS=true` | `--check-freshness` exits non-zero when stale |
