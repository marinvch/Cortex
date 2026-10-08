# Skill changes the evals did not support

A baseline records the text that was kept. This file records what was tried against it and dropped,
or kept without a measured gain. Without it the same sentence is proposed again a month later, by a
person or by an optimizer, and measured again.

Add an entry when an eval was run on a change to a ritual's text and the change was not kept, or
was kept although the score did not move. Give the text, the runs, the numbers and what the next
editor should take from them. One run of a small split is not a result: say how many runs each side
got. An entry is never edited to look better later; a later measurement gets its own entry.

| Date | Ritual | Outcome |
|---|---|---|
| 2026-10-08 | `/cortex` | [kept, with no measured gain: the playback says what a row changes](#2026-10-08--cortex--the-playback-says-what-a-row-changes) |
| 2026-10-08 | `/cortex` | [rejected: "its `counts` and `files` are not quoted"](#2026-10-08--cortex--its-counts-and-files-are-not-quoted) |

## 2026-10-08 · cortex · the playback says what a row changes

**The change.** 2.41.22 added to `skills/cortex/SKILL.md` that each row of the one confirmation
states its `effect`, and that a drifted skill is shown with when it was edited.

**The runs.** `node evals/run.mjs cortex --split test`, 14 tasks a run.

| Text | Runs | Failed tasks | Mean hard score |
|---|---|---|---|
| before 2.41.22 | 5 | 4 of 70 | 0.943 |
| 2.41.22 | 6 | 6 of 84 | 0.929 |

**The outcome.** Kept. The eval does not score what the change is for (the playback's wording), and
the two means are within what one failed task moves a run by, 0.07.

**What to take from it.**

- The baseline before it was 1.0 from a single run. Five runs of that same text averaged 0.943. A
  baseline recorded from one run of this split overstates the text by about one task in fourteen.
- The means hid a pattern. "UPDATE should be none" on an older-plugin task failed four times with
  the new text and never with the old one. Reading which tasks fail found a regression that
  comparing two means called noise. 2.41.27 fixed it.

## 2026-10-08 · cortex · its counts and files are not quoted

**The change.** While fixing the older-plugin rule (2.41.27), one more sentence was tried after the
four that were kept:

> What the stamp status adds to the reply is the advice and its two commands. Its `counts` and
> `files` are not quoted, summarised or sorted into rows.

**The runs.** The same command. The split has 3 older-plugin tasks, so 4 runs are 12 of them.

| Text | Runs | Older-plugin tasks that listed the files |
|---|---|---|
| 2.41.22 and 2.41.26 | 9 | 6 of 27 |
| the four kept sentences | 8 | 1 of 24 |
| the four, plus this one | 4 | 3 of 12 |

**The outcome.** Rejected. It is not in the skill.

**What to take from it.**

- The four kept sentences give the reason a preview is wrong. This one only forbade a format, and
  it named the two fields the model was then more likely to talk about. A prohibition that names
  the thing can raise it.
- Twelve tasks is a small sample. The direction was clear enough to drop a sentence that had no
  evidence for it, and is not strong enough to say it does harm.
