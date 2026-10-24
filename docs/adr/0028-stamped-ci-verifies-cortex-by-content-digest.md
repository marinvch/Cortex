# 0028. Stamped CI verifies Cortex by a digest of its code, taken at stamp time

**Date:** 2026-10-24
**Status:** accepted

## Context

`cortex-review.yml`, which `/cortex` stamps into a team's repository, clones Cortex inside that
team's CI — `git clone --depth 1 --branch "$CORTEX_REF"` — and runs `index/cortex-index.mjs` and
`index/cortex-review.mjs` over their code. The workflow holds only `contents: read` and no secret,
but the code it runs reads the whole private repository and the runner has network access. A
release **tag is a name**: anyone who can push to the source — upstream's maintainer account, or an
organisation's fork — can move `v2.44.1` to other code after the team reviewed and merged the
workflow. Every PR would then run that code.

The usual fix is to pin a commit SHA. It is not available at the moment it is needed:

- **Stamping happens offline, from the installed plugin.** Claude Code installs a plugin as a copy
  under `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` with no `.git`. Checked on a
  real install of 2.44.1: no repository, so no `git rev-parse`.
- **The release commit cannot name itself.** `release.yml` tags the merge commit after it lands
  ([ADR 0022](0022-stamping-a-version-on-master-releases-it.md)); no file in that commit can hold
  that commit's SHA.
- Asking the network at stamp time (`git ls-remote`) breaks the stamp act's rule — deterministic,
  no network — and would only record whatever the tag points at *then*, from a host the plugin does
  not otherwise contact.

`agent-evals.yml` had the same shape one step earlier: `curl -fsSL https://claude.ai/install.sh |
bash`, a script fetched fresh on every run in a job that holds `ANTHROPIC_API_KEY`.

## Decision

**`cortex-review.yml` carries `{{CORTEX_SHA256}}`, a sha256 over the Cortex code the workflow runs,
and a step right after the clone recomputes it and fails the job on a mismatch before any of the
clone's code runs.**

- **What is hashed** (`index/lib/cortex-digest.mjs`): every file under `core/` and `index/` except
  `test/` directories, plus `VERSION` — what the two commands load. Each file's CRLF is folded to LF,
  each file hashes to one line `<sha256>  <path>`, the lines are sorted by path and hashed again. No
  git, no network, no clock. On a real install the cache copy of 2.44.1 and `git archive v2.44.1`
  give the same digest.
- **The check does not run code from the clone.** It is a short `node -e` script inside the
  workflow itself. `index/test/cortex-digest.test.mjs` extracts that script from the template and
  runs it against the module, so the two copies cannot drift.
- **A mismatch fails the job whatever `CORTEX_REVIEW_BLOCKING` says.** Blocking is about review
  findings; this is the code that would run against the repository not being the code that was
  stamped.
- **The stamp act fills it** (`withPin` in `index/lib/stamps.mjs`), beside `{{CORTEX_REPO}}`
  (#622), never the `/cortex` skill body. It can only hash the Cortex running here, so it fills
  `{{CORTEX_REF}}` as `v<this plugin's VERSION>` with it, and refuses (`ref_not_running`) a ref
  given for another release.
- **A workflow stamped before this is offered as an update.** Its record has no `CORTEX_SHA256`, so
  `planUpdates` fills the pair from the running plugin and the file reads `update` as any template
  change does; the per-file diff shows the new ref and digest. That moves its ref to the running
  release — the one whose template the update renders. Once recorded, the pair is kept as written.
- **`agent-evals.yml` installs Claude Code from npm at a pinned version**
  (`@anthropic-ai/claude-code@<x.y.z>`, the stable channel's when written), with the auto-updater
  off. Anthropic documents npm as an install method that installs the same native binary. An npm
  version cannot be republished, and npm checks the tarball against the registry's integrity hash.
  The version is a literal in the template: raising it is a template change, which reaches stamped
  repos through the same update path.
- **Docs never pipe `master` into a shell.** `tools/README.md` shows `cortex-init.sh` run from a
  shallow clone of a release tag. `SECURITY.md` states the rule.

## Alternatives rejected

| Option | Why not |
|---|---|
| Pin the commit SHA from the plugin's git checkout | An installed plugin has no `.git` (checked on a real install). It works only for a developer stamping from a clone |
| Resolve the tag's SHA with `git ls-remote` at stamp time | Network at stamp time, and it trusts the tag at that instant, from a host the stamping machine has no reason to trust more than the runner does |
| Ship a release → SHA ledger in the repo | A release cannot list its own SHA. The ledger would always lag one release, so the newest — the one being stamped — could never be pinned |
| Hash the whole tree (`git rev-parse HEAD^{tree}`) | Needs git on the stamping side, and the installed copy differs from the git tree (CRLF on Windows, extra files), so it would never match |
| Run `cortex-digest.mjs` from the clone to check the clone | Code from the thing under suspicion vouching for itself |
| Verify the native installer's signed manifest with gpg in CI | Possible (the docs publish the key fingerprint and a signed `manifest.json`) but six steps of gpg in every team's workflow. The pinned npm version gives immutability with one line; the manifest route stays open for a team that wants it |
| Keep `curl … \| bash` and pin the version with `bash -s <version>` | The version is pinned, the script that installs it is not |

## Consequences

- A moved or tampered tag stops every PR's review with one error that names both digests, instead
  of running.
- **Templates and anything outside `core/` and `index/` are not covered.** The two commands read
  `templates/` as data only; if a future change makes the review run code from elsewhere, the
  digest's directory list must grow, and the parity test will not notice on its own.
- A developer who stamps from a working tree with unreleased edits under `core/` or `index/` pins a
  digest no tag matches, and that workflow fails until it is stamped from a release. That failure is
  correct; it is also new.
- Bumping the Claude Code version in `agent-evals.yml` is now a manual, reviewed change in this
  repository; the template does not follow new releases on its own.
- The release process is unchanged: nothing has to be published per release for the pin to work.
