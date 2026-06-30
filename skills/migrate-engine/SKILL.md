---
name: migrate-engine
description: Migrate a repo off the OLD engine-based AI OS (the retired `.ai-os/` MCP-server system) onto the new plain-files Cortex brain — WITHOUT losing memory. Use when a repo still has `.ai-os/`, `.github/ai-os/`, an `ai-os` MCP entry, or engine-generated `.github/agents`/`.github/copilot` artifacts, and the user says "remove the old ai-os", "migrate off the engine", "clean up the old brain", "move the old memory into Cortex". Plain files — no engine, no Node. Harvest first, delete second.
---

# /migrate-engine — move the old brain into Cortex, then retire it safely

The earlier AI OS was an **engine**: a Node/MCP-server system that scattered generated context,
a durable memory store, agents, and prompts across `.ai-os/` and `.github/`. Cortex replaced it
with plain files (`AGENTS.md` + shims + `docs/decisions.md`). This ritual moves any **hand-verified
knowledge** out of the old engine into the new brain, **then** removes the old files.

## The one rule: harvest before you delete

Engine memory is the only thing that isn't re-derivable from the code. **Never `rm` an engine
artifact until its knowledge is in `AGENTS.md` or `docs/decisions.md`.** Re-generatable scaffolding
(agents, prompts, dependency graphs, stack/architecture auto-dumps) can be dropped freely.

## Step 0 — Confirm scope & require a clean git tree
- Work ONLY inside the target repo (default: cwd). Never touch the personal vault.
- Check `git status` is clean (or stash). The migration is recoverable via git + the backup archive,
  but a clean tree makes the diff reviewable.
- If there's no new brain yet (`AGENTS.md` absent), run `/install-project` first — this ritual
  *enriches* the brain, it doesn't create it.

## Step 1 — Detect the old engine
Scan for any of these (presence of one = engine installed):
- `.ai-os/` (the MCP server) and an `ai-os` entry in `.mcp.json` / `.vscode/mcp.json`
- `.github/ai-os/` (config.json, manifest.json, context/, **memory/**, recommendations.md, tools.json)
- `.github/agents/*.agent.md`, `.github/copilot/**`, `.github/instructions/*.instructions.md`,
  `.github/skills/**`, `.github/COPILOT_CONTEXT.md`, `.github/workflows/ai-os-*.yml`
- `.vscode/*.chatprompt.md`, `.vscode/toolsets.json`
- An engine-style `.github/copilot-instructions.md` (references MCP tools like `get_session_context`)

List exactly what exists before touching anything.

## Step 2 — Harvest (high-signal → into the brain)
Read these, pull only durable, verified facts, and **fold them in**:

| Source (old engine) | What to take | Where it goes (new brain) |
|---|---|---|
| `.github/ai-os/memory/memory.jsonl` | Every active fact (title + content). **This is the crown jewels** — hand-verified repo knowledge. | `AGENTS.md` → `## Conventions` / `## Gotchas` / a new `## Security & data` section |
| `.github/ai-os/memory/session/failure-ledger.jsonl` | Recurring failure patterns, if non-empty | `AGENTS.md` → `## Gotchas` |
| `.github/ai-os/context/protected-blocks.md` | The `@ai-os:protect` convention, if used in code | `AGENTS.md` → `## Conventions` (rename marker if desired) |
| `.github/COPILOT_CONTEXT.md` + `config.json.persistentRules` | "MUST-ALWAYS" rules | `AGENTS.md` → `## Conventions` (dedupe against what's already there) |
| `.github/ai-os/context/{architecture,conventions,stack}.md` | Anything TRUE not already in `AGENTS.md`. These are mostly auto-generated — cross-check, don't blindly copy. | `AGENTS.md` (only the gaps) |
| `.github/copilot/skills/*.md`, `.github/instructions/*.md` | Genuine domain rules a human wrote | `AGENTS.md` or a repo `docs/` note |

Rules while harvesting:
- **Dedupe.** If `AGENTS.md` already says it, skip it.
- **Verify against the code.** Memory can be stale. If a fact names a file/flag, confirm it still
  exists before promoting it. Drop or correct anything wrong.
- **Keep it factual and concise** — one line per fact, evidence-based.
- Do NOT copy engine *mechanics* (MCP tool names, `get_session_context`, session protocols) — those
  die with the engine.

## Step 3 — Record the migration
Append a dated entry to `docs/decisions.md`: what was migrated, how many memory facts were folded
in, and what was removed. This is the audit trail.

## Step 4 — Back up everything you're about to delete
Before any `rm`, archive the full old-engine footprint so nothing is ever truly lost:
```bash
tar -czf ai-os-engine-backup-$(date +%Y%m%d).tar.gz \
  .ai-os .github/ai-os .github/agents .github/copilot .github/instructions \
  .github/skills .github/COPILOT_CONTEXT.md .github/workflows/ai-os-*.yml \
  .github/copilot-instructions.md.bak* .vscode/*.chatprompt.md .vscode/toolsets.json \
  .mcp.json .vscode/mcp.json 2>/dev/null || true
```
Keep the tarball outside the repo (or add it to `.gitignore`). Git history is the second safety net.

## Step 5 — Remove the old engine
Delete only what you backed up and harvested:
- `rm -rf .ai-os .github/ai-os .github/agents .github/copilot .github/instructions .github/skills`
- `rm -f .github/COPILOT_CONTEXT.md .github/workflows/ai-os-*.yml`
- `rm -f .vscode/*.chatprompt.md .vscode/toolsets.json` (leave the user's own `settings.json`)
- **`.mcp.json` / `.vscode/mcp.json`:** remove just the `ai-os` server entry. If it was the only
  entry, delete the file.
- **`.github/copilot-instructions.md`:** replace engine content with a shim → `AGENTS.md`
  (or leave the Cortex shim if `/install-project` already wrote one). Move old `*.bak` into the tarball.
- Clean stragglers: `.gitignore` lines that only referenced `.ai-os`/`.github/ai-os`; the
  `eslint.config.mjs` `.ai-os/**` ignore.

## Step 6 — Verify
- No engine artifacts remain: re-run the Step 1 scan → empty.
- `AGENTS.md` now contains the harvested facts; `docs/decisions.md` has the migration entry.
- The backup tarball exists.
- `npm run lint` (or the repo's lint) still passes.
- Show the user the diff and the list of removed paths. Done.

## Rules
- Harvest-before-delete is non-negotiable.
- Idempotent: safe to re-run; if nothing matches Step 1, report "no engine found" and stop.
- One repo at a time. Never promote company code/data into the personal vault.
