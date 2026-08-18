# 0009. Provisioning prints before it installs, and the key never enters the crontab

**Date:** 2026-08-18
**Status:** accepted

## Context

`server-setup.sh` provisioned the git half of server mode — a bare repo on the server, a clone on
each machine — and stopped. The scheduler half was a section of `references/living-cortex.md` that a
human copied by hand: clone a working brain, find the cron script, write two crontab lines.

Automating it raised two questions that had to be answered before writing any of it.

**How much may a setup script change?** A crontab is not a project file. It is user-global, shared
by every scheduled job on the machine, easy to clobber and annoying to reconstruct — much closer to a
system setting. People also run setup scripts speculatively, to see what they would do.

**Where does the API key live?** The documented crontab line was:

```
0 6 * * *  BRAIN_DIR=$HOME/cortex-work ANTHROPIC_API_KEY=sk-... bash .../cortex-cron.sh --daily
```

That is a live credential in the crontab. `crontab -l` prints it — the one command anyone runs to
check whether their schedule is set up — and it is carried into any backup of `/var/spool/cron`. It
also contradicts the rest of this repo: `core/scrub.js` refuses a memory write carrying a credential,
and `/wizard` output is never committed with values baked in. **The documentation was asking for
exactly what the code refuses.**

## Decision

**`bash server-setup.sh cron <clone-url> [work-dir]` prints; `--install` writes.**

The default clones the working brain, creates the env file, and prints the two crontab lines it
recommends. It changes nothing else. `--install` writes them into the crontab inside a marked block
(`# cortex-cron (managed)`), replacing any previous managed block and leaving every other line
untouched.

This is the consent structure Cortex already uses, applied to a new surface: `/cortex-install` reads
and reports, and applying is a separate step the user asks for (ADR 0005, ADR 0006).

**The key lives in `${XDG_CONFIG_HOME:-$HOME/.config}/cortex/cron.env`, mode `0600`**, and the
crontab lines *source* it. Created with `umask 077` rather than a `chmod` afterwards, so the file is
never briefly world-readable between creation and permission fix. **Never overwritten** if it already
exists — it holds a key someone pasted, and clobbering it is unrecoverable from this script's view.

The key stays optional. Without one, `cortex-cron.sh` writes a deterministic git-based digest, which
is the boring path and always works.

**The cron script path is resolved from `server-setup.sh`'s own location.** The docs hardcoded
`$HOME/ai-os`, which is wrong for anyone who cloned anywhere else. A provisioning step that prints a
path which does not exist is worse than one that prints nothing, because it looks finished.

## Alternatives rejected

**Install by default, with `--dry-run` to preview.** The common default should be the safe one.
Inverting it means the destructive path is what you get by typing the obvious command, and the
recovery — reconstructing a clobbered crontab — is genuinely painful.

**Prompt for the API key.** Convenient, and rejected: a script that reads a secret from a terminal
puts it in shell history the moment someone pastes it into the wrong prompt, and it cannot be run
unattended, which is the entire point of server mode.

**Keep the key in the crontab and just document the risk.** Rejected — the leak is not exotic, it is
printed by the most common diagnostic command there is.

**Systemd timers instead of, or alongside, cron.** A second scheduler doubles the surface for an
audience that has not asked for it. The docs already assume cron.

**Append to the crontab without a marker.** Simpler, and it duplicates the entries on every re-run
until someone notices two digests a day. The marked block makes `--install` idempotent.

## Consequences

Server mode is now provisioned by one command per half rather than one command and a documentation
section. `references/living-cortex.md` lost its hand-copied steps and its `sk-...` example, and gained
an explicit note about why the env file exists — so the next person does not "simplify" it back into
the crontab line.

The tests use a **fake `crontab` on `PATH`** that records its stdin. The real binary is absent on CI
and is the developer's own on a workstation; invoking it for real in a test is unacceptable either
way.

The `0600` assertion **probes whether the filesystem honours mode bits** rather than guessing from
the platform. Git Bash on NTFS reports a working `stat` while silently ignoring both `chmod` and
`umask`, so testing for `stat` alone would assert something the filesystem cannot represent and fail
for a reason unrelated to the script. On Linux and in CI the probe passes and the assertion runs for
real.

Still open, and named rather than absorbed: running the **rituals** themselves on a schedule
(`/level-up`, `/cortex-audit`). Those assume a strong model, and scheduling them before the declared
minimum-capability work exists would ship a cron job that fails on a weak self-hosted model.
