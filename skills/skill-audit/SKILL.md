---
name: skill-audit
description: Judge a skill collection by what it actually does for the person using it — which skills nothing has ever reached, which two cover the same job, which are so thin a plain prompt would do better, and which are correct but never found. Use on "review my skills", "which skills do I actually use", "are any of these redundant", "clean up my skills", "why does Claude never use this skill", "прегледай ми скиловете". Reports; deletes nothing on its own.
capability: judgment
---

# /skill-audit — the collection, not the file

Every other audit reads the skills. This one reads the **record of them being used**, because a
skill's real defect is usually invisible in its own file: well written, correct, wired in, and
nobody has ever reached it. On this vault the first run found **28 of 42 skills never reached in 51
sessions** — none of which any amount of re-reading the skill bodies would have revealed.

Deleting is the least interesting outcome. A skill nothing reaches is more often a **routing**
failure than a quality one, and the fix is usually one line in a neighbouring skill.

## 1. Measure before reading anything

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-skill-usage.mjs"            # typed vs auto, per skill
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-skill-usage.mjs" --unused   # the never-reached list
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-skill-graph.mjs"            # who reaches whom

# exposure — when each skill first existed, against the window the sessions cover
for d in skills/*/; do echo "$(git log --format=%ad --date=short -- "$d" | tail -1)  $(basename "$d")"; done | sort
```

**Read the exposure dates first.** A skill added on the last recorded day has had no chance to fire,
so its zero is arithmetic and not evidence. Cortex's second run reported `/skill-audit` itself as
never reached — four of the 28 were younger than the newest session in the record. Judge only the
skills that were present for most of the window, and say which ones you set aside.

The two counts are separate on purpose, and the gap between them is the diagnosis:

| typed | auto | What it means |
|---|---|---|
| > 0 | 0 | the description does not match how the work actually arrives |
| 0 | > 0 | it triggers on its own — the slash command is decoration |
| 0 | 0 | nothing reaches it; the graph says whether that is wiring or a missing front door |

**The usage tool reads a transcript directory holding everything the user has ever typed.** It
extracts skill names and timestamps only. Do not go read those transcripts yourself to "get more
context" — that is a different act with a different consent question, and this ritual does not
include it.

## 2. Rank each skill, and be honest that the criteria differ in strength

Four questions per skill, strongest signal first:

1. **Was it ever reached?** Measured. Not an opinion.
2. **Does another skill cover the same job?** Two skills whose descriptions would both fire on the
   same sentence are worse than either alone — the model picks one, inconsistently, and the user
   cannot predict which. Read the `description:` lines side by side; that is what the model sees.
3. **Would a plain prompt do better?** A skill earns its place by holding something a prompt cannot:
   a sequence that must not be reordered, a constraint that gets forgotten, a hard-won gotcha, a
   script. A skill that only says "be careful and thorough" is a prompt wearing a costume.
4. **Is it stale?** Weakest, and often *backwards* — a skill that is correct does not get edited, so
   age measures stability as often as rot. Use it only to prompt a re-read, never as a verdict, and
   check the claims rather than the date: a skill naming a file, flag or command that no longer
   exists is stale in the way that matters.

## 3. Diagnose a never-reached skill before rewriting it

Three different causes, three different fixes, and reaching for the wrong one makes things worse:

- **Nothing points at it.** `cortex-skill-graph.mjs` says so. The fix is an edge from the ritual that
  should hand off to it, not a pushier description. Ten rituals here were reachable only by someone
  who already knew they existed; the fix was one front door.
- **The description does not match the words the user actually uses.** Compare it against how the
  request really arrives — including other languages, and including the vague version. This is where
  a rewrite genuinely helps, and the `skill-creator` plugin has a measured loop for it (a train/test
  split over realistic queries) rather than guessing.
- **It is a deliberate act.** `/dream`, `/handoff`, `/team-init` are things a person *decides* to do.
  Zero auto-invocations is correct for these, and making them auto-fire would be a defect, not a
  fix. **Never "optimize" a skill into triggering itself when the user should be choosing.** Say
  which skills you placed in this category and why, so the judgment is visible rather than assumed.

## 4. Report, then ask

One table, ranked by what you would act on first:

```
| Skill | Used | Verdict | Why | Proposed |
|---|---|---|---|---|
| /catch-me-up | 0 | never reached | no ritual pointed at it | edge from /resume |
| /foo | 0 | redundant | /bar fires on the same sentence | merge into /bar |
| /baz | 3 | keep | — | — |
```

**Propose; do not delete.** Deleting a skill throws away someone's written judgment, and the case for
removal is nearly always weaker than it looks after five minutes of reading. Merging two skills, or
adding one line of routing, resolves most of what this finds.

Where the fix is a rewrite, `/writing-for-agents` is the authoring discipline and `/skill-creator`
is what wires a changed skill back in.

## Gotchas

- **A short history proves nothing.** Fewer than ~20 sessions, and "never reached" mostly means "not
  yet". Say the sample size in the report; a confident verdict on eight sessions is noise with a
  table around it.
- **A hook that injects prose is invisible to the tool**, which sees a typed `<command-name>` and a
  `Skill` call and nothing else. `/optimize-prompt` is reached by a `UserPromptSubmit` hook emitting
  `additionalContext`, so it reads 0/0 however often it fires. Check every ritual declaring
  `reached-by:` against its actual trigger before calling it unreached.
- **The work has to have occurred.** A ritual scores zero when its job never came up, which looks
  identical to a description that never matched. Separate them from artifacts on disk rather than
  from the transcripts: an ADR written in the window is `/domain-modeling`'s trigger having fired.
- **Skills from other plugins are counted but not shipped here.** The tool lists them separately.
  A ritual you renamed still being typed under its old name shows up there, and looks identical to a
  skill that vanished.
- **Do not audit and rewrite in the same pass.** Measure the whole collection, report, get a decision,
  then change things. A rewrite mid-audit means the rest of the collection is being judged against a
  moving standard.
