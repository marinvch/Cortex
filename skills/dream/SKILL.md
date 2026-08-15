---
name: dream
description: End-of-day consolidation for a codebase. Reads what actually changed, writes a dated digest into the repo's committed .cortex/memory/, so tomorrow's agents and the rest of the team start with today's context instead of re-deriving it. Use at the end of a working session, or when the user says "dream", "wrap up the day", "consolidate", "what did we learn today".
---

# /dream — end the day without losing it

Context dies when a session ends. Dreaming is the ritual that moves the day's understanding out of
a transcript and into a file the whole team — and every future agent — can read.

Memory lives in `.cortex/memory/<date>.md`, **committed**, one file per day, append-only.
Several developers appending to the same day's file merge as ordinary text; nobody edits a shared
document in place, so there is no lost update to reason about.

## 1. Gather what actually happened

Evidence, not recollection:

```bash
git log --since=midnight --pretty='%h %s' --stat
git status --porcelain
```

If the index exists, re-run it and compare — new files, new areas, structure that moved:

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
- What the next session should pick up.

Not worth writing: a restatement of the diff, a task list, anything the code already says.

Append through the memory CLI so the write goes through the gate:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-memory.mjs" append "<the digest text>" --kind dream
```

Read back recent days with `... cortex-memory.mjs recent --days 7`.

## 3. Respect the refusal

The gate **refuses** any entry carrying a credential, key, token or connection string. If it
throws `refused_write`, do not rewrite the note to sneak past it and do not sanitise it silently.
Tell the user what kind of secret was detected and let them decide what to record instead.

The reason is structural: this file is committed. A secret written here is a secret in the
repository's history, and history is forever.

The same applies to personal and employer-sensitive content. Repo memory is about the codebase.

## 4. Close

Say what was written and where. If today produced a decision that is hard to reverse, surprising
without context, or a genuine trade-off, offer to record an ADR under `docs/adr/` as well —
memory is chronological, an ADR is findable.

## Gotchas

- Dreaming is **additive**. Never rewrite or prune a previous day's file; if something recorded
  earlier turned out wrong, append the correction with today's date. The record of having been
  wrong is often the useful part.
- One digest per session, not per commit. A memory file with thirty entries is a log, not a memory.
- If nothing notable happened, write nothing and say so. An honest empty day beats filler that
  future readers must wade through.
