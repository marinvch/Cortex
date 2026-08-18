# Plan: `server-setup.sh` provisions the cron half

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** `server-setup.sh` finishes the job it was written for. Today it provisions the git half and
stops; the scheduler half is a `references/living-cortex.md` section a human copies by hand.

**Architecture:** a third mode, `bash server-setup.sh cron`, that clones the working brain and
**prints** the crontab lines it recommends. Installing them is a separate, explicit
`--install` flag. Credentials go in a `0600` env file the crontab *sources* — never inline in the
crontab itself.

**Tech Stack:** bash, git, `crontab`. Tested with the harness from 2.6.1.

**Spec:** none — follow-on work named in
[ADR 0008](../../adr/0008-three-audiences-one-seam.md), the
[three-mode resolver plan](2026-08-18-three-mode-resolver.md) and the
[shell-half tests plan](2026-08-18-shell-half-tests.md).

## The security problem this fixes on the way

`references/living-cortex.md` currently tells operators to write this:

```
0 6 * * *  BRAIN_DIR=$HOME/cortex-work ANTHROPIC_API_KEY=sk-... bash .../cortex-cron.sh --daily
```

**That puts a live API key in the crontab.** `crontab -l` prints it, it lands in any backup or dotfile
sync of `/var/spool/cron`, and it is shoulder-surfable the moment anyone runs the one command people
run to check whether cron is set up. It is also the exact shape this repo refuses elsewhere —
`core/scrub.js` blocks a memory write carrying a credential, and `/wizard` output is never committed
with values baked in. The docs should not ask for what the code refuses.

So provisioning writes `~/.config/cortex/cron.env` with mode `0600` and emits crontab lines that
source it. The key stops being visible to `crontab -l`, and rotating it is one edit in one place
rather than two crontab lines.

## The rule for this mode

**Printing is the default; installing requires `--install`.** A crontab is shared, user-global,
easy to clobber and annoying to reconstruct — closer to a system setting than a project file. A
setup script that rewrites it because someone ran it to see what it would do has broken something it
was never asked to touch.

This mirrors the consent structure Cortex already uses: `/cortex-install` reads and reports, and a
separate step applies (ADR 0005/0006). Same instinct, different surface.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `tools/server/server-setup.sh` | add the `cron` mode: clone the working brain, print or install | modify |
| `tools/test/server-setup.test.sh` | the new mode's cases | modify |
| `references/living-cortex.md` | replace the hand-copied section; stop printing a key into crontab | modify |
| `docs/adr/0009-provisioning-prints-before-it-installs.md` | the decision | **create** |

---

## 1. `cron` mode clones the working brain and prints

**Touches:** `tools/server/server-setup.sh`, `tools/test/server-setup.test.sh`

```
bash server-setup.sh cron <clone-url> [work-dir]      # prints; changes nothing but the clone
bash server-setup.sh cron <clone-url> [work-dir] --install
```

- Clone `<clone-url>` to `[work-dir]` (default `$HOME/cortex-work`) if absent; idempotent.
- Resolve the absolute path of `cortex-cron.sh` **from this script's own location**, not from a
  guessed `$HOME/ai-os` — the docs hardcode a path that is wrong for anyone who cloned elsewhere.
- Print the two crontab lines (daily 06:00, weekly Monday 06:10), each sourcing the env file.
- Print the env-file path and what to put in it. Do **not** prompt for the key: a setup script that
  reads a secret from a terminal has it in shell history the moment someone pastes it wrong.

- [ ] **Step 1:** write the tests first — clone happens, idempotent, output contains both schedules,
  output contains the resolved script path, and **`crontab` is not modified** without `--install`.
- [ ] **Step 2:** run. Expected: FAIL (mode falls through to usage).
- [ ] **Step 3:** implement. **Step 4:** run. Expected: PASS. **Step 5:** commit.

**Verify:** the printed path is the real one on disk. A provisioning step that prints a path that
does not exist is worse than one that prints nothing — it looks finished.

## 2. The env file, `0600`

**Touches:** `tools/server/server-setup.sh`, `tools/test/server-setup.test.sh`

