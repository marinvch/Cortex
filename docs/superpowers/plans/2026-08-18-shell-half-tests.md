# Plan: test the shell half

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** give `tools/` behavioural tests, so a bug in the shell half is caught by CI instead of by
someone reading the file two months later.

**Architecture:** a dependency-free bash harness — `tools/test/run.sh` discovers and runs
`tools/test/*.test.sh`. No bats, no shellspec (ADR 0004: no runtime dependencies). Tests build real
git repositories in temp directories, so the server scripts are exercised for real without network.

**Tech Stack:** bash, git, `mktemp`. Node is not involved.

**Spec:** none — this is follow-on work named in
[ADR 0008](../../adr/0008-three-audiences-one-seam.md) and the
[three-mode resolver plan](2026-08-18-three-mode-resolver.md).

## Why this, and what it would actually have caught

CI today is not nothing: it `bash -n`s and shellchecks **every** script, runs `cortex-init.sh`
against a dummy repo end to end, and diffs `knowledge_files()` against `mcp/lib/recall.js` to keep the
two implementations of `.cortexignore` honest. That is real coverage.

What it has none of is **behaviour** for `tools/server/`. Those two scripts are parsed and linted and
never run. Both bugs found on 2026-08-18 lived exactly there.

Being honest about what a test could have caught, because that decides what to build:

| Bug | Would a test have caught it? |
|---|---|
| `BRAIN_DIR` vs `AI_OS_ROOT` | **Yes.** Pure env-precedence logic. |
| `CORTEX_MODEL` pointing at a dead model id | **No.** Verifying a model id exists needs the network. |
| The AI summary failing **silently** | **Yes — and this is the one that matters.** |

That third row reframes the second. The reason a stale model id survived is not that the id was
wrong, it is that **nothing reports the AI half being broken**. `curl … || true` and a `jq … || true`
mean a bad key, a dead model or an unreachable network all produce a digest with no summary, exit 0,
and no warning. The deterministic fallback is the design working as intended — *silence* is the
defect. A cron that appears to work while half of it is dead is worse than one that fails.

So this pass builds the harness, tests what is testable, and fixes the silence.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `tools/test/run.sh` | discover + run `*.test.sh`, report pass/fail, exit non-zero on failure | **create** |
| `tools/test/_helpers.sh` | `assert_eq`, `assert_contains`, `assert_exit`, `mkrepo` | **create** |
| `tools/test/cortex-cron.test.sh` | the daily/weekly/no-change/env-fallback/silent-failure cases | **create** |
| `tools/test/server-setup.test.sh` | bare-repo creation and client clone | **create** |
| `tools/server/cortex-cron.sh` | warn when the AI summary was attempted and failed | modify |
| `.github/workflows/cortex-init-test.yml` | run the harness | modify |
| `mcp/AGENTS.md` | where shell tests live | modify |

---

## 1. The harness

**Touches:** `tools/test/run.sh`, `tools/test/_helpers.sh`

A test file is a bash script that sources `_helpers.sh` and calls `assert_*`. `run.sh` runs each in a
**subshell with its own temp dir**, so one test cannot leak state into the next, and prints
`ok`/`FAIL` per case with a final count.

Helpers, deliberately four and no more — a test framework that grows features is a dependency by
another name:

```bash
assert_eq "$expected" "$actual" "message"
assert_contains "$haystack" "$needle" "message"
assert_exit <expected-code> "message" -- command...   # runs the command, compares its status
mkrepo <dir>                                          # git init + identity + one commit
```

`mkrepo` sets `user.email`/`user.name` locally, because CI runners have no git identity and a commit
would fail for a reason that has nothing to do with the test.

- [ ] **Step 1:** write `_helpers.sh` and `run.sh`.
- [ ] **Step 2:** write one throwaway passing test and one deliberately failing one; confirm `run.sh`
  exits **non-zero** and names the failure. A harness that cannot fail is decoration.
- [ ] **Step 3:** delete the throwaways; commit.

**Verify:** `bash tools/test/run.sh` exits 0 with no test files present, and non-zero with a failing one.

## 2. `cortex-cron.sh` behaviour

**Touches:** `tools/test/cortex-cron.test.sh`

Runs the real script against a real local bare remote — no network. Cases:

- `--daily` with commits since writes `digests/<today>.md`, commits it, and pushes to the bare remote.
- `--weekly` writes `audits/<today>.md` with `type: audit` in the frontmatter.
- Nothing changed → prints `no changes to commit` and exits **0**. A cron that exits non-zero on a
  quiet day trains its operator to ignore it.
- `AI_OS_ROOT` is used when `BRAIN_DIR` is unset; `BRAIN_DIR` wins when both are set; neither set
  exits non-zero with a message naming both. This is the regression test for the bug just fixed.
- The report always contains the deterministic `## Files changed` section, with or without a key.

- [ ] **Step 1:** write the tests. **Step 2:** run; all pass against the current script. **Step 3:** commit.

