# Design: Cortex keeps itself current, proves it helps, and holds several projects and a large team

- **Date:** 2026-10-04
- **Status:** Draft for review
- **Decided by:** the maintainer, in four grilling rounds (Q1–Q20) on 2026-10-04, after 2.41.18
- **Area:** `.github/workflows/` (two new workflows), `evals/` (a brief, tests, the harness),
  `mcp/` and the team-brain layout (project files), `index/lib/view*.mjs` (a workspace mode),
  `core/memory.js` (the memory layout). Scoped briefs: [`core/AGENTS.md`](../../core/AGENTS.md),
  [`index/AGENTS.md`](../../index/AGENTS.md), [`mcp/AGENTS.md`](../../mcp/AGENTS.md),
  [`tools/AGENTS.md`](../../tools/AGENTS.md), [`evals/README.md`](../../evals/README.md).

This is a roadmap. It fixes the order, the decisions and the limits. Each of the four parts gets
its own short spec just before it is built, where its details are decided.

## Destination

Four things are true when this is done:

1. **A release needs nobody to remember it.** A merge that changes `VERSION` is tagged and released
   by a workflow. A `docs-drift` or `site-drift` issue is answered by a pull request that an agent
   opened and a maintainer merges.
2. **There is a number for "Cortex helps".** A harness runs the same tasks in the same repo with and
   without the context layer, and reports which arm finished them.
3. **One place describes several projects.** A team-brain lists its projects, each with its repo,
   its outside links and what it relates to, and one page shows them together. Projects are added
   and removed over time.
4. **The same design works for 2, 10 and 50 developers.** Shared memory does not conflict when many
   people write on the same day.

They are built in that order. Upkeep is first because it is cheap and it is what failed on
2026-10-04: seven versions needed a hand-run script to release, and the public site drifted twice.
The harness is second so the last two can be shown to help.

## Context

What exists today, and where each part starts from.

**Upkeep.** Detection is automatic and repair is manual. `claude-docs.yml` runs daily and opens a
`docs-drift` issue when a cited sentence leaves its page or an unseen page appears
([ADR 0017](../adr/0017-anthropic-docs-are-the-authoring-source.md)); no such issue has been opened
yet, so that path has not run for real. `site-drift.yml` runs on every push to master and opens a
`site-drift` issue; it does not run when the site repo changes, so the issue stays open after the
site PR merges until the workflow is dispatched. No workflow cuts a release. Releases are created by
hand: a tag on the PR's merge commit, the `CHANGELOG.md` section as the body, the newest marked
Latest. The workflows call no model, on purpose.

**Proof.** Five skills have evals (`ship`, `resume`, `cortex-review`, `team-ask`, `cortex`). Each
feeds the skill's text to a model with no tools and scores the answer
([ADR 0018](../adr/0018-skill-quality-is-measured-by-evals-not-telemetry.md)). Nothing measures
whether a repo with Cortex's context layer makes an agent finish a task better. The mods spec left
the same gap open: whether scoped briefs loading automatically changes outcomes. `evals/` has no
scoped brief, and six of its modules have no test found (the 2026-10-04 findings report).

