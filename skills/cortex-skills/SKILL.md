---
name: cortex-skills
description: Propose and write skills that fit this codebase's detected stack — a webhook skill for Stripe, a migration skill for Prisma. Triggers — "add skills for this project", "what skills should this repo have".
metadata:
  capability: judgment
---

# /cortex-skills — skills shaped by this repo, not by a default list

Every repo used to get the same two skills. A Next.js app with Prisma and no tests got exactly what
a Rust CLI got, because nothing downstream of the index could tell them apart. The context layer was
tailored and the skills were not.

The index knows the stack now. This turns that into skills the repo would actually use.

> Read-only until the user picks. Steps 1 and 2 write nothing.

## 1. Propose, from evidence

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-skills.mjs" .
```

If it reports no index, or one older than the working tree, re-index first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

**If `.cortex/` does not exist, ask before running that** — it is the first write, and this skill is
separately invocable on a repo where no other ritual has run. That is the write
[ADR 0005](../../docs/adr/0005-the-install-sequence-may-start-itself.md) gates: generated and
gitignored is not the same as invisible. The `.gitignore` entry is written for you at creation time;
the asking is not.

Show the detected stack and the proposals **with the reason each was surfaced** — the tool prints
them. Never present a bare list: a user cannot consent to a proposal they cannot evaluate, and the
reason is what lets them say "that one's wrong, we do use a test runner."

Then wait. The user picks. Some will be declined, and that is a correct outcome — a skill nobody
wanted is context load every session pays for.

**If the tool proposes nothing, say so and stop.** A repo with no manifest has no detectable stack,
and inventing skills for it is the exact failure this replaced.

## 2. Read before you write

For each accepted skill, open the code it describes. The proposal carries a `brief` saying what
belongs in the body; it does **not** carry the body, because a useful body quotes *this* repo's real
commands and real paths.

- The test command comes from `package.json` scripts, the Makefile, or wherever this repo keeps it —
  read it. A wrong command is the most costly error here: every future agent trusts it.
- Paths come from the index. A generated Prisma client is often **not** at the library default, and
  a skill that says otherwise sends every agent to a file that does not exist.
- If you cannot find the real command or path, say so in the skill body rather than guessing. "Run
  the tests — command not found in the manifest, confirm before relying on this" is honest and
  fixable. An invented command is neither.

## 3. Write one skill per accepted proposal

`.claude/skills/<id>/SKILL.md`, with frontmatter and a short body:

```markdown
---
name: <id>
description: <what it does, and the triggers that should reach it — see /writing-for-agents>
paths: <the proposal's paths line, copied verbatim — omit the line when the proposal has none>
---

# /<id> — <title>

<Two or three sentences: what this is for in THIS repo.>

## Steps
1. <the real command, the real path>

## Invariants
- <what must stay true, and the reason — the thing an agent could plausibly break>

## Verify
- <the command that proves it worked>
```

**`paths:` comes from the proposal, never from you.** The tool prints the line under each proposal
that earned one — `paths: prisma/**, **/*.prisma` for a Prisma schema — built from what the index
detected, and quoted when a glob would otherwise break the YAML. Claude Code then loads the skill
only when those files are in play. Copy it exactly. When the proposal has no `paths:` line, write
none: an empty value is a skill that never loads, and a guessed glob is one that never loads on the
file that matters. Agents that ignore `paths` read the skill as they always did.

Keep it **short**. A skill body is loaded whole when it fires; a 200-line skill is a brief in
disguise. If it grows past about 60 lines, the depth belongs in a scoped `AGENTS.md` leaf via
`/cortex-brief`, and the skill should point at it.

Do not restate what the root `AGENTS.md` already says. Duplication is how these rot: two copies
drift and neither is trusted.

## 4. Verify what you wrote

Do not report success without checking:

```bash
for d in <the ids you accepted>; do
  [ -f ".claude/skills/$d/SKILL.md" ] && echo "  ok      $d" || echo "  MISSING $d"
done
```

Then re-run `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-skills.mjs" .` — everything you wrote should
now appear under **Already present**. If a skill you just wrote is still proposed, it landed in the
wrong place.

And check every command you quoted actually exists. Run it, or grep the manifest for it.

Then **format what you wrote.** Write LF line endings. Run the repo's declared formatter
(`state.formatters` in `cortex-loop.mjs . --json`) on exactly the files you wrote, never on `.`.
Then run the repo's own lint/format check. A Prettier repo checks `.claude/skills/**/*.md` like
any other Markdown. If the check still fails on a file you wrote, report it with the output.

## 5. Report

List the skills written as paths, and say they are committed with the repo so the whole team gets
them. Then offer the natural next step: `/cortex-brief` for any area whose skill turned out to need
more depth than a skill body should hold.

## Refreshing a skill that drifted

Step 1's output ends with the skills already here that the repo now contradicts, one line per
finding — `line 8: says the repo has no tests, and the index counts 9 test files`. `--offers`
carries the same list as `drift`. Each finding is provable from disk; prose the check cannot prove
(a lint baseline that has since gone) is yours to spot while the file is open.

1. **Check whether it was edited since it was written.** Each `drift` entry carries `edited` and,
   when it is true, `editedNote` ("edited since it was written, 2 commits"): more than the commit
   that added it, or an uncommitted change, means a person worked on it, and their edit may be the
   only correct part. `git log --format='%h %an %s' -- .claude/skills/<id>/SKILL.md` shows who.
   The user must have seen that note before you touch the skill. When `/cortex` sent you here, its
   playback row carried it, so the one confirmation covers it and you do not ask again. Run on its
   own, **ask about that skill by name first**. `edited: null` means git could not say (no
   checkout): ask.
2. **Fix the flagged lines, in the body, from the code.** Open what the line described and write
   what is there now — the moved path (a `hint` names a same-named file; open it before trusting
   it), the real test count and command, a script the manifest declares. Frontmatter stays exactly
   as it is; so does every line nobody flagged and you did not verify wrong.
3. **Retire a skill whose premise is gone.** A setup skill for a harness that now exists has
   nothing left to say. Propose deleting it — the tool's own proposal usually names its successor —
   and delete only on a yes.
4. **Re-run `cortex-skills.mjs .`** — a refreshed skill no longer appears under the drift heading.
   If it still does, the line is still wrong.

## Gotchas

- **A generic skill is worse than no skill.** "Follow best practices when adding a route" costs
  context every session and teaches nothing. If the body would not name a real path, a real command
  or a real invariant of this repo, do not write it — decline the proposal out loud.
- **The proposals are ranked, and the ranking is the interview order.** It comes from
  `index/lib/skills.mjs`, where each candidate declares its own trigger. Add a stack-specific skill
  there rather than improvising one here, so the next repo with that stack gets it too.
- **Skills are per-repo; rituals are per-machine.** `/cortex-brief`, `/grilling` and the rest come
  from the installed plugin and work in any repo. What this writes is different: skills that only
  make sense *here*, committed with the code. Do not copy plugin rituals into a project.
- **Re-run after a stack change.** Adding Stripe to a repo means the webhook skill is now worth
  proposing, and nothing notices on its own. The same run is what notices a written skill going
  stale — see [Refreshing a skill that drifted](#refreshing-a-skill-that-drifted).
