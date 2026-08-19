---
name: cortex-audit
description: Find and fix what is structurally wrong with a Cortex vault — orphan and non-connected files, dead links, stale, duplicate and misplaced files, wiring drift, privacy leaks. Dispatches the read-only `cortex-auditor` subagent to scan the whole vault in an isolated context, then applies the safe fixes here and surfaces the judgment calls. Triggers — "cortex audit", "diagnose the vault", "clean up cortex", "fix dead links", "is the file structure healthy", "find and fix the problems", "full health check".
capability: strong
---

# /cortex-audit — dispatch the auditor, then fix

One command for a complete health pass. It **delegates the scan** to the `cortex-auditor` custom
subagent (`agents/cortex-auditor.md`), which runs read-only in its own context so the heavy
globbing/link-mapping never bloats this conversation — then **you apply the fixes** here.

> Structure, not content. `/audit` scores the four knowledge layers and writes nothing; this finds
> and fixes the files those scores are computed over.

## What to do

1. **Dispatch the auditor.** Launch the `cortex-auditor` subagent (via the Agent/Task tool,
   `subagent_type: cortex-auditor`) with the vault root as its target. It returns one ranked findings
   report: structural categories (orphans, dead links, stale, duplicate, misplaced, integrity/privacy,
   **skill-wiring drift**) + a four-layer content-health signal. Each finding is tagged `[safe]` or
   `[judgment]`. If the subagent is unavailable, **read `agents/cortex-auditor.md` and run its scan
   inline** — it holds the categories, the method and the output shape, so the report comes out the
   same either way. Only the isolation is lost.
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

Pairs with [[reindex]] (regenerate the graph after cleanup) and complements [[audit]] (content
scoring). Targets **this vault** — `/optimize-context` is the same instinct pointed at another repo.

## When the floor is not met

The scan itself is mechanical — globbing, link maps, `git check-ignore`. What needs the floor is **ranking** the findings and calling `[safe]` versus `[judgment]`, and mistaking a judgment call for a safe one means an automatic fix to something that needed a human.

Below the floor: run it with **every finding treated as `[judgment]`** — report all of them and apply none automatically. The scan is still worth having; only the autonomy is withdrawn. The subagent fallback in step 1 is a separate concern: that is about the harness having subagents at all, not about model strength.