**Verify:** `bash tools/test/run.sh` — and confirm no test reaches the network (no `ANTHROPIC_API_KEY`
is set by any case except task 3's, which points at an unreachable host).

## 3. Fix the silence

**Touches:** `tools/server/cortex-cron.sh`, `tools/test/cortex-cron.test.sh`

When `ANTHROPIC_API_KEY` is set and material exists but no summary comes back, say so on **stderr**
and carry on writing the deterministic digest. The fallback stays exactly as designed; what changes
is that a broken AI half stops being invisible.

Also emit a line when `jq` is absent, since the summary is then unparseable even on a successful
call — the script builds a request it cannot read the answer to.

- [ ] **Step 1:** write the failing test — key set, `ANTHROPIC_BASE_URL`-style override pointing at an
  unreachable local port, assert the digest is still written **and** stderr warns. (Requires making
  the endpoint overridable; add `CORTEX_API_URL`, defaulting to the real one. A hardcoded URL is
  untestable by construction.)
- [ ] **Step 2:** run. Expected: FAIL — no warning today.
- [ ] **Step 3:** implement the warning and `CORTEX_API_URL`.
- [ ] **Step 4:** run. Expected: PASS, and the digest content is unchanged from task 2's assertions.
- [ ] **Step 5:** commit.

**Verify:** the exit code stays **0**. A failed optional summary must never fail the cron run — that
would trade a silent bug for a loud regression.

## 4. `server-setup.sh` behaviour

**Touches:** `tools/test/server-setup.test.sh`

- `server` mode creates `~/git/<name>.git` as a bare repo and is idempotent (second run says
  "already exists", exits 0). Override `HOME` to the temp dir so the test never touches the real one.
- `client` mode refuses to run outside a vault root (no `mcp/server.js`) with a non-zero exit.
- `client` mode clones a local bare repo into `team/<slug>` and is idempotent.

- [ ] **Step 1:** write the tests. **Step 2:** run. **Step 3:** commit.

**Verify:** `HOME` is overridden in every case. A test that writes to the developer's real `~/git`
is a bug in the test, and this one would be silent.

## 5. Wire it into CI

**Touches:** `.github/workflows/cortex-init-test.yml`, `mcp/AGENTS.md`

Add a step running `bash tools/test/run.sh` to the existing smoke job — it already has bash, git and
shellcheck, and adding a job would double the checkout for no gain.

- [ ] **Step 1:** add the step after the shellcheck steps.
- [ ] **Step 2:** note in `mcp/AGENTS.md` that shell tests live in `tools/test/` and run in the
  `cortex-init test` workflow, so the next person does not conclude the shell half is untested.
- [ ] **Step 3:** commit.

## 6. Release

Cut **2.6.1** — a fix plus test coverage, no new capability. Six version sites, then tag and release.

---

## Out of scope

- `server-setup.sh` provisioning the cron half. Still named, still not done here; this pass makes it
  *testable*, which is the honest prerequisite.
- Behavioural tests for the other five `tools/*.sh`. `cortex-init.sh` already has an end-to-end CI
  run; the rest can follow the harness once it exists. Building the harness is the unlock.
- Verifying the model id is current. Needs the network; the warning in task 3 is the answer instead.

---

## Outcome — all tasks done, 2026-08-18

Shipped as **2.6.1**. 43 shell assertions across two files, running in CI.

**The plan predicted one bug and the tests found four.** It set out to cover `BRAIN_DIR`/`AI_OS_ROOT`
precedence and fix the silent AI failure. Writing the tests surfaced two more, both in
`server-setup.sh` and both invisible to `bash -n` and shellcheck:

- `$USER` is not guaranteed to be exported — absent under cron, in containers, in Git Bash. `set -u`
  killed the script one line before the clone URL, after it had already created the repo.
- `client` mode printed `ready` while producing a clone with no upstream, because its commit and push
  are both `|| true` and a machine with no git identity fails both. The MCP could never push to it.

That second one is the same disease as the cron silence: `|| true` swallowing a failure and reporting
success. Three of the four bugs in this pass are that one pattern.

**Two bugs were in the harness itself**, found because the fixture failed for its own reasons (it
pushed to a hardcoded `main` while the local branch was `master`):

- A test file that died mid-way reported `0 passed, 0 failed` and exited **0** — a crashed suite
  indistinguishable from a passing one. The worst failure mode a runner can have, and it shipped with
  it.
- `assert_exit` ended with a bare `set -e`, enabling a mode the runner had deliberately disabled, so
  the first non-zero command after any assertion killed the file.

Neither would have been caught by the tests they were meant to run. A harness has to be shown it can
fail before anything it reports means anything.

**Also corrected here:** the 2.6.0 changelog entry and PR #333's description both said the dead model
id meant "every scheduled run would fail". Reading the script in full showed the call is
`curl … || true` — it never aborted, it failed silently. The corrected version is the sharper finding
anyway.

**Still not done:** `server-setup.sh` provisioning the cron half. This pass makes it testable, which
was the honest prerequisite. The other five `tools/*.sh` have no behavioural tests either; the
harness now exists for them.
