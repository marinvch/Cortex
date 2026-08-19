---
name: cortex-skills
description: Propose and write skills that fit THIS codebase — a webhook skill because the repo takes Stripe, a migration skill because it owns a Prisma schema, a first-test skill because it has none. Use after /cortex-scaffold, or when the user says "add skills for this project", "what skills should this repo have", "the skills here are generic". Proposes from the index; the user picks each one.
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

## 5. Report

List the skills written as paths, and say they are committed with the repo so the whole team gets
them. Then offer the natural next step: `/cortex-brief` for any area whose skill turned out to need
more depth than a skill body should hold.

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
  proposing, and nothing notices on its own.
