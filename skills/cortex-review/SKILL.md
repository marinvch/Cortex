---
name: cortex-review
description: Review a change against the repo's OWN documented context — the AGENTS.md, CONTEXT.md and ADRs Cortex wrote — on two axes. Does the change break a documented rule, and did it just make one of those documents wrong? Use when the user asks to review a diff, check a change before committing, or asks whether the docs still match the code.
capability: judgment
---

# /cortex-review — read the context back

Cortex writes `AGENTS.md`, `CONTEXT.md` and ADRs. Until this ritual, nothing ever **read them
back**. The context layer could be generated, and audited for bloat by `/optimize-context`, and
never once consulted to judge a change.

That leaves two failures with nothing watching for them, and the second is the one no other review
tool looks for.

## The two axes

**Standards** — does the change break a rule this repo has written down? Not your taste, not
general best practice: a rule that appears in one of the documents below, quoted.

**Drift** — did the change make one of those documents **wrong**? Documentation rots silently
because a diff touches code and nobody re-reads the prose describing it. From this repo's own
history, both found by a human reading rather than by any check:

- `index/AGENTS.md` said *"Coverage uses two signals"* for weeks after it used three.
- `AGENTS.md` pointed at `mcp/lib/scrub.js` for months after scrub moved to `core/`.

Neither broke a test. Both misled the next agent that read them — the entire cost of a context
layer being *wrong* rather than merely absent.

### Drift without a diff — `--citations`

The pass above seeds only on files the change touched, so it is **structurally blind to the second
example**: once `mcp/lib/scrub.js` stopped existing, no diff could touch it, and the document naming
it was never flagged. `--citations` asks the question without a diff — it resolves the paths every
context document names — and classes each answer by how much is proven:

| Class | Means | Gate |
|---|---|---|
| `provable` | The path is gone and **git recorded where it went** | fails |
| `suspected` | The path is gone and nothing proves a destination | reports |
| `historical` | An ADR, or prose stating an absence ("…is deleted") — correct as written | reports |

Only `provable` fails, which is what makes it safe in CI. `--fix` emits a patch for that class and
nothing else; it writes no file. Run `--citations` bare on a repo that has had Cortex installed for
a while and never reviewed — that is the case this exists for.

It checks **pointers, not sentences**. "Coverage uses two signals" while the code used three is real
drift and invisible here, because the path was never wrong. That half still needs you.

## Run the evidence pass first

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" --staged        # what you are about to commit
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" --since HEAD~3  # a range
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" path/to/file.ts # named files
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" --staged --json # to walk it yourself

node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" --citations              # the whole layer, no diff needed
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" --citations --since HEAD~20 --json
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" --citations --fix        # a patch for the provable ones
```

Deterministic and read-only. It finds and cites; it never judges. It gives you:

- **Governing documents**, nearest scope first — the leaf `AGENTS.md` that owns the directory, then
  the root. Both apply: a review consulting only the leaf misses the repo-wide invariants.
- **Glossary terms** the change works in, from `CONTEXT.md`.
- **Documents that NAME something the change touched** — the drift candidates.

If it reports no context layer, say so and stop. There is nothing to review against, and
`/cortex-install` is the answer, not a review improvised from general principles.

## Then do the judging

1. **Read every governing document.** Not skim — the rules are prose, and the one that matters is
   rarely the one with a heading. Pair this with `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs"` when the change
   touches something widely imported; a documented rule about a module matters more when twenty
   files depend on it.
2. **For each documented rule the change touches, decide: followed, broken, or not applicable.**
   Quote the rule and cite `file:line`. A finding that cannot quote the document it rests on is not
   a standards finding — it is an opinion, and it belongs in the *other* section clearly labelled as
   such.
3. **For each named mention, re-read that line against the new code.** A mention is not a defect —
   it is where one would hide. Ask only: *is this sentence still true?* Report the ones that are
   not, with the line and what it should now say. To answer it, test the sentence's **claim**, not
   its subject. First name what the diff changed (a value, an identifier, a path or a behaviour).
   Then name the one fact the sentence asserts, and mark it stale only if the two are the same.
   - A literal the diff changed (an old path, an old identifier, a count or a default value) makes
     the line **stale**. "`max_sessions` defaults to 7" is stale once the default becomes 14.
   - A property the diff did not touch (precedence, determinism, clock use or a behavioural
     contract) leaves the line **true**, even though it shares a keyword with the change. "The
     environment variable wins over `max_sessions`" survives the default change above.
   - A line that **already** names the new path or identifier is correct, not stale.
   - A **historical record** is correct as written. This covers ADR rationale, CHANGELOG entries,
     and lines like "`a` was renamed to `b` in 2.39" or "the old name no longer exists". The
     `historical` class applies here too, not only under `--citations`.
   - **Renames split across both axes.** Say every caller was updated. A rule like "callers read it
     from `a()`" is still *followed* for standards. The sentence naming `a()` is still *drift*, so
     give the new name as the fix. A moved file named in a rule is drift, not a broken rule.
4. **Say what you could not check.** Rules described in prose without naming a path are invisible to
   the evidence pass, and a change can violate one without ever appearing in the drift list.

Keep **stale** separate from **unverified**. You may have only a diff *summary*, such as
"internal loop rewritten; behaviour unchanged". Treat it as the author's assertion, not as
evidence. Call a line stale only if the summary proves it false. A line's truth may depend on
hunks you cannot see, such as whether a new signal is combined the same way, or whether a
rewritten loop now reads the clock or randomness or iterates in a different order. List that
line as unverified and name the exact hunk or check that would settle it. Do not put it in the
stale list on suspicion, and do not clear it without saying you took the summary on trust.

## Optional — a second opinion from one angle

The two axes above are about the repo's **documents**: did this break a stated rule, and did it make
a document wrong. That is deliberately narrow, and it is blind to whole classes of defect that no
document happens to mention.

When a change touches something with a specialist failure mode — auth, a request path, a migration,
a UI control, anything operational — dispatch the role reviewer
(`subagent_type: cortex-role-reviewer`) with a role and the
diff. Useful roles: `security`, `performance`, `accessibility`, `data-integrity`, `operability`,
`dx`.

Pick roles by what the diff actually touches, not by running all six. A reviewer with nothing to say
for its angle is a correct outcome, but six of them produce a report nobody reads, and the one real
finding drowns. One or two, chosen because the change earns them.

Each reviewer grounds itself in `cortex-impact.mjs` and must cite `path:line` — the whole point is to
avoid a generic checklist that is true everywhere and actionable nowhere. Findings come back to you;
fold them in below the document axes, which stay first because they are the ones nothing else looks
for.

## Reporting

Lead with drift, then broken rules, then everything else. Drift comes first because it is the
finding the author cannot see for themselves — the code in front of them looks right, and the
sentence describing it is somewhere else.

Give every named mention a verdict (stale, still true or unverified) with a one-line reason. A
cleared line shows it was checked, not skipped.

Never edit a document on your own authority here. `/cortex-review` reports; the human decides what
the sentence should say, the same way `/optimize-context` never deletes prose it merely judged
bloated.

If nothing is wrong, say that plainly and name what you checked. A review that manufactures a
finding to look useful costs more than one that returns clean, because the next one gets skipped.
