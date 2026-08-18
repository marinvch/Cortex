# Plan: the bash half gets the guard the Node half already has

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** `cortex-rm.sh` stops moving files it was never pointed at, and the destructive shell tools
get behavioural tests.

**Spec:** none — follow-on work from the
[shell-half tests plan](2026-08-18-shell-half-tests.md), using the harness it built.

## The finding

ADR 0007 made `mcp/lib/vault.js` the only door onto a vault root, because a caller-supplied path
that escapes the root can read or write anything on disk. **The bash half never got that guard.**

Verified, not theorised:

```
$ cd vault && bash tools/cortex-rm.sh ../outside/secret.md
✓ archived → archives/removed/secret.20260818-134621.md
```

A file outside the vault was moved into `archives/removed/`. `cortex-rm.sh` does
`ROOT="$(pwd)"` and then `[ -f "$ROOT/$F" ]`, which happily accepts `../`.

This is not remote-exploitable — it is a local CLI run with a path someone typed. It matters anyway
for two reasons. An **agent** may invoke it with a constructed path, which is exactly the case ADR
0007 exists for. And the repo states this invariant for itself: the Node side got a module, a test
and an ADR, while the shell side kept a bare `$(pwd)`.

Checked and **not** affected: `cortex-vault-extract.sh` resolves its root from the script's own
location, and `cortex-scan-projects.sh` only removes inside `$VAULT/projects/` under a slugified
name, which cannot express a traversal segment.

## Why not "just don't do that"

Because the promise on the tin is recovery. `cortex-rm.sh` says *archive, don't delete* and prints
"Recover from `archives/removed/`". A file dragged in from outside the vault is not recoverable to
where it came from — the original path is gone from the record. The tool's safety story only holds
inside the root it assumes.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `tools/_cortex-lib.sh` | add `resolve_in_root` — the shell counterpart of `core/paths.js` | modify |
| `tools/cortex-rm.sh` | refuse a target outside the vault | modify |
| `tools/test/cortex-rm.test.sh` | the refusal, and the archive/de-link promises | **create** |
| `tools/test/cortex-sync-skills.test.sh` | `--check` drift reporting | **create** |
| `docs/adr/0010-the-shell-half-gets-the-guard-too.md` | the decision | **create** |

`resolve_in_root` goes in `_cortex-lib.sh` rather than in `cortex-rm.sh`, because the next
destructive tool should inherit it instead of re-deriving it — the "five modules had to remember"
failure ADR 0007 was written about.

---

## 1. `resolve_in_root` in the shared lib

**Touches:** `tools/_cortex-lib.sh`, `tools/test/cortex-rm.test.sh`

```bash
resolve_in_root <root> <relpath>   # echoes the absolute path, or exits non-zero
```

Resolve both sides to physical paths and require the result to sit under the root. No `realpath`
dependency — it is absent on macOS by default; use `cd`+`pwd -P` on the parent directory, which is
POSIX and handles a target that does not exist yet.

Refuse: `../escape.md`, an absolute path outside the root, and a symlink pointing out. Accept a
legitimate nested path.

- [ ] **Step 1:** write the tests. **Step 2:** run — FAIL, function missing.
- [ ] **Step 3:** implement. **Step 4:** run — PASS. **Step 5:** commit.

**Verify:** the symlink case. It is the one a naive string-prefix check gets wrong, and it is why
`core/paths.js` realpaths the nearest existing ancestor rather than comparing strings.

## 2. `cortex-rm.sh` refuses what it cannot recover

**Touches:** `tools/cortex-rm.sh`, `tools/test/cortex-rm.test.sh`

Route the target through `resolve_in_root` before the `mv`. Refuse with a message naming the root,
and exit non-zero.

Also pin what it already promises, none of which is currently covered:

- the note is **moved**, not deleted — present under `archives/removed/` with a timestamp
- inbound `[[wikilinks]]` are de-linked: `[[slug|alias]]` → `alias`, bare `[[slug]]` → `slug`
- files under `archives/` and `.git/` are **not** rewritten
- an unrelated `[[other-note]]` link is left byte-identical — the `sed` is aimed at one slug and a
  greedy pattern would quietly damage every note in the vault

- [ ] **Step 1:** tests. **Step 2:** run — the refusal fails, the rest pass. **Step 3:** implement
  the guard. **Step 4:** run — all pass. **Step 5:** commit.

**Verify:** the "unrelated link survives" case runs against a note containing **both** the target
link and an unrelated one, in the same file. Two links in two files would not catch a greedy regex.

## 3. `cortex-sync-skills.sh --check`

**Touches:** `tools/test/cortex-sync-skills.test.sh`

`AGENTS.md` calls this out as load-bearing: the mirror is gitignored, `--check` reports drift, and a
plain `cp -r` never removes anything. It once reported a mirror-only skill as "left untouched" — the
script correctly refusing to guess — and that skill was one `rm -rf` from gone.

Cover: a missing skill is reported, a stale one is reported, a **mirror-only** one is reported and
**not deleted**, and `--check` exits non-zero on drift so CI could use it.

- [ ] **Step 1:** tests. **Step 2:** run. **Step 3:** commit.

**Verify:** `--check` must not modify the mirror. Assert the mirror is byte-identical afterwards.

## 4. Record and release

**Touches:** `docs/adr/0010-*.md`, `AGENTS.md`, plus the six version sites.

ADR 0010: the guard belongs in the shared lib, not in each tool; why a string-prefix check is not
enough; why `realpath` is not used. Rejected: guarding only `cortex-rm.sh`, and treating the
traversal as acceptable because the tool is local.

Cut **2.8.0**.

---

## Out of scope

- `cortex.sh` (the viewer generator) and `cortex-init.sh` — the latter already has an end-to-end CI
  run, and the former writes one generated file.
- Retrofitting `resolve_in_root` into scripts that do not need it. Two were checked and are safe;
  adding a guard where there is no door is noise.

---

## Outcome — all tasks done, 2026-08-18

Shipped as **2.8.0**. 86 shell assertions across four files.

**The finding held up under a real fixture.** `cortex-rm.sh ../outside/secret.md` archived a file
from outside the vault; it now refuses and names the root. `resolve_in_root` lives in
`_cortex-lib.sh` so the next destructive tool inherits it.

**A capability had to be probed by its result for the second time this session.** The symlink case
guards on `test -L`, not on `ln -s`'s exit status — Git Bash without `winsymlinks` reports success
and silently makes a copy, so the "link" is a real directory inside the root and accepting it is
correct. The `0600` env-file check had the identical shape a release earlier. Two instances is a
pattern: **in shell tests, probe the result, never the command's exit code.** ADR 0010 records it.

**Why the pass stopped where it did.** The originally-suggested next item was "declare a minimum
model capability for rituals". Checking first showed **nothing runs rituals headlessly** —
`cortex-cron.sh` does git plus one raw API call, and `cortex-init.sh` writes skill files without ever
executing them. A capability declaration with no consumer is decoration, which this repo avoids on
principle (the `offer` field exists only because the wizard reads it). That item stays blocked on a
ritual runner, and is named rather than half-built.
