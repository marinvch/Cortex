---
name: cortex-audit
description: Use when the user says "cortex audit", "audit the project/vault", "run the auditor", "find and fix the problems", "full health check", or "run cortex-audit". One-shot meta-audit — dispatches the read-only `cortex-auditor` subagent to scan the WHOLE vault (structure + a content-health signal) in an isolated context, then applies the safe fixes and surfaces the judgment calls. Unifies /audit (content) and /cortex-doctor (structure) into one autonomous pass.
---

# /cortex-audit — dispatch the auditor, then fix

One command for a complete health pass. It **delegates the scan** to the `cortex-auditor` custom
subagent (`.claude/agents/cortex-auditor.md`), which runs read-only in its own context so the heavy
globbing/link-mapping never bloats this conversation — then **you apply the fixes** here.

> Sits above its siblings: `/audit` scores content, `/cortex-doctor` fixes structure, `/reindex`
> rebuilds the graph. `/cortex-audit` runs the auditor once and acts on the whole report — reach for
> it when you want "check everything and clean it up" in a single step.

## What to do

1. **Dispatch the auditor.** Launch the `cortex-auditor` subagent (via the Agent/Task tool,
   `subagent_type: cortex-auditor`) with the vault root as its target. It returns one ranked findings
   report: structural categories (orphans, dead links, stale, duplicate, misplaced, integrity/privacy,
   **skill-wiring drift**) + a four-layer content-health signal. Each finding is tagged `[safe]` or
   `[judgment]`. If the subagent is unavailable, fall back to running the scan inline using the same
   method in that agent file.
2. **Show the report** to the user — findings by category, plus the graph's node/link/**dead-link**
   counts.
3. **Lead with the employer firewall.** Per `AGENTS.md`, day-job content in a personal vault is a
   **critical finding**, not a style nit — report it *above* the structural findings and the health
   signal, naming file and line. The fix is to move the file into a gitignored
   `archives/<name>-YYYY-MM-DD/` folder and confirm with `git check-ignore -v` that it landed there
   ignored. Treat it as `[judgment]`: show it, don't sanitize-and-file, and don't act until the user
   decides. If the report is clean on this, say so in one line and move on.
4. **Apply the `[safe]` fixes** (these are mechanical + reversible):
   - resolve dead links; wire orphans in (add `[[links]]` from `home.md`/a MOC/related notes);
   - add missing frontmatter; move misplaced files to the right PARA folder;
   - **mirror unwired skills** into `.claude/skills/` and add missing `AGENTS.md`/`README.md` entries;
   - archive truly-dead files (`move` to `archives/`, **never delete**).
5. **Surface the `[judgment]` calls** — redundant merges, "stale or just quiet?", anything ambiguous.
   Don't guess; let the user decide, then execute their call.
6. **Re-run `bash tools/cortex.sh`** to confirm the graph improved (fewer orphans, `0 dead`), and
   report: findings by category, what you fixed, and what's left for the user to decide.

## Don't
- **Never delete** — move to `archives/`. Deletion is the user's call only.
- Keep committed files **data-free** — never write personal/business facts into a shared file.
- The subagent is read-only by design; **all writes happen here**, only after the report is shown.

## Autonomy
Default: auto-apply `[safe]` fixes, pause for the user on every `[judgment]` call. If the user asks
to approve each edit, switch to proposing all fixes first.

Pairs with [[reindex]] (regenerate the graph after cleanup). Complements `/audit` (content scoring)
and `/cortex-doctor` (the manual structural pass); this is the subagent-driven superset.
