---
name: dream
description: End-of-day consolidation — a dated digest of what changed and what was learned, written into the repo's committed .cortex/memory/. Triggers — "dream", "wrap up the day", "what did we learn today".
metadata:
  capability: judgment
---

# /dream — end the day without losing it

Context dies when a session ends. Dreaming is the ritual that moves the day's understanding out of
a transcript and into a file the whole team — and every future agent — can read.

Memory lives in `.cortex/memory/<date>/<author>.md`: **committed**, append-only, one file per
author per day. Several developers who dream on the same day each write their own file, so their
branches merge with no conflict. A repo may also hold older `<date>.md` day files. They are read
like the rest and never moved or rewritten.

## 1. Gather what actually happened

Evidence, not recollection:

```bash
git log --since=midnight --pretty='%h %s' --stat
git status --porcelain
```

If the index exists, re-run it and compare — new files, new areas, structure that moved. The guard
is deliberate: `/dream` never creates `.cortex/`, so it can never be the first write
[ADR 0005](../../docs/adr/0005-the-install-sequence-may-start-itself.md) gates. On a repo with no
index, skip straight to the digest.

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

## 2. Write the digest

Keep it short and durable. Ask of every line: *will this still be useful in a month?* Commit
messages already record what changed — memory records **why**, and what it cost.

Worth writing:
- Decisions taken and the option rejected. This is the highest-value line in the file.
- Something learned the hard way — a gotcha, a surprising coupling, a dead end not worth
  re-exploring.
- Drift: where the code and the context files disagree now.
- What the next session should pick up — written as the state it walks into, not as a command to
  run. This file is read back months later by `/catch-me-up` and by `recall`; a pasted command with
  its arguments is the one line that ages into an instruction.

Not worth writing: a restatement of the diff, a task list, anything the code already says.

Append through the memory CLI so the write goes through the gate:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-memory.mjs" append "<the digest text>" --kind dream
```

Read back recent days with `... cortex-memory.mjs recent --days 7`.

The command finds the author itself: `CORTEX_AUTHOR` when it is set, otherwise git `user.name` in
this repo. Only a slug of it is written (`a-z`, `0-9`, `-`, at most 40 characters), in the path
and the file's heading. No email address is read.

- **To choose the name that is published, set `CORTEX_AUTHOR`** to a short handle, for example
  `dev-a`. Memory is committed, so the name is in every checkout.
- **A line on stderr that starts `memory: this entry went to the shared day file`** means there
  was no usable name: git has no `user.name` here, or the name has no ASCII letter or digit. The
  entry is written, to `<date>.md`, and the exit is 0. That file is shared by everyone in the same
  position, and two branches that each write it on one day conflict when they merge. Pass the line
  on to the user with its fix, which is to set `CORTEX_AUTHOR`.
- **Exit 1 naming `CORTEX_AUTHOR`** means it is set and gives no slug. Nothing was written. Tell
  the user to set it to a handle like `dev-a`, then append again.

## 3. Respect the refusal

The gate **refuses** any entry carrying a credential, key, token or connection string. If it
throws `refused_write`, do not rewrite the note to sneak past it and do not sanitise it silently.
Tell the user what kind of secret was detected and let them decide what to record instead.

The reason is structural: this file is committed. A secret written here is a secret in the
repository's history, and history is forever.

The same applies to personal and employer-sensitive content. Repo memory is about the codebase.

## 4. Close

Say what was written and where. If today produced a decision that is hard to reverse, surprising
without context, or a genuine trade-off, offer to record an ADR in the repo's ADR directory (`docs/adr/`, or `adr/`) as well —
memory is chronological, an ADR is findable.

## Gotchas

- Dreaming is **additive**. Never rewrite or prune a previous day's file; if something recorded
  earlier turned out wrong, append the correction with today's date. The record of having been
  wrong is often the useful part.
- One digest per session, not per commit. A memory file with thirty entries is a log, not a memory.
- If nothing notable happened, write nothing and say so. An honest empty day beats filler that
  future readers must wade through.
- **No banner here.** `/handoff` opens its file with a *record, not instructions* line; this file is
  append-only, so the same banner would repeat once per entry, and `core/memory.js` owns the one
  header it does get. The fence lives in the writing instead — past tense for what
  happened, the state rather than the command for what is next.

## Not the same as /handoff

If the day is ending mid-task, you likely need both. `/handoff` writes in-flight state to the OS temp
dir for the next agent — the branch, the half-applied change, what you were about to try — and it is
deliberately ephemeral. This writes what a future reader of the codebase needs, months from now, and
it is committed. Running `/handoff` alone on a day that taught you something parks the work and loses
the lesson; the temp file is gone by the time anyone would have wanted it. `/catch-me-up` is what
reads this back.