Create `${XDG_CONFIG_HOME:-$HOME/.config}/cortex/cron.env` if absent, with `0600` and a commented
template. **Never overwrite an existing one** — it holds a key someone pasted, and clobbering it is
unrecoverable from this script's point of view.

- [ ] **Step 1:** tests — file is created with mode `0600`, contains no real key, an existing file is
  left byte-identical, and the parent directory is created.
- [ ] **Step 2:** implement. **Step 3:** run. **Step 4:** commit.

**Verify:** `stat -c %a` is `600`. If the test cannot check the mode on the host (Windows), skip that
one assertion explicitly and say so, rather than asserting something weaker and calling it passing.

## 3. `--install`, idempotently

**Touches:** `tools/server/server-setup.sh`, `tools/test/server-setup.test.sh`

Append the lines via `crontab -l | ... | crontab -`, guarded by a marker comment
(`# cortex-cron (managed)`), so a second `--install` replaces the managed block rather than appending
a duplicate. Never touch lines outside the marker — the operator's other cron jobs are not ours.

- [ ] **Step 1:** tests using a **fake `crontab` on `PATH`** that records its stdin to a file. Real
  `crontab` is absent on CI and would be the developer's own on a workstation; either way, invoking
  it for real in a test is unacceptable.
- [ ] **Step 2:** assert a first install writes the block, a second leaves exactly one copy, and an
  unrelated pre-existing line survives untouched.
- [ ] **Step 3:** implement. **Step 4:** run. **Step 5:** commit.

**Verify:** the fake `crontab` is the only one invoked — the test must fail loudly if the real binary
is reachable, not silently pass by editing a real crontab.

## 4. Fix the documentation that teaches the leak

**Touches:** `references/living-cortex.md`

Replace the hand-copied clone/install/schedule section with the one command, and remove the
`ANTHROPIC_API_KEY=sk-...` crontab example entirely. Say plainly why the env file exists, so the next
person does not "simplify" it back into the crontab line.

- [ ] **Step 1:** rewrite the section. **Step 2:** confirm no `sk-` example remains anywhere in the
  repo. **Step 3:** commit.

## 5. Record it, and release

**Touches:** `docs/adr/0009-*.md`, `CHANGELOG.md`, `VERSION`, manifests, `mcp/package.json`,
`README.md`, changelog link — **six** version sites.

ADR 0009: print-before-install for anything user-global; the key belongs in a `0600` file, not the
crontab. Rejected: prompting for the key, installing by default, and a hardcoded `$HOME/ai-os` path.

Cut **2.7.0** — new capability. Tag and release so the changelog link is not dead.

---

## Out of scope

- Systemd timers as an alternative to cron. A second scheduler doubles the surface for an audience
  that has not asked; cron is what the docs already assume.
- Anything Windows-side. Server mode is a POSIX host by definition here.
- Running the rituals themselves (`/level-up`, `/cortex-audit`) on a schedule. That needs the declared
  minimum-model-capability work, still open, and guessing it here would ship a cron job that fails on
  a weak self-hosted model.

---

## Outcome — all tasks done, 2026-08-18

Shipped as **2.7.0**. 23 new shell assertions (60 total). `server-setup.sh` now provisions both
halves of server mode.

**The security fix was the larger half of the work.** The plan set out to automate a documented
procedure and found the procedure itself was wrong: it published a crontab line carrying a live API
key, which `crontab -l` prints. Automating it faithfully would have industrialised the leak. Fixed in
three places — the provisioning script, `references/living-cortex.md`, and `cortex-cron.sh`'s own
usage comment, which was teaching the same pattern from a second direction.

**One thing the end-to-end run caught that no test would have.** The script printed
`created env file: … (0600)` unconditionally. On a filesystem that ignores mode bits — Git Bash on
NTFS, some network mounts — that is a security claim the script cannot back up, printed to reassure
someone about a file holding their API key. It now reads the mode back and warns when it cannot
confirm it. The tests all passed while it was wrong, because they were asserting the *file's* mode
via a capability probe, not the *message's* truthfulness.

**Deliberately not absorbed:** running the rituals themselves on a schedule (`/level-up`,
`/cortex-audit`). They assume a strong model, and scheduling them before the declared
minimum-capability work exists would ship a cron job that fails on a weak self-hosted model.