**Several projects.** A team-brain is a shared private repo with a `projects/` folder, created by
`/team-init` and joined per product repo by `/team-add` through `.cortex/connector.json`. The
route-map spec treats a team-brain's projects as a workspace, and `index/cortex-routes.mjs
--workspace` answers one cross-repo question: which project serves a call. `/cortex-view` renders
one repo. No page shows several.

**Large team.** `.cortex/memory/` is committed, one append-only file per day
([ADR 0002](../adr/0002-committed-repo-memory.md)). Entries carry no author, and Cortex stamps no
merge rule for those files. Two developers appending to the same day's file on different branches
would be expected to conflict at the end of the file. This has not been reproduced here.
[ADR 0008](../adr/0008-three-audiences-one-seam.md) records that only the solo path had been
exercised when it was written.

## Decisions locked

**Order and scope**

- The order is upkeep, harness, several projects, large team (Q1).
- [ADR 0004](../adr/0004-no-runtime-dependencies.md) stays for everything Cortex ships. No agent
  framework, LangChain included, enters `core/`, `index/`, `mcp/` or `tools/` (Q4). The CI agent is
  maintainer tooling and ships to nobody.

**Upkeep**

- A release is cut automatically when a merge to master changes `VERSION` (Q7). The tag goes on the
  merge commit and the notes are that version's `CHANGELOG.md` section.
- The AI runs as a GitHub Action in this repository, triggered by a `docs-drift` or `site-drift`
  issue (Q2).
- It opens a pull request and does nothing else. It never merges and never releases (Q3).
- It signs in with a token from the maintainer's Claude subscription, stored as a repository
  secret, and runs once per issue (Q8).
- For docs drift it may change only the rules file, its tests and the changelog. For site drift it
  may change only the site repository. It never changes a workflow, settings, or anything under
  `.claude/`. Workflow permissions and a path check on the PR enforce this (Q17).

**Harness**

- The first PR of this part gives `evals/` a scoped brief and tests for its six untested modules
  (Q11).
- The first harness is one fixture repo, five tasks, two arms (bare, and after `/cortex`), three
  repeats each. It is run by hand on the maintainer's login, not in CI (Q9).
- A run counts as better when the task's tests pass and the rule written in the repo's brief was
  respected. Turns and tokens are reported second. More tokens for more passes is still a win (Q19).

**Several projects**

- A project is one markdown file in the team-brain's `projects/` folder: its repo URL, its links,
  and what it relates to. Adding or removing a project is adding or deleting that file (Q10, Q12).
- Links to outside resources such as Swagger and Jira are shown and never fetched (Q13).
- A relation the route map can prove is drawn as found. A relation someone wrote in a project file
  is drawn as declared. A project with neither stands alone (Q14).
- Project files that carry employer links live only in a team-brain on a `work` profile. They never
  enter this repository or a `home` vault, and docs and fixtures use generic placeholders (Q15).
- The page is a workspace mode of `/cortex-view`: one static HTML file, made on demand on the
  reader's machine from a clone of the team-brain (Q5, Q18).

**Large team**

- "Large" means the design holds from 2 to 50 developers (Q6).
- Memory becomes one file per author per day. Existing dated files stay readable, and every reader
  (recall, `/catch-me-up`, the view's timeline) reads both layouts (Q16).

**Record**

- This roadmap spec, a short spec per part, and three ADRs: releases are automatic, the agent opens
  pull requests only, a workspace is project files (Q20).

## Architecture

### Part 1 — upkeep

```
merge to master
   ├─ VERSION changed ──► release.yml ──► tag on the merge commit + GitHub release
   └─ always ───────────► site-drift.yml ──► `site-drift` issue ──┐
daily ───────────────────► claude-docs.yml ─► `docs-drift` issue ─┤
                                                                   ▼
                                                    drift-agent.yml (one run per issue)
                                                                   ▼
                                                    a pull request; a maintainer merges
