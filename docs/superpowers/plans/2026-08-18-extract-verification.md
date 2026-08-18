# Plan: the extract verification counts the wrong set

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** `cortex-vault-extract.sh --remove-source` refuses unless *this run's* copy is complete.

**Spec:** none — found while extending the shell test coverage from
[2.8.0](2026-08-18-guard-destructive-tools.md).

## The finding

The script is careful by design: dry-run by default, `--apply` to copy, `--remove-source` as a
separate opt-in, and a verification before deleting anything. Its own header says why —
*"the personal layer is gitignored here, so it exists only in your working tree. That means a
careless delete is unrecoverable — hence copy first, verify, and remove as a separate opt-in."*

The verification is:

```bash
copied=$(find "$DEST" -type f ! -path '*/.git/*' | wc -l)
...
if [ "$copied" -lt "$total" ]; then echo "refusing to remove the source"; exit 1; fi
```

`copied` counts **everything already in the destination**, not what this run copied. Verified:

```
$ ... --to <dest with 8 unrelated files> --apply
2 files would move.
copied 10 files into <dest>
```

Two files moved; ten reported. A destination that is not empty inflates the count, so a partial or
failed copy can still clear the `-lt "$total"` check — and `--remove-source` then deletes a
gitignored personal layer that exists nowhere else.

The guard is the single thing standing between a bad copy and permanent data loss, and it is
counting the wrong set. Re-running into an existing destination is not an exotic case: it is what
someone does after the first attempt goes wrong.

## 1. Count what this run copied

**Touches:** `tools/cortex-vault-extract.sh`, `tools/test/cortex-vault-extract.test.sh`

Count per planned path, at the destination, and compare against the same path at the source. Report
that number, and refuse removal if **any** planned path is short.

- [ ] **Step 1:** tests — a pre-populated destination reports the true count; a short copy refuses
  removal and exits non-zero; the source survives that refusal.
- [ ] **Step 2:** run — FAIL (reports the inflated count).
- [ ] **Step 3:** implement. **Step 4:** run — PASS. **Step 5:** commit.

**Verify:** the refusal path leaves the source **intact**. A verification that refuses and deletes
anyway is worse than none.

## 2. Pin the promises it already keeps

**Touches:** `tools/test/cortex-vault-extract.test.sh`

Dry run is the default and writes nothing · `--to` is required · it refuses outside the Cortex repo ·
an empty vault exits 0 saying so · `--apply` copies and leaves the source in place · `--remove-source`
keeps `.gitkeep` and `README.md` placeholders · `--no-git` skips the git init.

- [ ] **Step 1:** tests. **Step 2:** run. **Step 3:** commit.

## 3. Release

Cut **2.8.1** — a fix plus coverage. Six version sites, then tag.

---

## Outcome — done, 2026-08-18

Shipped as **2.8.1**. 107 shell assertions across five files; every destructive shell tool now has
behavioural coverage.

**The bug reproduced exactly as predicted**, and the second failing test was the serious one: with a
copy that did not fully land, the source *was* deleted. Both are now green.

**One test had to be rewritten because the first version proved nothing.** Deleting a file from the
destination and re-running does not simulate a short copy — `--apply` re-copies, so the gap heals
before the verification runs. The honest simulation is a copy that fails, done here by parking a
directory where a file must be written. The assertion is about the *source surviving*, not about a
particular message, because either outcome is correct: the script may refuse at the verification or
abort at the failing `cp`. What must never happen is reaching the delete.

**A coverage gap, stated rather than implied.** The per-path `short` refusal is not reached by the
suite: a failing `cp` aborts under `set -e` first, and a `cp` that returns 0 while silently dropping
files cannot be provoked portably. What is tested is the count it depends on — which was the actual
bug. The refusal is kept as belt-and-braces for the error message it gives.

**Still open:** `cortex.sh` (the viewer generator) has no behavioural tests, and the ritual runner
remains a product decision rather than a task — the rituals are Claude Code skills written for an
interactive agent, and the two that motivated a runner (`/level-up`, `/cortex-audit`) are an
interview and a subagent dispatch respectively.
