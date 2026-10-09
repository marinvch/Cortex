# Design: a release cuts itself, and a drift issue is answered by a pull request

- **Date:** 2026-10-09
- **Status:** Draft. The maintainer delegated approval on 2026-10-09; every choice made under that
  delegation is listed in "Decisions taken for the maintainer" so it can be reversed.
- **Decided by:** the roadmap's locked decisions (Q2, Q3, Q7, Q8, Q17 of
  [the next-level roadmap](2026-10-04-next-level-roadmap-design.md)), and this spec for the rest
- **Area:** `.github/workflows/` (two new workflows, two edited), one path check under `tools/`,
  `docs/adr/` (0022, 0023), `docs/changing-cortex.md`. This is step 1.0 of
  [the plan](../plans/2026-10-04-next-level-roadmap.md). It gates steps 1.2, 1.3 and 1.4 and writes
  no code.

Claims about GitHub or Claude Code carry a tag such as [G1] or [C3]. Each tag is a sentence copied
from the official docs, listed with its URL under [Sources](#sources), read on 2026-10-09
([ADR 0017](../adr/0017-anthropic-docs-are-the-authoring-source.md)). What could not be confirmed
is under [Not confirmed](#not-confirmed) and nothing here depends on it.

## Destination

- A merge to `master` that changes `VERSION` produces a tag on that merge commit and a GitHub
  release whose body is that version's changelog section. Nobody runs a script.
- A `site-drift` issue is answered by one pull request on the site repository. A `docs-drift` issue
  that reports a stale rule is answered by one pull request here. A maintainer merges both.
- The model runs in a job that holds no credential able to write to any repository.
- The chain closes without a manual dispatch: release, drift issue, pull request, merge, issue
  closed.

## Decisions taken for the maintainer

One line each. "Reverse" says what changes if the other option is wanted.

| # | Decision | Alternative | Reverse by |
|---|---|---|---|
| D1 | `release.yml` runs on every push to `master` and compares `VERSION` before and after in the job | a `paths: [VERSION]` filter | adding the filter; the job check stays |
| D2 | Latest goes to the highest version, set explicitly when the release is created | let GitHub choose by date and version | dropping the `--latest` flags |
| D3 | The twenty untagged versions are back-filled by hand, once, with the loop in this spec | leave them untagged; or release only 2.41.38 | not running the loop |
| D4 | `release.yml` uses `GITHUB_TOKEN` with `contents: write` and no secret | a personal token, so a `release` event could start other workflows | nothing depends on that event; add a token only if something must |
| D5 | The agent is started by `workflow_dispatch` from the workflow that found the drift, carrying the issue number. There is no `issues:` trigger | open the issue with a personal token so an `issues` event fires | see "The trigger"; it costs a standing token with issue write |
| D6 | The agent is `claude -p` in a job with `contents: read`, not `anthropics/claude-code-action` | the action with a custom `github_token` | swapping the one step; the job split stays |
| D7 | The model edits a working tree and nothing else. A later job with no model applies the patch, checks its paths and opens the pull request | let the agent push and open the PR itself | not recommended; it puts a write token beside the model |
| D8 | The agent has no shell, no web tool and no MCP server. The workflow fetches, builds and tests | allow `Bash` for the build and tests | adding allow rules; the token is then reachable by code the agent wrote |
| D9 | Model `sonnet` (the alias), 40 turns, 20 minutes, one run at a time | a pinned model id; `opus` | one flag |
| D10 | Permission mode `dontAsk` with allow rules for the allowed paths | `acceptEdits`; `bypassPermissions` | one flag; `bypassPermissions` is ruled out |
| D11 | The site pull request uses a fine-grained personal token limited to the site repository, with Contents and Pull requests write, expiring in 90 days | a GitHub App installed on the site repository | replacing one secret with an app id and key; see "Tokens" |
| D12 | The `docs-drift` pull request here is opened with `GITHUB_TOKEN`. Its CI waits for "Approve workflows to run" | the same personal token, widened to this repository | widening D11's token; CI then starts unasked |
| D13 | Both secrets live in one environment, `drift-agent`, limited to the `master` branch | repository secrets | moving the two secrets; a branch could then read them |
| D14 | For `docs-drift` the agent runs only on a stale rule (exit 1). A new page (exit 3) and an unreadable page (exit 2) start nothing | let the agent run `--accept` for new pages | not recommended; it breaks ADR 0017 |
| D15 | The agent's rules PR writes its changelog lines under `## [Unreleased]` and never touches `VERSION` | let it stamp a version | not recommended; a merge would then release |
| D16 | `site-drift.yml` also runs daily, and retires an issue whose pull request has merged or closed | a token in the site repository that dispatches back on merge | adding that token; it is a second standing secret |
| D17 | The PR is the playback. `/site-sync` stops and asks before committing; in CI nothing is published until a maintainer merges | no unattended site drafts at all | disabling `drift-agent.yml` |
| D18 | Claude Code is installed at a pinned version in the job | the `stable` channel | one argument |

## What the maintainer creates by hand

Nothing below can be created by a workflow or by an agent.

**Secrets** (both in the environment `drift-agent`, see D13):

| Name | What it is | How it is made | Least it needs |
|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | the subscription sign-in for the model | `claude setup-token` on the maintainer's machine; it prints the token once [C1] | model requests only, which is all it can do [C1] |
| `SITE_PR_TOKEN` | a fine-grained personal access token | GitHub → Settings → Developer settings → Fine-grained tokens | resource owner: the account that owns the site repository. Repository access: only `marinvch/cortex-site` [G12]. Permissions: **Contents: read and write**, **Pull requests: read and write** [G13]. Not Workflows, not Actions, not Administration. Expiry: 90 days |

**Settings:**

1. An environment named `drift-agent` in this repository, deployment branches set to "Selected
   branches and tags" with the one pattern `master` [G15]. Needed before step 1.3.
2. A ruleset on the site repository's `main` with "Require a pull request before merging" [G16] and
   no bypass for the token's owner. On 2026-10-09 `main` had no rule at all, so the token in D11
   could push to it. Needed before step 1.3.
3. This repository's `master` ruleset already holds `pull_request`, `non_fast_forward` and
   `deletion` (read on 2026-10-09). Confirm its bypass list does not include GitHub Actions.
4. "Allow GitHub Actions to create and approve pull requests" stays on [G19]. It is on today. D12
   needs it.
5. The back-fill in "The twenty untagged versions", once, at any time.
6. Recommended, separate from this work: set the default `GITHUB_TOKEN` permission to read. It is
   `write` today, and three test workflows declare no `permissions` block, so they inherit it.

No GitHub App is installed, and the Claude GitHub App is not needed (D6).

## Context

**What exists.** `site-drift.yml` runs on each push to `master`, compares the site's
`site-facts.json` with master, and opens, comments on or closes one `site-drift` issue.
`claude-docs.yml` runs daily and opens or comments on one `docs-drift` issue. Both use
`GITHUB_TOKEN` with `contents: read` and `issues: write`, and call no model. Their issues are
authored by `github-actions[bot]` (read from this repository's issues on 2026-10-09).
`tools/cortex-release-notes.mjs` prints one version's changelog section or refuses (2.41.37).
`node tools/cortex-version.mjs` exits 1 when a version site disagrees with `VERSION`.

**Releases today.** Tags `v2.41.8`–`v2.41.18` sit on each version's merge commit, with a release
titled `v<version>` targeting that commit's SHA. `VERSION` is 2.41.38. Versions 2.41.19–2.41.38
are on `master` with no tag. Pull requests are merged with merge commits.

**Decided earlier, and kept.**
- The plugin ships no hooks and no mod
  ([ADR 0021](../adr/0021-cortex-ships-no-mod-and-keeps-the-claude-md-shim.md)). Nothing here is
  shipped to a user: the workflows are maintainer tooling.
- [ADR 0018](../adr/0018-skill-quality-is-measured-by-evals-not-telemetry.md) rejected running
  model evals in CI, because every pull request would need a model credential and a budget. This
  design does not reopen that. The model runs once per drift issue, never per pull request, and no
  check's verdict depends on it.
- A new docs page creates no rule until a maintainer has read it (ADR 0017). See D14.
- [ADR 0004](../adr/0004-no-runtime-dependencies.md): installing Claude Code on a CI runner adds no
  dependency to what Cortex ships.
- The detecting workflows keep calling no model. The agent is a third workflow.

## Architecture

```
push to master ─┬─ release.yml ──── VERSION changed? ── tag on GITHUB_SHA + release      (GITHUB_TOKEN)
                └─ site-drift.yml ─ drift? ─ opens issue ─┐
daily ─────────── site-drift.yml (new) ───────────────────┤ gh workflow run drift-agent.yml
daily ─────────── claude-docs.yml ─ stale rule? ─ issue ──┘        -f issue=<n> -f kind=<site|docs>
                                                           ▼
drift-agent.yml   gate ──► draft ──► check ──► open-pr ──► report
                  no       model,    builds,   write       comments on
                  secret   no write  no secret token,      the issue
                           token               no model
```

### 1. `release.yml` (step 1.2)

**Event.** `on: push: branches: [master]`. No path filter (D1). A filter has documented cases
where it runs anyway or does not run [G6], and a workflow skipped by a filter cannot say why. The
job decides, in shell that a test can run.

**Detecting "this merge changed VERSION".** The push payload carries the commit `master` was at
before the push [G5]. The job checks out with full history and compares
`git show "$BEFORE:VERSION"` with `VERSION` at `GITHUB_SHA`. Equal: it prints "VERSION unchanged"
and exits 0. `BEFORE` missing or unreachable: it fails and releases nothing. `BEFORE` reaches the
script through an environment variable, never through `${{ }}` in the script text [G20].

**Why the tag lands on the merge commit.** For a push, `GITHUB_SHA` is the tip commit pushed
[G5], which for a merged pull request is the merge commit. That commit is the tree that was
reviewed under that version number. The job passes the SHA, not the branch name: the tag is created
from `target_commitish`, whose default is the default branch [G7], and `master` may have moved by
the time the job runs.

**Order of the job.**
1. `VERSION` changed (above).
2. `node tools/cortex-version.mjs` exits 0. A half-stamped version is not released.
3. `node tools/cortex-release-notes.mjs "$v" > notes.md` exits 0. An empty section, or one that
   runs into the next version, fails the job and releases nothing.
4. Tag `v$v` exists on the remote: print where it points and whether a release exists, exit 0.
   This is the idempotence rule, and it is why a re-run does nothing. The check is made once,
   immediately before step 5; nothing loops or retries.
5. `gh release create "v$v" --target "$GITHUB_SHA" --title "v$v" --notes-file notes.md`, with
   `--latest` when `v$v` is higher than every existing `v*` tag and `--latest=false` otherwise
   [G8].
6. Read the tags again. If a higher version now has a release, set Latest on that one. Two merges
   minutes apart run two jobs, and the slower must not take Latest from the newer.
7. Print every version that has a changelog section above the lowest untagged one and no tag. A
   push that carried several merges releases only its tip; the rest are named here and back-filled
   by hand.

**No concurrency group.** A group keeps one run pending and cancels an older pending run when a
newer one queues [G18]. Three quick merges would lose the middle release. Steps 4–6 make
concurrent runs safe instead.

**What marks a release Latest.** The explicit flag (D2). The REST default is `true` for every new
release [G7], and the CLI default is "automatic based on date and version" [G8]. Neither is right
for a back-filled or late release, so the job always says which.

**Token.** `permissions: contents: write`, which "allows the action to create a release" [G10].
Everything else is `none` [G4]. No secret. A release created with `GITHUB_TOKEN` starts no other
workflow [G1], and nothing depends on a `release` event: `site-drift.yml` is started by the same
push, not by the release.

**Rollback.** A release nobody wanted is undone by deleting the release and the tag, by hand. The
workflow run for that commit must not be re-run afterwards: a re-run would find no tag and create
it again. The way forward is a new stamped version.

**The twenty untagged versions (2.41.19–2.41.38).** Options:

| Option | What it gives | Cost |
|---|---|---|
| **A. Back-fill all twenty by hand (recommended)** | every version has a tag on its merge commit and a release; `/site-sync`'s `git log v$was..HEAD` works for a site synced to any of them | one loop, about twenty API calls, releases dated today |
| B. Tags only, no releases | the range queries work | the releases page skips twenty versions |
| C. Release 2.41.38 only | Latest is right today | nineteen versions stay unaddressable by tag |
| D. Leave them; start at the next stamped version | nothing to do | Latest stays 2.41.18 until the next release; step 7 lists twenty versions on every run |
| E. A back-fill mode in `release.yml` | no hand work | a workflow that can tag arbitrary old commits, kept for one use |

A is the recommendation and stays the maintainer's manual act. Each of the twenty versions maps to
exactly one first-parent commit that changed `VERSION` (checked on 2026-10-09: 2.41.19 at
`4795e50` through 2.41.38 at `564fcdd`). Print the pairs first, then create:

```bash
git fetch origin --tags
for c in $(git log --first-parent --reverse --format=%H v2.41.18..origin/master -- VERSION); do
  v="$(git show "$c:VERSION" | tr -d '[:space:]')"
  node tools/cortex-release-notes.mjs "$v" > "$TMPDIR/notes-$v.md" || break
  gh release create "v$v" --target "$c" --title "v$v" --notes-file "$TMPDIR/notes-$v.md" --latest=false
done
gh release edit "v<highest version now tagged>" --latest
```

It is safe before or after step 1.2 merges, because every release in it says `--latest=false` and
the last line names Latest once.

### 2. Tokens

| Job | Token | Permissions | Why this one |
|---|---|---|---|
| `release.yml` | `GITHUB_TOKEN` | `contents: write` | one repository, no secret [G3] |
| `site-drift.yml`, `claude-docs.yml` | `GITHUB_TOKEN` | `contents: read`, `issues: write`, and new: `actions: write` | to dispatch the agent [G11] |
| `drift-agent.yml` / `gate` | `GITHUB_TOKEN` | `issues: write` | reads the issue, writes the run marker |
| `drift-agent.yml` / `draft` | `GITHUB_TOKEN` + `CLAUDE_CODE_OAUTH_TOKEN` | `contents: read` | the model's job; cannot write anywhere |
| `drift-agent.yml` / `check` | `GITHUB_TOKEN` | `contents: read` | runs the build and tests; holds no secret |
| `drift-agent.yml` / `open-pr`, kind `docs` | `GITHUB_TOKEN` | `contents: write`, `pull-requests: write`, `issues: write` | a PR in this repository |
| `drift-agent.yml` / `open-pr`, kind `site` | `SITE_PR_TOKEN` + `GITHUB_TOKEN` | the fine-grained token; `issues: write` here | a PR in another repository |

**The fact everything turns on.** "When you use the repository's `GITHUB_TOKEN` to perform tasks,
events triggered by the `GITHUB_TOKEN` will not create a new workflow run", except
`workflow_dispatch`, `repository_dispatch`, and pull request events that wait for approval [G1]
[G2]. Three consequences:

1. A drift issue opened by `site-drift.yml` or `claude-docs.yml` fires no `issues` workflow. The
   roadmap's "triggered by an issue" cannot be an `issues:` trigger while those workflows use
   `GITHUB_TOKEN`. The dispatch exception is the documented way through (D5).
2. A release created by `release.yml` starts nothing. Nothing is built to depend on it (D4).
3. A pull request opened here with `GITHUB_TOKEN` gets its CI in an approval-required state; "a
   user with write access to the repository can start the runs by selecting **Approve workflows to
   run**" [G2]. That click is part of reviewing the agent's PR (D12).

**The cross-repository pull request.** `GITHUB_TOKEN` "can only access resources within the
workflow's repository" [G3], so it cannot push a branch to `marinvch/cortex-site` or open a pull
request there. The docs name a GitHub App for that case [G3]; a fine-grained personal token is the
other documented kind that can be limited to one repository and to named permissions [G12].

- *Chosen (D11):* a fine-grained personal token. One secret, one repository, two permissions, an
  expiry date. Workflows is a separate permission [G13] that a fine-grained token needs before it
  may touch a workflow file [G9], and this token does not have it.
- *Rejected for now:* a GitHub App. Its tokens are minted per run and expire, and its pull
  requests are not authored as a person. It costs an app registration, an installation, a client
  id and a private key that does not expire. It is the better choice once more than one person
  maintains the site, and the swap is one step in `open-pr`.
- *Rejected:* the Claude GitHub App. Installing it grants Actions, Contents, Pull requests and
  Workflows write among others, and "GitHub doesn't let you accept a subset" [C6].
- *Rejected:* a classic personal token. It "can access every repository that you can access"
  [G12].

A pull request opened with the personal token is authored as the maintainer, and the site's own
CI starts on it without approval [G2].

**The model's sign-in.** `claude setup-token` makes "a one-year OAuth token" for "CI pipelines,
scripts, or other environments where interactive browser login isn't available"; it "authenticates
with your Claude subscription", needs a Pro, Max, Team or Enterprise plan, and "can only make model
requests" [C1]. That answers the roadmap's open question: a subscription token can drive an
unattended run, and the docs describe this use. Runs "use your Claude subscription instead of API
billing" [C6], so they count against the maintainer's own limits. Deleting the secret does not
revoke the token: "the credential it held stays valid" [C6].

- *Rejected:* an API key. It works, bills per token, and is the documented choice for a secret
  shared across repositories [C6]. The roadmap chose the subscription (Q8).
- *Rejected:* workload identity federation. It stores no long-lived secret [C6] and needs a
  Console organization and service account, which the subscription path does not have.

**Where the secrets live (D13).** Environment secrets "are only available to workflow jobs that
use the environment" [G15], and an environment can be limited to named branches [G15]. A branch
pushed by anyone with write access could otherwise run an edited workflow that prints a repository
secret. Secrets never reach a workflow triggered from a fork [G14]. Each secret is referenced in
the `env:` of the one step that uses it.

### 3. The drift agent (steps 1.3 and 1.4)

**What runs it (D6).** `claude -p`, installed in the job at a pinned version; the installer
"accepts either a specific version number or a release channel" [C7].

- *Rejected:* `anthropics/claude-code-action`. By default it "authenticates as the Claude GitHub
  App" [C6], and it is built for Claude to push and open pull requests. It also "rejects a bot
  actor unless you list it in `allowed_bots`" [C6], and a dispatch from a workflow has a bot as
  actor. Every one of these can be configured away. What remains is a third-party action in the
  job that holds the model secret, where one CLI call does the same work.
- `--bare` cannot be used: bare mode "does not read `CLAUDE_CODE_OAUTH_TOKEN`" [C2]. Without it a
  `-p` session "runs the hooks in a project's `.claude/settings.json`" [C3], and this repository
  has a `UserPromptSubmit` hook there. So the run passes `--setting-sources user`, with which
  Claude Code "reads neither the project's settings files nor its `.mcp.json`" [C3].

**The trigger (D5).** `drift-agent.yml` has one trigger, `workflow_dispatch`, with inputs `issue`
(a number) and `kind` (`site` or `docs`). It has no `issues:` trigger, so an issue opened by any
account, with any label, starts nothing. Dispatching needs write access to the repository [G11],
and the workflow file must be on the default branch [G11].

- `site-drift.yml` dispatches in the branch where it **creates** an issue, never where it
  comments on one.
- `claude-docs.yml` dispatches when the report is exit 1 and the issue carries no run marker
  (D14).
- A maintainer may dispatch by hand, for example for the two drift issues open today.

**The `gate` job.** It holds no secret and runs first. It fails, naming the reason, unless all of
these hold: `issue` is an integer; the issue is open; it carries the label for `kind`; its author
is `github-actions[bot]`; it has no `<!-- drift-agent:run -->` comment. Then it writes that
comment. A hand dispatch against an issue someone else opened stops here. Inputs reach the script
as environment variables [G20].

**One run per issue.** The marker is written before the model starts, so a crashed run is not
retried by automation. A maintainer starts a second run with an input `rerun: true`. The workflow
has `concurrency: drift-agent` without `cancel-in-progress`, so at most one run is in progress
[G18]. Both detecting workflows keep at most one open issue each, so in the steady state the
number of runs is bounded by the number of pull requests the maintainer merges.

**The `draft` job: the only one with a model.**

| Setting | Value | Source |
|---|---|---|
| Model | `--model sonnet`, "the latest Sonnet model for daily coding tasks" | [C5] |
| Turns | `--max-turns 40`; it "exits with an error when the limit is reached" | [C5] |
| Time | `timeout-minutes: 20` on the job | [G18] |
| Mode | `--permission-mode dontAsk`: it "auto-denies every tool call that would otherwise prompt you", meant for "CI pipelines or restricted environments where you pre-define what Claude may do" | [C4] |
| Tools | `--tools "Read,Edit,Write,Glob,Grep"`. No `Bash`, no web tools | [C5] |
| Allow rules | `--allowedTools` with `Edit` and `Write` rules for the allowed paths only; rules use gitignore patterns | [C5] [C8] |
| Settings | `--setting-sources user`; the runner's user settings are empty | [C3] |
| Persistence | `--no-session-persistence` | [C5] |
| Prompt | a file in this repository, `.github/drift-agent/<kind>.md` | — |

The cost bound is turns × one run per issue × the 20-minute job, on the subscription (D9).
`--max-budget-usd` is not relied on; see Not confirmed.

Under `dontAsk`, writes to `.git` and `.claude` are denied whatever the allow rules say [C4].
`.github` is not on that protected list, so it is covered by the path check and by the tokens.

The agent cannot run a command, so it cannot run code it wrote while the model secret is in the
process environment (D8). The steps that run code are the workflow's:

- *Kind `site`, before the model:* clone the public site with no token into the runner's temp
  directory; run `cortex-site-facts.mjs --out`, `cortex-site-demo.mjs --out` and the view render
  from `/site-sync` step 3. These are scripts from `master`.
- *Kind `docs`, before the model:* fetch each source page the report names into a directory.
- *The model's task:* for `site`, redraft only the prose pages `skills/site-sync/PAGES.md` maps to
  a changed source, as `/site-sync` step 3 says. For `docs`, update the rule's value, evidence and
  `CHECKED` in `core/claude-code.js`, its test, and add lines under `## [Unreleased]`. The issue
  body and the fetched pages are given as files and named as data to read, not as instructions.
- *After the model:* `git diff --binary` is saved as an artifact. Nothing is committed here.

**The `check` job.** No secret. It applies the patch to a fresh checkout and runs, for `site`,
`npm ci && npm run build`; for `docs`, the core tests and
`node tools/cortex-claude-docs.mjs --check`. A failure stops the run. No pull request is opened.

**The `open-pr` job: the only one with a write token, and it runs no model.** It applies the same
patch to a fresh checkout, runs the path check, commits as the bot, pushes the branch
`drift/<kind>-<issue>`, and opens one pull request. It then comments the pull request's URL on the
issue as `<!-- drift-agent:pr <url> -->`. It runs nothing from the patched tree.

**The path limits, and what enforces them.**

| Kind | May change | Never |
|---|---|---|
| `site` | any path in the site repository, except the two below | `.github/**`, `.claude/**` in the site repository; anything in this repository |
| `docs` | `core/claude-code.js`, `core/test/claude-code.test.js`, `CHANGELOG.md` | every other path, `VERSION` and `tools/claude-docs-seen.json` included |

Four layers, the first two of which do not depend on the agent behaving:

1. **The path check.** `tools/cortex-drift-paths.mjs --kind <kind>` reads the changed names from
   `git diff --cached --name-status -z` and exits 1 naming each path outside the list. Both names
   of a rename are checked. It is run from a clean checkout of `master`, in `open-pr`, against the
   staged patch, so the check that decides is not one the patch could have edited. It has a
   fragment in `tools/test/`. The same script runs as a pull request check, `drift-paths.yml`, on
   any pull request whose head branch starts with `drift/`, so a later commit to that branch that
   leaves the list fails the PR.
2. **The tokens.** The `draft` job's token is `contents: read`. `SITE_PR_TOKEN` reaches one
   repository [G12] and has no Workflows permission [G9] [G13]. `GITHUB_TOKEN` "cannot be
   authorized" to modify workflow files [G9]. `master` requires a pull request today, and the
   site's `main` does once setting 2 above is in place [G16].
3. **The allow rules** (table above). The agent's edits outside the list are denied as they are
   attempted.
4. **The prompt**, which states the list. It is the weakest layer and is not counted on.

**Pull requests only.** The agent never merges and never releases (Q3). That is structural: the
model has no write token; the job with one runs a fixed script; `VERSION` is outside every list,
so merging an agent PR cannot start `release.yml`'s release path (D15).

**Consent (D17).** `/site-sync` step 4 stops and asks before anything is committed. An unattended
run cannot ask. The pull request takes that place: it shows the whole diff, and the site's `main`
deploys only when a maintainer merges. The skill's text is unchanged; the prompt file states the
difference.

**A new page is not the agent's (D14).** For exit 3 the fix is `--accept`, which records that a
maintainer has read the page. An agent running it would record something that did not happen.

### 4. How the chain closes

**Site.**
1. A stamped merge is pushed. `release.yml` releases it. `site-drift.yml`, started by the same
   push, finds the version fact changed and opens a `site-drift` issue, or comments if one is open.
2. On opening, it dispatches the agent [G1]. The agent's PR appears on the site repository.
3. The maintainer merges it. The site deploys.
4. `site-drift.yml` runs again, on the next push or on its new daily schedule (D16). Facts match:
   it closes the issue, as it does today.
5. Facts still differ, because `master` moved after the PR was drafted: the issue's recorded pull
   request is merged or closed, so the workflow closes that issue as finished and opens a new one,
   which dispatches a new run. This keeps "one run per issue" true and still converges.

- *Rejected:* a workflow in the site repository that dispatches back here on merge. It closes the
  issue minutes sooner and needs a token with Actions write on this repository stored in the site
  repository. A daily run needs none. A scheduled workflow in a public repository is disabled
  after 60 days without activity [G21]; pushes here are activity.
- *Not used:* a closing keyword in the site PR. The docs give the cross-repository form [G17], but
  whether a token limited to the site repository can close an issue here is not confirmed, and
  step 5 does not need it.

**Docs.** `claude-docs.yml` finds a stale rule and dispatches. The agent's PR body carries
`Closes #<issue>`. "When you merge a linked pull request into the **default branch** of a
repository, its linked issue is automatically closed" [G17]. The maintainer stamps a version when
they choose, and that stamped merge is what `release.yml` releases.

**A failed run.** A `report` job runs when any job failed. It comments the run's URL on the issue
and leaves the issue open. A sign-in failure, a failed build, a refused path and an expired token
all end here, visibly, and none of them closes anything.

## Verification

Each row matches the plan's "Verified by" column.

| Step | Check | How |
|---|---|---|
| 1.2 | the next stamped merge produces a tag on its merge commit and a release marked Latest | after that merge: `git rev-parse "v$v^{commit}"` equals the merge commit; `gh release view --json tagName` with no tag argument returns `v$v` |
| 1.2 | a merge with no version change produces none | the run's log says "VERSION unchanged"; `git tag` and the releases list are unchanged |
| 1.2 | a re-run with the tag present does nothing | re-run that run from the Actions tab: it prints where the tag points, exits 0, and the release's id and date are unchanged |
| 1.2 | the detection, the Latest rule and the idempotence rule, before any real release | the job's shell lives in a script with a fragment in `tools/test/` that builds a scratch repo: unchanged, changed, tag present, a higher tag present, a missing `BEFORE` |
| 1.3 | a dispatched `site-drift` issue yields one site PR that builds | dispatch `site-drift.yml` while the site is behind; one PR appears on the site, its `check` job and the site's own CI pass; the issue carries the run and PR markers |
| 1.3 | an issue opened by another account starts nothing | open a `site-drift`-labelled issue by hand: no run starts. Dispatch the agent against it: `gate` fails naming the author |
| 1.3 | one run per issue | dispatch a second time against the same issue: `gate` fails naming the marker |
| 1.3 | the job's token cannot push to `master` or edit workflows | the workflow's `permissions` blocks are asserted by a test that reads the YAML; a self-test input makes `draft` try to create a ref and expect a refusal; a seeded patch touching `.github/workflows/` is refused by the path check; the rules on `master` and on the site's `main` are read and must include `pull_request` |
| 1.4 | a seeded drift yields a PR touching only allowed paths | `claude-docs.yml` gains a dispatch input naming a fixture page set (`--pages`) with one reworded sentence; the run opens an issue, the agent opens a PR, and its changed files are a subset of the three |
| 1.4 | a PR touching any other path fails the check | a hand-pushed branch `drift/docs-selftest` that edits `README.md`: `drift-paths.yml` fails naming the path. The fragment in `tools/test/` covers a rename out of the list and each forbidden path |

Steps 1.2 and 1.3 change workflows and ADRs only and are not stamped. Step 1.4 adds a tool under
`tools/`, so it is stamped, with rows in `README.md`'s Tools table and `tools/README.md`.

## Risks & edges

- **Text the agent reads is not trusted.** The `docs` run reads pages from the web; the `site` run
  reads this repository's own changelog. A page could carry instructions. The bound is what the
  agent can reach: no shell, no network tool, no write token, three files or one repository, and a
  PR a person reads. The one secret in its process is the model token, and it has no tool that can
  send it anywhere.
- **A subscription token in CI.** It lasts a year [C1], is tied to one person's subscription [C6],
  and outlives its secret [C6]. A run that cannot sign in fails and comments. The rotation dates
  for both secrets belong in the maintainer's own calendar, not in this repository.
- **The personal token acts as a person.** Site PRs are authored as the maintainer. With the
  ruleset in place it cannot reach `main` except by a merged PR. Without the ruleset it can. Step
  1.3 reads the rule and refuses to run when it is absent.
- **A release nobody wanted** is released at once. See Rollback. `docs/changing-cortex.md` gains
  the line in step 1.2: stamping a version on `master` is releasing it.
- **A push with several stamped merges** releases only the tip. Step 7 of the job names the rest.
- **A stale site PR.** `master` moves after the draft. Chain step 5 handles it with a second issue
  and a second run. Two site PRs can then exist in sequence, never at once.
- **The agent's build passes and the prose is wrong.** Nothing here judges prose. The maintainer's
  review does.
- **An approval nobody clicks.** A docs PR whose CI waits for approval looks idle. The agent's
  comment on the issue says so.
- **The pinned Claude Code version ages.** A model alias can come to need a newer version. The
  run then fails visibly and the pin is bumped by hand (D18).
- **`actions: write` on the detecting workflows** lets them dispatch any workflow here and cancel
  runs [G10]. They run only this repository's own scripts on `master`.

## Not confirmed

None of these is relied on. Each is settled by the step named.

- **Whether `gh release create --target <sha>` with `GITHUB_TOKEN` is refused when a later commit
  on `master` changed a workflow file.** The docs say the token must be authorized for workflows
  when the target commit "adds or modifies any file under .github/workflows/ relative to the
  repository's default branch", and that `GITHUB_TOKEN` cannot be [G9]. Whether an older commit of
  the default branch counts is not stated. Step 1.2 tests it. If it is refused, the release job
  fails visibly, and the fallback is the maintainer's own `gh` for that version.
- **Whether `--max-budget-usd` means anything on a subscription token.** It stops on "estimated
  spend on API calls" and "can differ from your bill" [C5]. The bound here is turns and minutes.
- **The usage limits a subscription applies to unattended runs.** Not on the pages read.
- **How a `setup-token` token is revoked** before its year ends. Not on the pages read.
- **That `git push` over HTTPS with a fine-grained token needs only Contents write.** The
  permissions page lists REST endpoints [G13], not the git transport. Step 1.3's first run shows it.
- **That `actions: write` is the `GITHUB_TOKEN` permission a dispatch needs.** The docs state it
  for fine-grained tokens and GitHub Apps [G11]. Step 1.3 shows it.
- **The login `github-actions[bot]`.** Read from this repository's issues, not from a docs page.
- **Whether `--setting-sources user` also keeps a project's `CLAUDE.md` out.** Not needed: the
  prompt names the files to read.
- **Whether a cross-repository closing keyword works with a token limited to the other
  repository.** Not used.
- **The exact allow-rule strings** for the three files and for the site tree. The syntax is
  documented [C8]; the strings are written and tried in step 1.3.

## Out of scope

- An agent that merges, releases, stamps a version, or accepts a new docs page.
- Any change to a workflow, a setting, or `.claude/` by the agent, in either repository.
- An `issues:` or `issue_comment:` trigger, and any `@claude` mention workflow.
- Running the model on pull requests, on a schedule, or for anything but the two drift kinds.
- A workflow or a token in the site repository.
- Back-filling the twenty versions from a workflow.
- Changing `/site-sync`, which stays the way a person syncs the site.
- Tightening the default `GITHUB_TOKEN` permission for the three test workflows.
- Release assets, pre-releases, drafts, and generated release notes.

## Sources

Read on 2026-10-09. Each line is the sentence the tag stands for.

**GitHub**

- **[G1]** <https://docs.github.com/en/actions/concepts/security/github_token> — "When you use the
  repository's `GITHUB_TOKEN` to perform tasks, events triggered by the `GITHUB_TOKEN` will not
  create a new workflow run, with the following exceptions:" and "`workflow_dispatch` and
  `repository_dispatch` events always create workflow runs."
- **[G2]** same page — "when a workflow using `GITHUB_TOKEN` creates or updates a pull request,
  the resulting `pull_request` event creates workflow runs in an **approval-required** state." and
  "If you need workflow runs from workflow-created pull requests to execute without requiring
  approval, use a GitHub App installation access token or a personal access token instead of
  `GITHUB_TOKEN` when creating or updating the pull request."
- **[G3]** same page — "The token's permissions are limited to the repository that contains your
  workflow." And
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow>
  — "the `GITHUB_TOKEN` can only access resources within the workflow's repository. If you need to
  access additional resources, such as resources in an organization or in another repository, you
  can use a GitHub App."
- **[G4]** <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions>
  — "If you specify the access for any of these permissions, all of those that are not specified
  are set to `none`."
- **[G5]** <https://docs.github.com/en/webhooks/webhook-events-and-payloads#push> — "`before` …
  The SHA of the most recent commit on ref before the push." And
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push>
  — `GITHUB_SHA` for `push`: "Tip commit pushed to the ref."
- **[G6]** <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow>
  — "If a push contains more than 1,000 commits, the workflow will **always** run." and "If the
  generated diff contains more than 3,000 files and the files the workflow filter matches are not
  in the first 3,000 returned by the filter, the workflow will **not** run."
- **[G7]** <https://docs.github.com/en/rest/releases/releases#create-a-release> —
  `target_commitish`: "Specifies the commitish value that determines where the Git tag is created
  from. Can be any branch or commit SHA. Unused if the Git tag already exists. Default: the
  repository's default branch." `make_latest`: "Specifies whether this release should be set as
  the latest release for the repository. Drafts and prereleases cannot be set as latest. Defaults
  to true for newly published releases."
- **[G8]** <https://cli.github.com/manual/gh_release_create> — "`--latest` Mark this release as
  "Latest" (default [automatic based on date and version]). --latest=false to explicitly NOT set
  as latest" and "Use `--target` to point to a different branch or commit for the automatic tag
  creation."
- **[G9]** <https://docs.github.com/en/rest/releases/releases#create-a-release> — "If the commit
  identified by target_commitish (or, when target_commitish is omitted, the latest commit on the
  default branch) adds or modifies any file under .github/workflows/ relative to the repository's
  default branch, the authenticating token must be authorized to modify workflows."; "Fine-grained
  access tokens and GitHub App installation tokens also need the "Workflows" repository
  permission (write)."; and "The GITHUB_TOKEN available to GitHub Actions cannot be authorized for
  this".
- **[G10]** <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions>
  — "`contents: write` allows the action to create a release." and "`actions: write` permits an
  action to cancel a workflow run."
- **[G11]** <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow>
  — "To trigger the `workflow_dispatch` event, your workflow must be in the default branch." and
  "Write access to the repository is required to perform these steps." And
  <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>
  — under "Actions": `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`,
  write.
- **[G12]** <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
  — "Each token can be further limited to only access specific repositories for that user or
  organization." and "Each token is granted specific, fine-grained permissions". Of a classic
  token: "Your personal access token (classic) can access every repository that you can access."
- **[G13]** <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>
  — under "Pull requests": `POST /repos/{owner}/{repo}/pulls`, write. Under "Contents":
  `POST /repos/{owner}/{repo}/git/refs`, write. "Workflows" is a separate permission whose table
  lists the same contents and refs endpoints, write.
- **[G14]** <https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets>
  — "With the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is
  triggered from a forked repository."
- **[G15]** <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>
  — "These secrets are only available to workflow jobs that use the environment." And
  <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
  — "**Selected branches and tags:** Only branches and tags that match your specified name
  patterns can deploy to the environment."
- **[G16]** <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
  — "You can require that all changes to the target branch be associated with a pull request."
- **[G17]** <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>
  — "When you merge a linked pull request into the **default branch** of a repository, its linked
  issue is automatically closed." Syntax table: "Issue in the same repository | KEYWORD
  #ISSUE-NUMBER" and "Issue in a different repository | KEYWORD OWNER/REPOSITORY#ISSUE-NUMBER".
- **[G18]** <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
  — "there can be at most one running job or workflow in a concurrency group at any time." and "By
  default, any existing `pending` job or workflow in the same concurrency group will be canceled
  and the new queued job or workflow will take its place." And workflow syntax,
  `jobs.<job_id>.timeout-minutes`: "The maximum number of minutes to let a job run before GitHub
  automatically cancels it. Default: 360".
- **[G19]** <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository>
  — "use the **Allow GitHub Actions to create and approve pull requests** setting to configure
  whether `GITHUB_TOKEN` can create and approve pull requests."
- **[G20]** <https://docs.github.com/en/actions/reference/security/secure-use> — "For inline
  scripts, the preferred approach to handling untrusted input is to set the value of the
  expression to an intermediate environment variable."
- **[G21]** <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>
  — "In a public repository, scheduled workflows are automatically disabled when no repository
  activity has occurred in 60 days."

**Claude Code**

- **[C1]** <https://code.claude.com/docs/en/authentication> — "For CI pipelines, scripts, or other
  environments where interactive browser login isn't available, generate a one-year OAuth token
  with `claude setup-token`"; "It does not save the token anywhere; copy it and set it as the
  `CLAUDE_CODE_OAUTH_TOKEN` environment variable wherever you want to authenticate"; "This token
  authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan.
  It can only make model requests".
- **[C2]** same page — "Bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`. If your script passes
  `--bare`, authenticate with `ANTHROPIC_API_KEY` or an `apiKeyHelper` instead."
- **[C3]** <https://code.claude.com/docs/en/headless> — "Without `--bare`, a `-p` session runs the
  hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even
  in a folder you've never trusted." And <https://code.claude.com/docs/en/permissions> — "Pass
  `--setting-sources user`, or set the SDK's `settingSources` without project settings, so Claude
  Code reads neither the project's settings files nor its `.mcp.json`".
- **[C4]** <https://code.claude.com/docs/en/permission-modes> — "If you set `dontAsk` mode, Claude
  Code auto-denies every tool call that would otherwise prompt you." and "Use this mode for CI
  pipelines or restricted environments where you pre-define what Claude may do; the session never
  waits for input." Protected paths table: `dontAsk` — "Denied"; the list includes `.git` and
  `.claude`.
- **[C5]** <https://code.claude.com/docs/en/cli-reference> — `--tools`: "Restrict which built-in
  tools Claude can use." `--allowedTools`: "Tools that execute without prompting for permission."
  `--max-turns`: "Limit the number of agentic turns (print mode only). Exits with an error when
  the limit is reached. No limit by default." `--max-budget-usd`: "Stop the run once estimated
  spend on API calls reaches this amount (print mode only). Claude Code checks the cap against its
  client-side cost estimate, which can differ from your bill." `--no-session-persistence`:
  "Disable session persistence so sessions are not saved to disk and cannot be resumed." And
  <https://code.claude.com/docs/en/model-config> — `sonnet`: "Uses the latest Sonnet model for
  daily coding tasks".
- **[C6]** <https://code.claude.com/docs/en/github-actions> — "`github_token` | Token for GitHub
  operations. When omitted, the Claude Code GitHub Action authenticates as the Claude GitHub App";
  "When you install the app, you accept its full permission set. GitHub doesn't let you accept a
  subset." (the table lists Actions, Contents, Pull requests and Workflows as read and write);
  "on every event, the Claude Code GitHub Action rejects a bot actor unless you list it in
  `allowed_bots`"; "If you authenticate with an OAuth token, runs use your Claude subscription
  instead of API billing."; "an OAuth token is tied to the subscription of the person who ran
  `claude setup-token`"; "If you delete a secret, the credential it held stays valid."; "To avoid
  storing a long-lived secret entirely, authenticate through workload identity federation".
- **[C7]** <https://code.claude.com/docs/en/setup> — "The native installer accepts either a
  specific version number or a release channel (`latest` or `stable`)."
- **[C8]** <https://code.claude.com/docs/en/permissions> — "Read and Edit rules both use gitignore
  pattern syntax with four distinct pattern types".