```

- `release.yml` reads `VERSION`, skips when the tag exists, extracts the changelog section with a
  script that has its own tests, and fails when the section is empty or does not end at the next
  version heading. The 2.41.7 release failed for exactly that reason: its entry had swallowed the
  2.41.6 heading and the notes ran to the end of the file.
- `drift-agent.yml` starts only for an issue that carries the drift label **and** was opened by the
  workflow's own bot account. It gives the agent the report the issue holds and the ritual that
  already describes the repair (`/site-sync` for the site; the rule-authoring steps in
  `docs/changing-cortex.md` for a rule).
- Invariants this must not break: a new docs page still creates no rule until a maintainer has read
  it, which is what merging the PR is (ADR 0017). The plugin still ships no hooks and no mod
  ([ADR 0021](../adr/0021-cortex-ships-no-mod-and-keeps-the-claude-md-shim.md)). The site's `main`
  is still never pushed to directly.

### Part 2 — harness

- It lives in `evals/`, beside the skill evals, and reuses their runner's way of calling
  `claude -p` on the contributor's own login with local settings only.
- The fixture repo starts from the working-project repo `tools/cortex-site-demo.mjs` already
  builds. Each task names a prompt, a command that decides pass or fail, and the rule in the brief
  it must respect.
- The two arms differ in one thing: whether the context layer is in the repo. Everything else
  (model, prompt, permissions, the fixture's code) is the same.
- Its output is a table per task and arm: passes out of repeats, turns, tokens.

### Part 3 — several projects

- The registry is the team-brain's `projects/` folder. The file format is frontmatter (repo, links,
  related) and free prose, validated by the same frontmatter parser the skills use.
- The workspace page reads those files, runs the route map across the projects it can reach on
  disk, and draws found relations and declared ones with different marks.
- A single repo with no team-brain is a workspace of one, as the route-map spec already says.
- Invariants: the Vault door and the two server modes in `mcp/AGENTS.md`; the employer firewall
  ([ADR 0015](../adr/0015-a-profile-is-the-world-an-install-serves.md)); the view stays
  self-contained with no network and no runtime, and keeps its 7:1 contrast and 13px floor.

### Part 4 — large team

- This is an expand–contract change with no contract step. **Expand:** the writer adds the
  per-author layout and every reader learns both. **Migrate:** templates, briefs and rituals
  describe the new layout. Old files are never rewritten, because memory is append-only.
- Invariants: every write still passes the secret gate in `core/scrub.js`; a write still never
  creates `.cortex/` without the consent gate
  ([ADR 0005](../adr/0005-the-install-sequence-may-start-itself.md)); recall output stays
  deterministic.

## Risks & edges

- **An agent steered by issue text.** The repository is public, so anyone can open an issue or
  comment on one. The agent must act only on issues the workflow's bot opened, read only the issue
  body, and be unable to change workflows or secrets. A PR it opens is reviewed like a stranger's.
- **The subscription token.** Its runs count against the maintainer's own usage limits, and a
  token in CI can expire. A run that cannot sign in must fail the workflow visibly and leave the
  issue open, not close it.
- **A release nobody wanted.** A merge that stamps a version by mistake is released at once. The
  rollback is deleting the release and the tag; the workflow must not re-create a tag that was
  deleted on purpose in the same run.
- **Releases created by a workflow do not start other workflows** when they use the default token.
  Nothing downstream may depend on a release event.
- **Harness noise.** Agent runs vary. Three repeats may not separate the arms, and the first
  measurement may show nothing. That is a result, and it must be recorded as one.
- **Harness cost.** Thirty agent sessions per measurement on a personal login. It is run on
  request, never on a schedule.
- **Work links leaking.** A project file with a Jira board in it is employer material. The
  firewall has to refuse it in a `home` vault and in this repository, and no fixture may contain a
  real one.
- **Two memory layouts.** A reader that learns only the new layout silently loses every older
  entry. Each reader needs a test with both layouts present.
- **An author's name in a committed file.** Per-author files put a name in a path. In a team's own
  repository that is expected; what the name is derived from needs deciding (see below).

## Not yet specified

In scope, and not sharp enough to decide today. Each belongs to its part's own spec.

- **Whether a subscription token can drive the Action unattended**, and what its limits are. To be
  checked against Anthropic's documentation when part 1 is specified, not assumed.
- **How the release chain closes.** A release makes the site drift, the drift issue starts the
  agent, the agent opens a site PR. Whether `site-drift.yml` should also run when the site PR
  merges, so the issue closes without a manual dispatch.
- **The five harness tasks**, which model runs them, and how "the rule in the brief was respected"
  is checked by a command.
- **What the first measurement must show** for the harness to be worth extending, and what happens
  to Cortex's claims if it shows no difference.
- **The project file's exact fields**, and what the page looks like past roughly twenty projects.
- **How a project is removed** when other projects still declare a relation to it.
- **What names an author** in a memory path: the git user name, the email's local part, or a slug
  the developer chooses; and how recall presents entries from many authors.
- **Whether existing team repos need a migration step** or simply start writing the new layout.

## Out of scope

- A hosted portal or any server for the workspace page.
- Reading Jira, a remote Swagger URL, or any other network resource from the index or the view.
- An agent that merges, releases, or changes workflows and settings.
- Any agent framework as a dependency of what Cortex ships.
- Running the harness in CI or on a schedule.
- Rewriting or pruning existing memory files.
- A mod of any kind, and any hook shipped in the plugin.

## Owed before part 1

Two pieces of work were approved on 2026-10-04 and are not part of this roadmap's four parts. The
plan puts them first.

- The skill authoring page as a rule source, and the platform docs index watched for the agent
  skills, prompt engineering and evaluation sections only. The use-case guides are left out.
- A site sync: the site is at 2.41.15 and master is at 2.41.18.
