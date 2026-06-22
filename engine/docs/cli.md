# Cortex CLI Reference

## Actions

| Flag | Action | Description |
| --- | --- | --- |
| _(default)_ | `apply` | Generate or refresh all Cortex context files |
| `--refresh-existing` | `apply` | Refresh mode — update existing files, prune stale |
| `--update` | `apply` | Same as `--refresh-existing` with version bump message |
| `--plan` | `plan` | Print onboarding plan, no files written |
| `--preview` | `preview` | Print plan + "no files written" notice |
| `--dry-run` | `apply` | Show detected stack as JSON, no files written |
| `--doctor` | `doctor` | Post-install health validation |
| `--check-hygiene` | `check-hygiene` | Detect orphaned files, stale lock files, manifest drift |
| `--check-freshness` | `check-freshness` | Score context freshness vs source files |
| `--compact-memory` | `compact-memory` | Remove stale memory entries |
| `--check-boundaries` | `check-boundaries` | Read-only cross-domain leak report (non-`project` memory entries, missing personal-layer `.gitignore` rules) |
| `--bootstrap` | `bootstrap` | Full generation + auto-install skills |
| `--uninstall` | _(install.sh flag)_ | Guided removal of all Cortex artifacts |

## Flags

| Flag | Description |
| --- | --- |
| `--cwd <path>` | Target repo path (default: `process.cwd()`) |
| `--profile <minimal\|standard\|full>` | Install density profile |
| `--dry-run` | Show detected stack as JSON, no writes |
| `--verbose` / `-v` | Per-file write/skip/prune reasons |
| `--prune` | Prune stale artifacts without full refresh |
| `--regenerate-context` | Allow rewrite of curated context files during refresh |
| `--prune-custom-artifacts` | Also prune non-AI-OS artifacts in managed dirs |
| `--clean-update` | Aggressive refresh — equivalent to `--refresh-existing` |
| `--json` | Suppress human output; emit structured JSON to stdout |
| `--personal-brain-path <dir>` | Personal brain root for `project → personal` promotion (otherwise `CORTEX_PERSONAL_ROOT` / config) |

## Install Profiles

| Profile | Description |
| --- | --- |
| `minimal` | Instructions + MCP wiring only. No agents, skills, recommendations, or session context card. |
| `standard` | Balanced default — most features on, predefined skills off. |
| `full` | All integrations — agents, recommendations, session context card, update-check workflow, skills. |

Profiles are persisted to `.github/cortex/config.json` under `"profile"` and re-applied on subsequent refreshes.

## Common Workflows

```bash
# Fresh install
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash

# Refresh existing install
bash install.sh --refresh-existing

# Check if anything is stale without writing
node dist/generate.js --check-freshness --cwd /path/to/repo

# Health check after install
node dist/generate.js --doctor --cwd /path/to/repo

# Hygiene check (orphaned files, manifest drift)
node dist/generate.js --check-hygiene --cwd /path/to/repo

# CI: emit structured report and exit non-zero on failure
node dist/generate.js --doctor --json --cwd /path/to/repo
node dist/generate.js --check-freshness --json --cwd /path/to/repo
node dist/generate.js --check-hygiene --json --cwd /path/to/repo
```

## --json Output Mode

Pass `--json` to suppress all human-readable output and emit a single structured JSON object to stdout. Useful for CI integrations, dashboards, and programmatic consumers.

The flag is supported for these actions: `apply`, `doctor`, `check-hygiene`, `check-freshness`.

Exit codes follow the same rules as human mode: critical failures in `doctor` and hygiene issues both exit non-zero.

### apply / bootstrap

```json
{
  "action": "apply",
  "cwd": "/path/to/repo",
  "mode": "safe",
  "project": "my-app",
  "language": "TypeScript",
  "frameworks": ["Next.js", "React"],
  "packageManager": "npm",
  "typescript": true,
  "profile": null,
  "mcpToolCount": 29,
  "written": ["relative/path/to/written-file.md"],
  "skipped": ["relative/path/to/unchanged-file.md"],
  "pruned": ["relative/path/to/stale-file.md"],
  "agents": ["relative/path/to/agent.agent.md"],
  "preserved": []
}
```

For `--bootstrap`, the output includes an additional `bootstrap` field with the bootstrap report.

### doctor

```json
{
  "action": "doctor",
  "cwd": "/path/to/repo",
  "toolVersion": "0.11.0",
  "checks": [
    {
      "name": "MCP runtime binary present (.cortex/mcp-server/index.js)",
      "critical": true,
      "passed": true,
      "detail": "/path/to/repo/.cortex/mcp-server/index.js"
    }
  ],
  "criticalFailures": 0,
  "warnings": 0
}
```

### check-hygiene

```json
{
  "action": "check-hygiene",
  "cwd": "/path/to/repo",
  "issues": [],
  "passed": true
}
```

### check-freshness

```json
{
  "action": "check-freshness",
  "status": "fresh",
  "score": 1.0,
  "snapshotCapturedAt": "2025-01-20T14:00:00.000Z",
  "lastGeneratedAt": "2025-01-20T14:00:00.000Z",
  "staleArtifacts": [],
  "changedSourceFiles": [],
  "recommendations": []
}
```

## Dry-run Output Format

With `--dry-run`, Cortex prints the detected stack as JSON and exits:

```json
{
  "rootDir": "/path/to/repo",
  "projectName": "my-app",
  "primaryLanguage": { "name": "TypeScript", "percentage": 72 },
  "frameworks": [{ "name": "Next.js", "confidence": 0.95 }],
  "patterns": {
    "packageManager": "npm",
    "hasTypeScript": true,
    "namingConvention": "kebab-case",
    "monorepo": false,
    "srcDirectory": true
  }
}
```

## Bootstrap Output

With `--bootstrap`, Cortex runs full generation then auto-installs stack-relevant skills:

```
  ╔════════════════════════════════════════╗
  ║  Bootstrap Plan — my-app               ║
  ╚════════════════════════════════════════╝

  ✅ [skill]    nextjs       Install: npx -y skills add vercel-labs/agent-skills@nextjs ...
  📋 [mcp]      context7     Manual: npx -y skills add intellectronica/agent-skills@context7 ...
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `CORTEX_ROOT` | Override root directory for MCP server runtime |
| `CORTEX_MCP_DEBUG=1` | Enable verbose MCP server logging |
| `CI=true` | Enables CI mode — `--check-freshness` exits non-zero when stale |
| `GITHUB_ACTIONS=true` | Same as `CI=true` |
