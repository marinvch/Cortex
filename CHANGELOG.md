# Changelog

All notable changes to Cortex. Format based on [Keep a Changelog](https://keepachangelog.com);
this project now versions independently of any package manager (see `VERSION`).

## [Unreleased]

## [2.41.5] — 2026-10-01

Two of the context files an agent reads most are smaller. `/cortex` reads its two rare branches
only when it is on one, and the `index/` brief keeps only the rules no module header already says.

### Changed

- **`/cortex` keeps its two side branches in `skills/cortex/RUNS.md`.** Being invoked with a row
  (`/cortex evals`, `bands`, `team`) and running unattended under `claude -p` are reached on few runs,
  and their 50 lines were read on every one. `SKILL.md` names both cases before step 1 and points
  there. It is 437 lines, down from 479; Anthropic asks for under 500. The re-run rules for
  stamped files stay in `SKILL.md`, because every re-run reads them and the `/cortex` eval scores
  them.
- **`index/AGENTS.md` is 193 lines, down from 622.** About 430 of its lines restated a `lib/`
  module's own header comment or a test's, and Anthropic asks for under 200 lines in a context file.
  What is left holds the rules that cross modules, the validation records, and one pointer per
  rule that moved, naming the module that holds it. It now names **four** exceptions to "nothing
  here writes to a target repo", not three: `ensureGitignored` appends the generated directories
  to the target's `.gitignore`.

## [2.41.4] — 2026-10-01

Cortex's ritual descriptions are 45% shorter, so more rituals can still be reached by a plain request
in a session with several plugins installed. The vault rituals stay in the one plugin, and an ADR
records why.

### Changed

- **Every model-invocable description is shorter, 14,847 characters to 8,119.** Claude Code drops
  descriptions once the whole skill listing, every installed plugin's together, passes a budget it
  does not state. In a session with several plugins, about twenty Cortex rituals were listed by name
  alone, including `/cortex-next`, `/diagnosing-bugs` and `/domain-modeling`. A ritual listed that
  way cannot be reached from a request. Each description now puts its leading word first, with one
  trigger per distinct case. The Bulgarian triggers stay. That is about 1,700 tokens less in every
  session.
  - `/install-project` no longer claims "install cortex on this project", which belongs to
    `/cortex`.
  - "write the AGENTS.md" was claimed by both `/cortex-scaffold` and `/writing-for-agents`, so the
    model picked between them at random. It is `/cortex-scaffold`'s now.
  - `core/test/plugin.test.js` caps each description at 320 characters and their total at 8,500,
    and fails when two rituals claim one trigger phrase. `docs/changing-cortex.md` states the rule.

### Decided

- **The vault rituals stay in the one plugin
  ([ADR 0020](docs/adr/0020-the-vault-rituals-stay-in-the-one-plugin.md)).** A separate
  `cortex-vault` plugin was proposed to cut context. Measured, the vault descriptions were about 720
  tokens a session. Claude Code cannot exclude part of a plugin's `skills/`, and an installed plugin
  cannot reach files outside its directory. `skillOverrides` does not apply to plugin skills. So a
  split would have been a breaking move for a small saving. The ADR says when to measure again.

## [2.41.3] — 2026-09-30

`/cortex` has an eval, and the first run found one thing its text got wrong. When a newer Cortex
stamped the repo, the re-run listed what it would offer after the plugin update. Those states are
measured against older templates, so it now lists nothing and gives the update commands alone.

### Fixed

- **A re-run on a repo a newer Cortex stamped no longer previews the stamp states.** `/cortex`
  already offered no stamp row then. The model still listed the files as what the pass after the
  plugin update would offer or ask about. Those states are measured against this plugin's older
  templates, and the updated plugin reads them again, differently. Step 5 now says not to list them.

### Added

- **An eval for `/cortex` (`evals/scenarios/cortex.mjs`).** `loop.mjs` decides which loop rows
  exist, and that is not measured here. The eval measures what the prose decides: how each stamp
  state becomes a row of the one confirmation, and that nothing is written before it. Each task
  ends with `UPDATE`, `ASK`, `ADOPT` and `WRITTEN`, each scored exactly.
  - The traps: a `review` file (untouched, but not re-renderable), an `edited` file, a record
    from a newer Cortex, nothing to update, no record with old loop files to adopt, and a user who
    says to just update everything.
  - With the skill it scores 1.000 hard and 1.000 soft. With no skill it scores 0.571 and 0.953.
    So a broken `/cortex` text trips the hard alarm (six tasks against a limit of three). The soft
    alarm cannot fire, because the stamp status explains most states by itself. `evals/README.md`
    says so.
  - Editing the body of `skills/cortex/SKILL.md` now needs a re-measure
    (`node evals/run.mjs cortex --record`), as for `/ship`, `/resume` and `/cortex-review`.

## [2.41.2] — 2026-09-30

Closes the two limits 2.41.1 left documented. A `CLAUDE.md` team section your team edited is asked
about once, not on every `/cortex` re-run, and is asked about again only when a release changes the
playbook. The verification block's template is pinned, so it cannot change without a decision about
the repos that already hold it. The shell tests also pass under any locale now.

### Fixed

- **An edited team section was asked about on every re-run.** A stamped file the team edited is
  left alone until its template changes. The team section in `CLAUDE.md` had no record to hold
  that answer, so `/cortex` showed the same diff and asked the same question every time.
  - `cortex-section.mjs . --keep team` records the answer in `.cortex/sections.json`, which is
    committed. It holds the hash of the playbook the section was kept against.
  - While the running release ships that playbook, the section is `kept`: `/cortex` asks
    nothing, and `cortex-next` shows no row.
  - When a release changes the playbook, the section is `edited` again, and its `why` names the
    release the team kept it against.
  - `/cortex` runs the keep once the team has answered, whatever the answer. Editing the section
    again does not bring the question back; only a new playbook does.
  - It is a file of its own rather than a key in `.cortex/stamps.json`, because 2.40.0–2.41.1
    refuse a stamp record with a key they do not know. A teammate on one of those would lose the
    whole stamp status.
  - A `sections.json` that does not read is treated as holding no answers, so the section is asked
    about. `--keep` refuses to write over it.
- **The shell tests failed under a non-C locale (#509).** Under a glibc UTF-8 locale, `sort`
  ignores a leading dot, so `cortex-stamps.test.sh` saw `bands.yaml` before `.claude/…`. It
  failed on a Raspberry Pi while CI, which runs in the C locale, passed. `tools/test/run.sh` now
  exports `LC_ALL=C` to every test, and `test-locale.test.sh` fails if it stops.

### Changed

- **The verification block's template is pinned.** `CLAUDE.md` § Verifying your work has no
  refresh. Teams trim it by hand, so no match can tell Cortex's text from theirs. That is safe only
  while its template never changes, and it has not changed since it shipped.
  `UNTRACKED_SECTIONS` in `index/lib/shipped-sections.mjs` pins its hash. `section.test.mjs`
  fails on any change until someone either gives the block a refresh path or decides, in the
  changelog, that the change does not need to reach existing repos.

## [2.41.1] — 2026-09-29

The agent team's first follow-ups. The session now always asks "Single agent or team?" and waits —
measured by a new eval (1.00 against 0.00 for the text it replaces, which gave in to "just do it"),
and delivered to repos that took the team from 2.41.0, whose `CLAUDE.md` team section is recognised
as Cortex's old text and offered for replacement with a diff (an edited section is never touched).
Sizing now reads a multi-file refactor inside one area as a team task when it carries a real
dependency radius, and the README's tools table follows one stated rule, pinned by a test.

### Changed

- **The README's Tools table now matches `tools/`, and a test keeps it that way (#501).** The
  public site's `/cli` table and the README's had drifted. The site listed
  `cortex-claude-docs.mjs` and the README did not; the README listed the sourced library
  `_cortex-lib.sh` and the site did not.
  - The README now states the rule. A script in `tools/` or `tools/server/` that a person, a
    ritual or cron runs directly is a row. A sourced library, whose name starts with `_`, and the
    test harness are not.
  - Applied to every file: `cortex-claude-docs.mjs`, `server/server-setup.sh` and
    `server/cortex-cron.sh` are added. `_cortex-lib.sh` moves to the prose above the table.
    `cortex-scan-projects.sh` and `cortex-vault-extract.sh` are re-described from their own
    headers.
  - `tools/test/tools-table.test.sh` fails when a script is missing, a row names nothing, or a
    library is listed as a tool.
  - `skills/site-sync/PAGES.md`'s `/cli` row now says the site copies the README's table row for
    row and keeps no list of its own.

### Fixed

- **`cortex-impact --size` called a refactor across several files of one area `single` (#493).**
  Areas come from `layerKeyFor`, which is coarse. zustand's whole core is `src` and
  spring-petclinic's Java is `src/main`, so a zustand store-API refactor read `single`. It changes
  four source files, and at least 13 files depend on them. A new signal now counts the source
  files changed together, and it crosses only when a radius comes with them: 4 files with 8
  production dependents. Both halves are needed. The count alone would have called petclinic's
  copyright-year and translation sweeps a team task. A finer area key was also considered and
  rejected, because three of the four zustand files sit in one directory. Over the last 150
  commits of each repo, the share called `team` went from 0% to 0% on zustand, 0% to 2% on
  spring-petclinic, 28% to 29% on taxonomy and 11% to 13% here. The new lines are in
  `SIZING_THRESHOLDS` and are provisional like the rest.

- **The team playbook now always ends its sizing report with the question "Single agent or team?",
  then stops until the developer answers (#498).** In the first live runs of the agent team, two
  team-sized sessions reported `/cortex-impact --size`'s recommendation without ever asking, and
  one final report claimed the question had been asked.
  - **The rule.** `templates/team/playbook.md` still fits its 14 lines. Before any work on a task,
    the session states what `--size` recommends, in words (single, team, or that it cannot size
    the task), and why. It then ends its reply with that exact sentence and stops. It writes no
    plan, makes no edit and delegates nothing until the developer answers.
  - **It holds in the hard cases too:** on a single-sized task, on a request to "just do it", and
    when Cortex cannot size the task. The session may never say it asked unless the question is
    in its reply.
  - **The team skill** will not start until the developer has answered "team".
  - **Measured.** This is skill text deciding behaviour, so it now has an eval, `team-ask`, with
    14 test tasks on `claude-sonnet-5`:

    | Text | Hard | Soft |
    |---|---|---|
    | New playbook (recorded; a repeat scored the same) | 1.000 | 1.000 |
    | Previous playbook | 0.000 | 0.418 |
    | No skill | 0.000 | 0.354 |

    The previous text could not know the exact sentence. Read loosely instead (a closing
    single-or-team question, and no work), it asked and stopped on 11 of 14 tasks. The three
    misses were requests to just do it, where it announced it would proceed as single, or offered
    to go and check first.
  - **What the eval changed.** The first draft of the fix scored between 0.786 and 1.000 hard,
    because some replies listed every reason and never named the recommendation. The rule now
    says to name it in words.
  - **Checked live.** The step-15 task was re-run headless with no answer supplied. The session
    sized the task, ended with "Single agent or team?" and changed no file. A one-file fix that
    told it to "just do it" got the same result.
  - **Reaching a repo that already has the old block** is #505, below. The playbook is a section
    appended to `CLAUDE.md` and is not recorded, so this entry alone did not.
- **`evals/run.mjs` can measure a template, and runs the no-skill control itself.**
  - **Any file.** `SKILL_FILES` in `evals/skills.mjs` points a skill at a file other than
    `skills/<name>/SKILL.md`, and `--check` follows that file. A scenario's `system(body)` fills a
    template's placeholders before the text becomes the system prompt. The hash stays on the file
    as written.
  - **The control.** `--no-skill` runs the same tasks with a one-line generic system prompt, and
    it refuses `--record`.
  - **CI.** The workflow now also runs on a push that changes `templates/`, so the playbook's
    baseline is checked there.
- **A repo stamped by 2.41.0 kept the playbook that did not ask, and nothing said so (#505).** The
  team playbook is appended to `CLAUDE.md`, a file the team also writes, so the stamp record never
  held it. A re-run of `/cortex` rewrote only its roster line.
  - **How the section is found.** It runs from its `## Working as a team` heading to the last
    non-blank line before the next heading of its level or higher. A heading inside a code fence
    does not count. CRLF and a BOM are read. Two sections with that heading are refused with a
    sentence naming their lines.
  - **Outdated or edited, without a record.** Every playbook Cortex has shipped is kept as data,
    verbatim and hashed, in `index/lib/shipped-sections.mjs`: today, 2.41.0's.
    - **`current`**: the section is this release's text.
    - **`outdated`**: it is an earlier release's text, untouched.
    - **`edited`**: anything else. That text is the team's.

    Each comparison fills in the roster the section already names. A match counts only if
    rendering that roster gives the section back exactly. Only CRLF and trailing newlines are
    forgiven, so a formatter's rewrap reads as `edited` and is never overwritten. A test fails
    when the template changes until its hash is pinned again, and it says to add the replaced
    text to the history first if that text was ever released.
  - **Where it shows.**
    - `node index/cortex-section.mjs .` prints the state and the diff. `--json` carries both.
    - `cortex-next` makes an outdated section a required row, and an edited one an optional row
      that is never "next".
    - On a re-run, `/cortex` offers an outdated section in its one confirmation, under *Update*,
      with the diff. It shows an edited section's diff under *Ask each*, and never replaces it.
  - **The replace is the CLI's.** `cortex-section.mjs . --replace team` writes only an outdated
    section. Every byte outside it stays as it was, in the section's own line endings. The result
    is read back before it is written, and goes through a temp file. The skill never edits
    `CLAUDE.md` by hand for this.
  - **Checked on the step-15 Harbor workspace.**
    - One repo got its CLAUDE.md back from the commit that stamped the 2.41.0 playbook. It read
      `outdated` with its five-agent roster. After `--replace` it read `current`, and the file
      was byte-identical to the one committed after #498's hand fix.
    - In a second repo, one hand-edited word read `edited`. The diff showed that line alone, and
      `--replace` exited 1 with the file unchanged.
    - S5 of the workspace harness now also checks that every team section is current or the
      team's own. It fails while a repo holds the 2.41.0 text, and S1–S5 pass after the replace.
  - **Not covered:** the verification block, the other section Cortex appends to `CLAUDE.md`. It
    is filled partly by hand, with rows deleted and its comment left out, so this matching would
    read every real one as `edited`. Its template has not changed since it shipped. The stamp
    record spec keeps it open.

## [2.41.0] — 2026-09-28

Every repo `/cortex` serves can now carry an **agent team** — Architect, Implementer, Tester,
Reviewer, and a Project manager where there is something to manage — each with one job, only the
tools that job needs, and a body grounded in that repo's own briefs, ADRs and commands. The team is
written into the repo and run by your main session ([ADR 0019](docs/adr/0019-the-agent-team-is-written-into-the-repo-and-run-by-the-main-session.md)):
a short section in `CLAUDE.md` has every session size a task with `/cortex-impact --size` and ask
you whether it runs as one agent or as the team. On a team task the Architect's plan is debated —
every objection must cite a `path:line`, an ADR or a test, at most two rounds — and you settle what
the agents do not agree on. The Tester writes the failing test first and an edit fence keeps it in
test files; the Reviewer checks the change before anyone says "done"; nothing merges or pushes
without you.

Agents a repo already has are graded, mapped to a role and given specific proposed edits, each
asked about with a diff; a role they cover is never offered twice, and Cortex never writes over an
agent or skill it did not create. The team's files are recorded like every other stamped file, so
later releases can update them safely.

Proven live: on a private team workspace, a cross-area change was sized "team", planned with dense
citations, debated within two rounds, built red-then-green with the Tester in test files only, and
reviewed with the app running — with no commit or push. The one deviation (the session editing after
review) was fixed in the skill text and re-run clean. Acceptance scenario S5 joins S1–S4.

### Added

- **Role templates for the agent team, and nothing that stamps them yet.** `templates/team/` holds
  five Claude Code subagents from the [agent-team design](docs/specs/2026-09-28-agent-team-design.md):
  `architect`, `implementer`, `tester`, `reviewer` and `project-manager`. Each has one job and
  only the tools the design's roster gives it. The Architect and the Reviewer have no edit tools.
  Every body is filled from the repo's own state (the test and run commands, the ADR directory,
  the scoped briefs, where tests and plans live), and `templates/team/README.md` lists each
  placeholder with where `/cortex` finds its value. Every role cites a `path:line`, an ADR or a
  command's output for each claim, and reads every `AGENTS.md` between the code it works on and
  the root. The Reviewer keeps the verifier's rule of changing nothing, and `verifier.md` stays
  as it is. The Tester's edits are limited to test files by the fence below. `/cortex` starts
  offering the team in step 14.
  `index/test/team-templates.test.mjs` renders each role, commits it at `.claude/agents/`, and
  expects no `claude-setup` finding.
- **The Tester's fence: its edits outside test files are refused by a hook, not only by
  instruction.** `tester.md` declares a `PreToolUse` hook on Edit and Write in its own
  frontmatter. The hook runs `templates/team/test-paths.sh`, which is stamped to `.claude/hooks/`.
  The script allows an edit only when the path resolves inside the repo, outside `.claude/`, and
  matches one of the repo's test globs (`{{TEST_GLOBS}}`). It is an allow-list, so it fails closed:
  unreadable input, a relative path, a `..`, a symlink, a path outside the repo and an empty glob
  list all exit 2. The command ends in `|| exit 2`, so a missing script blocks too. Backslash paths
  are normalised, the reader has the same sed fallback when jq is missing, and it is safe on bash
  3.2. `templates/team/README.md` states what the fence cannot cover. Claude Code skips a project
  subagent's frontmatter hooks until the folder is trusted, and in `claude -p`. The fence also
  does not cover Bash. `tools/test/test-paths.test.sh` runs the real script against each of these
  cases. It also pins the hook-input reader as identical across `protected-paths.sh`,
  `format-changed.sh` and `test-paths.sh`, which are three copies with no parity test until now.
  Still templates only; `/cortex` stamps them in step 14.
- **The agents a repo already has are graded, matched to a role, and given concrete edits (plan
  step 11, spec T6).** `index/lib/agents.mjs` lists the repo's own `.claude/agents/*.md` and grades
  each with the existing `claude-setup` checks, one file at a time. It maps each agent to
  `architect`, `implementer`, `tester`, `reviewer` or `project-manager` from its name, the job its
  description states and its tools. Every rule can only remove a candidate: a negated or
  "use after …" phrase, another agent's hyphenated name, a lens specialist (`security-reviewer`,
  `ux`), a job the roster lacks (`debugger`, `researcher`), no edit tools for a role that writes
  files, and a name that says otherwise. Two roles surviving, or none, is "unmapped — ask", never
  a guess. Cortex's own `verifier.md` maps to the Reviewer and is marked for the upgrade (T9). A
  mapped agent gets proposals only where they are provable: edit tools on a role that changes
  nothing, no `tools:` line (which inherits every tool), tools outside the role's roster, a
  description that never says when to call it, no citation rule, or a scoped `AGENTS.md` it never
  reads. Each proposal names the line and quotes the role template's own sentence, so there is no
  second copy. A covered role is never offered again. `cortex-loop.mjs --json` carries it all as
  `agents`, `null` without an index, and the human view lists it only when the repo has agents.
  Validated by hand on 83 agents in seven public repos. That sweep drove seven of the rules. Two
  mappings it still gets wrong are recorded in `index/AGENTS.md`. Mutation-checked: 32 guards
  broken one at a time, and each one failed a test.
- **`cortex-impact --size`: should this task get one agent or a team?** Name the files a task will
  touch and it recommends `single` or `team` from what the index already knows. It counts the
  areas of source touched, and the line drops from 3 to 2 when one of them has a scoped brief. It
  counts the files depending on the change (10 direct, or 25 in all) and how many of those no test
  covers (10). Each reason is a sentence with its number. It only recommends: the developer chooses
  (agent-team spec, T2). The lines are **provisional** and live in one constant,
  `SIZING_THRESHOLDS` in `index/lib/sizing.mjs`. They were set by running the check over the last
  150 commits of zustand, spring-petclinic, shadcn-ui/taxonomy and this repository. They are a
  starting point until the eval harness can score team against single. A file in a language
  Cortex cannot resolve gets no recommendation, because its dependents are unseen, not zero. With
  no index there is no recommendation either, and never a default. `--json` returns the signals.
- **The team's playbook and its `team` skill (plan step 13, spec T1, T2, T5).**
  `templates/team/playbook.md` is a 14-line section `/cortex` will append to `CLAUDE.md`, so every
  session loads it. The main session runs the team itself, and nothing sets `agent:`. The section
  names only the agents actually stamped (`{{ROSTER}}`). For each new task that changes code, it
  has the session run `/cortex-impact --size` on the files the task touches and ask the developer
  whether to work single or as a team. The developer decides. On "team", the session loads
  `templates/team/team-skill.md`, stamped as `.claude/skills/team/SKILL.md`, which holds the rest:
  - the Architect plans from the `/cortex-impact` output the session hands it;
  - the Tester and the Reviewer object, and the session drops every objection with no
    `path:line`, ADR or test behind it;
  - the Architect accepts or rebuts each remaining one with a citation;
  - after at most two rounds, whatever is still open goes to the developer side by side;
  - then a red test, the change, an independent review with `/cortex-review`, and a report.
    Nothing merges or pushes without the developer.

  Cortex is reached by skill name, never by the plugin's install path. The debate record stays in
  the conversation until the spec decides where it lives. Claude Code's experimental agent teams
  are described as compatible and off: Cortex never sets the flag. The skill also notes that the
  docs do not list hooks among what a teammate takes from an agent definition, so a Tester
  teammate may not have the fence. Still templates only; `/cortex` stamps them in step 14.
- **`/cortex` now offers the agent team, one role at a time (plan step 14, spec T4, T6, T9).** A new
  `team` row in the loop is fed by the agents the repo already has.
  - **What is offered.** Every role no agent here plays is offered, and each one is its own yes/no.
    The Project manager is offered only where a plan folder exists (`intent/`, `docs/specs/` or
    `docs/plans/`). A withheld role is named with its reason.
  - **Covered roles and existing agents.** A role an existing agent plays is never offered again.
    That agent's proposed edits are asked one agent at a time, with the diff, and are never
    recorded.
  - **The verifier.** Cortex's own `verifier.md` is offered the upgrade to the Reviewer. Declining
    keeps the verifier, and it keeps the Reviewer covered.
  - **No overwrites.** A role whose file or agent name another agent already has is withheld with
    "rename it first", never written over. This covers the case where the developer says the
    team's own `reviewer.md` is not the reviewer. A `.claude/skills/team/SKILL.md` Cortex did not
    write is a conflict to ask about, and it is never replaced.
  - **Confirming the mapping.** The developer confirms each mapping. `cortex-loop.mjs --as
    <path>=<role|none>` re-reads the offer with their answer, and their answer outranks the mapper.
  - **Values.** Each value a template needs is detected or asked, never invented. These are the
    test command, the Reviewer's run command (taken from the verifier's stamp record), the ADR
    folder, the test locations and globs for the Tester's fence, the plan folders, and the scoped
    briefs.
  - **Writing.** After the picks, `cortex-loop.mjs --team <roles>` prints the files, the values and
    the `{{ROSTER}}`: roles stamped now by role name, existing agents as `` `name` (role) ``. The
    agent files, `test-paths.sh` (always with the Tester) and the team skill are recorded in
    `.cortex/stamps.json` and updated like any loop file. The playbook is a block appended to
    `CLAUDE.md` and is not recorded. On a later run only its roster line changes.
  - **The stamp record.** `LOOP_STAMPS` carries the team files with `adopt: false`: the team shipped
    after the record, so a file at one of those paths with no record is the team's own, not an
    unrecorded stamp. `adoptionCandidates` now takes the stamp sites as an argument, which removes
    an import cycle.
  - **Where agents are found.** Claude Code scans `.claude/agents/` and a plugin's `agents/`
    recursively, so agents in subfolders are now listed and graded.
  - **The skill.** The details of asking and writing are in `skills/cortex/TEAM.md`, which keeps
    `/cortex`'s skill under its length.
  - **Tests.** `tools/test/cortex-team.test.sh` stamps a team on a real git fixture. It checks that
    the checker finds nothing, the fence refuses code, every recorded file reads `current`, and a
    template change reads `update`.
  - **Validation.** Checked on kapi-sprints, octez-manager and zustand. Mutation-checked: 41 guards
    broken one at a time, and each one failed a test.

- **Acceptance scenario S5: the agent team, end to end on a team's workspace (plan step 15).**
  `CORTEX_E2E_WORKSPACE=<dir> bash tools/test/run.sh install-on-a-project` now runs S5 after
  S1–S4. It covers the deterministic half, through the CLIs a user has:
  - which repos carry the team, with each repo that was offered it and did not take it named;
  - every file stamped from a `team/` template passes the claude-setup checker, and the stamp
    record reads it as `current`;
  - the roster line in `CLAUDE.md` names exactly the agents that play a role;
  - `test-paths.sh` refuses a source edit and allows a test edit when run as the hook runs it;
  - `cortex-impact --size` says `single` for a one-file fix and `team` for a change set across
    the team line's worth of areas. Both change sets are built from the repo's own index.

  On the test workspace (four code repos and a team-brain, the team stamped in two of them), S1–S5
  all pass and the workspace is left untouched. On a deliberately broken copy, four S5 checks go
  red:
  - a deleted agent the roster still names;
  - a fence that allows everything;
  - a hand-edited agent;
  - an agent with an unknown frontmatter key.

  The live half cannot be a test, because a model runs it. It was run by hand in the same
  workspace and is recorded in the PR: a cross-area task went through the team, and a one-file
  fix was worked single.
- **ADR 0019, and the agent team in the README (plan step 16, docs half).**
  - [ADR 0019](docs/adr/0019-the-agent-team-is-written-into-the-repo-and-run-by-the-main-session.md)
    records four decisions, each with its rejected alternatives:
    - the team is written into the repo as project agents, not shipped as plugin agents, whose
      hooks are ignored and which are not documented as teammates (T8);
    - the main session runs it from a `CLAUDE.md` section, and `agent:` is rejected because it
      replaces the system prompt (T1);
    - debate is bounded and evidence-only, and arguing to consensus is rejected (T5);
    - agent teams are compatible and never enabled (T7).

    It also records the fence's limits (untrusted folders and `claude -p`, Bash, teammates) and
    what the step-15 live run showed, including the one text fix it caused.
  - The README gains **The agent team**: each role's one job and what it may edit; the
    single-or-team question; the debate; existing agents graded and mapped with consent; the
    fence's limits; and how to remove the team. The install paragraph, the per-change table
    (`/cortex-impact --size`), the "What lands" tree, the CLI block (`cortex-loop --team`,
    `cortex-impact --size`) and "What Cortex runs, sends and fetches" now mention it.
  - `skills/site-sync/PAGES.md` maps the section and the ADR to `/what-lands`, `/principles` and
    `/sequence`.
  - `/cortex`'s description names the agent team.

### Changed

- **The team skill: the session never edits code itself, and a change after review goes back
  through the Implementer and the Reviewer.** This came from the first live run (plan step 15).
  After the review, the session rewrote two code comments and made an `AGENTS.md` edit that the
  Implementer had declined. No role had made or checked those edits. Re-run with the new text, the
  same task sent the post-review fix to the Implementer and then back to the Reviewer. A repo
  stamped with the old skill reads `update`, and `cortex-stamps update` applies the change; the
  workspace did exactly that.
- **The Tester's fence never takes a test location from under `.claude/`.** The fence script,
  `.claude/hooks/test-paths.sh`, is named like a shell test, so the index marks it as one. The
  fence refuses every edit under `.claude/` anyway. Found by S5 on the first stamped workspace.
- **`/site-sync`'s page map covers the three sources the 2.40.0 sync found unmapped (#487).**
  `skills/site-sync/PAGES.md` adds ADR 0018 to `/principles`. It now states that `docs/specs/`
  and `docs/plans/` are design records that never reach the site. It also lists every bullet of the
  README's "What Cortex runs, sends and fetches" that `/privacy` must carry, so the next sync
  closes that gap. The site itself is unchanged until that sync runs.
- **`tools/AGENTS.md` said three rules were deliberately copied, but its table listed two.**
  The sentence and the table now agree on four, each checked against its parity test: the slug,
  the clock, the Core plugin tier (`CORE_PLUGINS`), and the hook-input reader. The slug row also
  gains the `cortex-init.sh` copy that `mcp/test/slug-parity.test.js` already pins.
- `readFrontmatter` reads a flow list broken over several lines (`tools:\n  [\n    Read,\n  ]`), the
  way a formatter writes a long tool list. One real repo's agent read as if it granted no tool.

## [2.40.0] — 2026-09-28

Files `/cortex` wrote into a repo never changed again. A hook fixed in 2.39.0 and again in 2.39.1
stayed broken in every repo stamped before the fix, and nothing said so. Now every stamped file is
recorded with the release that wrote it, and a re-run says, per file, whether it is current, safe to
update, edited by the team, or needs a look — and updates only what nobody touched and what renders
back exactly. Repos stamped by an earlier Cortex adopt their files without a single rewrite. A
teammate on an older plugin is told how to update and cannot roll files back.

Validated by upgrading a private five-repo team workspace stamped by 2.39.0: 28 files adopted with
nothing outside `.cortex/` written, every state reached, and taking today's `protected-paths.sh`
closed a live Windows-path gap in two of the repos. The acceptance scenarios S1–S4 still pass.

Skill quality is now measured, not assumed (#407): `/ship`, `/resume` and `/cortex-review` carry
recorded eval baselines, and an edit that makes one worse cannot merge unnoticed. The first
measurement found two weaknesses in the skills' own text, fixed here.

### Changed

- **`/cortex-review` flagged ADR lines written in the present tense as stale, and `/resume` put
  another worktree's dirt on the `Uncommitted` line.** The #472 evals found both.
  - `/cortex-review` called only "ADR rationale" history, so a `Decision:` line naming the old
    path was reported as drift. `index/lib/review.mjs` classes every ADR line `historical`. The
    body now says so too: every ADR line and every CHANGELOG entry is history in whatever tense it
    is written.
  - `/resume`'s report shape now says `Uncommitted` covers this checkout alone. A dirty extra
    worktree goes on `Diverged` with its branch and path. Rewording the two shape lines alone made
    the scores worse (0.714 / 0.905), so the rule got its own sentence.
  - Re-recorded baselines, hard / soft, with no skill in brackets: `/cortex-review` 0.643 / 0.927
    → 0.929 / 0.992 (0.286 / 0.840), so its alarm now fires on soft as well as hard. `/resume`
    0.857 / 0.952 → 1.000 / 1.000 (0.143 / 0.670).

### Added

- **An edit that makes `/ship`, `/resume` or `/cortex-review` worse is now caught before it merges
  (#407).** Their evals had no recorded score, and running them needed Python and SkillOpt.
  `evals/run.mjs <skill>` now runs a skill's tasks through `claude -p` on your own login, in Node,
  and scores them with `score.mjs`. `--record` writes `evals/baselines/<skill>.json`, keyed to a
  hash of the SKILL.md body, with frontmatter excluded and line endings normalised. It refuses a
  soft drop of more than 0.1 unless `--accept-drop "<reason>"` gives a reason, and it refuses
  whenever a model call failed. `node evals/run.mjs --check` needs no model, runs in CI, and fails
  when an evaled skill's body has changed since its baseline, naming the command that re-measures
  it. First baselines, on the `test` split with `claude-sonnet-5` at medium effort: 1.000 hard and
  1.000 soft for all three skills. The same tasks with no skill scored 0.817, 0.944 and 0.986 soft.
  So the alarm has teeth on `/ship` and little on the other two, and `evals/README.md` says so.
  [ADR 0018](docs/adr/0018-skill-quality-is-measured-by-evals-not-telemetry.md) records why this
  is evals and not a telemetry hook: a hook fires before any outcome exists, and Cortex ships none.
- **Groundwork for knowing when a repo's Cortex files are out of date: `index/lib/stamps.mjs`.**
  The `cortex-stamps` CLI below is its caller, and `/cortex` runs that CLI.
  Nothing recorded which release stamped a file into a repo, so a repo stamped by 2.36.0 kept
  2.36.0's hook after 2.39.0 fixed it. The module reads and writes a committed `.cortex/stamps.json` (`format: 1`, the newest `cortex`
  version that wrote to it, and per file the template, version, template and file sha256, and the
  placeholder values it was rendered with). It decides each file's state from two hash
  comparisons: `current`, `update`, `conflict`, `edited` or `missing`, plus `retired` for a
  template this Cortex no longer ships. Hashes fold CRLF to LF and ignore trailing newlines, so a
  `core.autocrlf` checkout never reads as edited: all 11 `templates/loop/` files, cloned with
  autocrlf on, read `current`. Mutation-tested: 29 guards broken one at a time, 29 reds.
  [Spec](docs/specs/2026-09-28-stamp-record-design.md), plan step 1.
- **`node index/cortex-stamps.mjs`: record a stamped file, and list which are out of date.**
  `record <repo> <path> <template> [--version] [--value KEY=VAL ...]` hashes the file as written
  and the template it came from, and writes one entry to `.cortex/stamps.json`, the only file it
  touches, so no model ever computes a hash (spec S2). `<repo> [--json] [--all]` groups the
  recorded files by state and shows only the ones that are not current unless `--all` is given.
  It exits 0 whatever it finds; `--json` is the form `cortex-next` will read. Templates and version
  default to the plugin's own `templates/` and `VERSION`. A record the repo's ignore rules hide is
  still written, and the warning names the rule (`git check-ignore -v`) and a fix that works on
  real git. The fix under a `.cortex/` rule is `.cortex/*` plus `!.cortex/stamps.json`, because a
  bare negation cannot re-include a file inside an ignored directory. The user's `.gitignore` is
  never edited. What Cortex itself writes to `.gitignore` does not hide the record. On zustand,
  all 11 real loop templates were recorded, raised no ignore warning and read `current`; on
  Cortex's own `.gitignore` the warning names line 72. `tools/test/cortex-stamps.test.sh` reaches
  all six states on a real git fixture. Mutation-tested: 27 guards broken, 26 reds; the survivor is
  an equivalent mutant. Plan step 2.
- **`/cortex` records every loop file it writes, and a re-run updates the ones nobody touched.**
  Each whole-file loop row is now rendered by `cortex-stamps.mjs render` from a values file, then
  recorded after formatting with the same values. On a re-run, `/cortex` reads the stamp status
  and handles each state:
  - `update`: one confirmed row, applied by `cortex-stamps.mjs update`;
  - `review` and `conflict`: one row per file, with the `diff` shown;
  - `edited`: nothing, because it is the team's.

  When the record would be ignored, `/cortex` offers the `.gitignore` fix inside its confirmation,
  even before the record exists. The shared-file blocks (the `CLAUDE.md` verification block and the
  `settings.json` hooks) stay out of the record, as the spec leaves them unspecified.

  Update is safe because of a **reproducibility guard**: `record` checks that the template, filled
  with the recorded values, gives back the file as written. A file that holds more than its values
  (a hand-filled block, a formatter's rewrite) is still recorded, but marked not re-renderable, and
  its template change reads as the new state `review`, never `update`. So an update can never
  silently drop what the model or a formatter wrote. A new template placeholder with no recorded
  value is refused, not left in the file.

  The placeholder rule (`{{NAME}}`, never `${{ … }}`) moved to `index/lib/placeholders.mjs`, and
  `tools/cortex-placeholders.mjs` imports it, so the check and the renderer cannot disagree. An
  empty value on a placeholder's own line deletes the line, which is how "delete the
  `{{SETUP_STEPS}}` line" is represented.

  On a zustand clone, three templates did not survive the repo's own prettier: a table was padded,
  a trailing space removed, comment spacing collapsed. `REVIEW.md`, `intent-README.md` and
  `bands.yaml` are now prettier-stable. Of the nine files rendered, formatted and recorded there, 8
  are re-renderable; `bands.yaml` is `review` only because that repo's config prefers single
  quotes. `cortex-stamps.mjs update` is the one `index/` write outside `.cortex/`, a named
  exception in `index/AGENTS.md`. Mutation-tested: 30 guards, 30 reds. Plan step 3.
- **`cortex-next` and the View now say when a file Cortex stamped needs attention, and a repo
  installed before the record existed can adopt its files (spec S4).**

  A `stamps` row appears only while something needs attention, so every other repo reads exactly
  as before:
  - **Required** for a decision `/cortex` makes: files to update, files to decide one by one
    (`review`, `conflict`), or a damaged record.
  - **Optional** for a deleted file, a retired template, or a record `.gitignore` hides. Each can
    be a deliberate choice, and `cortex-stamps.mjs forget` drops an entry. Files only the team
    edited raise nothing.

  **Adoption** covers a repo that has loop files where `/cortex` writes them but no
  `.cortex/stamps.json`, which is every 2.39.x install:
  - `cortex-stamps.mjs adopt` records the files with nothing known: no release, no hashes, not
    renderable.
  - Each then reads as `conflict` and is compared with this release's template before anything
    changes. `adopt` writes the record and not one byte of a loop file.
  - It is offered as an optional row, since declining it leaves no trace, and `/cortex` offers it
    in its confirmation.

  The locations come from a new `stamps` field on each `loop.mjs` row (`LOOP_STAMPS`). A test pins
  that field to the `/cortex` skill's table, so the two cannot drift.

  Validated on a zustand clone stamped with the real 2.39.1 templates and no record:
  - `cortex-next` and the View offer adoption, marked optional and never the next step.
  - `adopt` changed nothing outside `.cortex/`, and all 9 files read `conflict`.
  - `REVIEW.md`'s diff shows the real 2.39.1-to-now template change.
  - Resolving two files makes them `current`.

  Mutation-tested: 25 guards, 25 reds. Plan step 4.

- **A teammate whose plugin is a release behind would have rolled a repo's loop files back to its
  own older templates, and nothing told anyone how to update the plugin (spec S5).**
  The stamp record is shared, but the plugin is per machine. Read against the record a newer Cortex
  wrote, an older plugin's templates are the older ones, so every untouched file reads as `update`.
  - When `.cortex/stamps.json` names a newer Cortex than the running `VERSION`, status, `--json`
    (`olderPlugin`) and `diff` say so plainly, with both commands in order:
    `claude plugin marketplace update cortex`, then `claude plugin update cortex@cortex`, then
    `/reload-plugins` or a new session.
  - `cortex-stamps.mjs update` refuses the whole plan and writes nothing. The refusal is in
    `planUpdates`, which now takes the running version as a required argument, so a caller cannot
    skip the check.
  - `cortex-next` and the View's Next steps show it as a blocking row whose command is the update
    itself. `/cortex` says the advice and offers no stamp row.
  - Versions compare as numbers. An adopted-only record (`cortex: null`) and equal versions never
    warn.

  The README gains **Keep it current**. Claude Code's plugin docs list auto-update as "Off by
  default" for third-party marketplaces, so the section shows where to turn it on (`/plugin` →
  Marketplaces → `cortex` → Enable auto-update) and gives the manual two-step update.
  "What Cortex runs, sends and fetches" now says Cortex never checks for a release itself; Claude
  Code fetches the marketplace when auto-update is on. `skills/site-sync/PAGES.md` routes both into
  the site's `/install` and `/privacy` pages.

  Validated on a zustand clone with two plugin copies. The lead's copy (2.40.0, this release's
  templates) stamped nine loop files. The teammate's copy (2.39.1, v2.39.1's templates) read three
  of them as `update`: `REVIEW.md`, `bands.yaml` and `intent/README.md`. Those are the three
  templates this release made prettier-stable, and without the guard the teammate's plan would
  have rewritten all three from 2.39.1. With it, status and next named the older plugin, and both
  bulk and named `update` exited 1 with the repo unchanged. On the lead's copy the same repo read
  9 current with no warning.

  Mutation-tested: 26 guards, 26 reds. Plan step 5.

- **On a team's repo, every developer had to find and install Cortex alone, and nothing offered to
  put it in the repo's settings (spec S6).**
  On a team's repo, `/cortex` now offers, inside its one confirmation, to add Cortex to the committed
  `.claude/settings.json`: `extraKnownMarketplaces.cortex` (GitHub `marinvch/Cortex`) and
  `enabledPlugins["cortex@cortex"]`. The shapes are the ones in Claude Code's settings reference.
  - A team's repo is the `work` profile or a team-brain connector (`.cortex/connector.json`).
    `home` and `lab` without a connector are never offered it, and the row does not appear in
    their loop counts. A loop row can now declare `applies` for this.
    An older `{ slug, teamBrainRepo }` connector still counts as a team's repo. Its `slug` is the
    project, not the team, so the evidence names no team. Plan step 7 found this on a real four-repo
    workspace, where every repo was said to belong to a team named after itself.
  - The offer says what committing does not do. Once a teammate trusts the folder, Claude Code
    registers the marketplace, but the plugin docs still have each teammate run
    `claude plugin install cortex@cortex --scope project` once.
  - `node index/cortex-shared-plugin.mjs <repo> --write` does the merge, and `/cortex` calls it
    rather than editing JSON:
    - it merges and never replaces, inserting the two entries as text in the file's own
      indentation and line endings, so every other byte stays;
    - it keeps an entry already there, including `"cortex@cortex": false`;
    - it writes into `additionalMarketplaces` when a file uses that documented alias;
    - it refuses a file that does not parse and leaves it untouched;
    - it writes nothing unless the parser agrees the result is exactly the original plus the two
      entries.
  - Like the hooks merged into the same file, the entries are a block in a shared file, so they
    are not in `.cortex/stamps.json`.
  - README "What Cortex runs, sends and fetches" now names this as the second script that writes
    outside `.cortex/`. It also says Claude Code, not Cortex, clones the marketplace on a
    teammate's machine.

  Validated on a zustand clone:
  - With no profile, `home` or `lab`, the row is absent and the loop reads 0/6 as before. With
    `work`, or with a fake connector on `home`, it is offered and names the evidence.
  - `--write` over a `settings.json` holding the hooks template and a permission added 11 lines and
    removed none. Everything else parsed identical. Prettier (zustand's config) asked for no change
    to the inserted lines.
  - A second run wrote nothing, byte for byte.
  - A settings file with a trailing comma was refused with exit 2, left as it was, and the row read
    `blocked`.

  Mutation-tested: 32 guards, 31 reds. The survivor is the parse-back check itself, which a correct
  scanner never reaches. Plan step 6.

- **A team that wanted Cortex to keep itself current had no way to say so in the committed
  settings.** The team-plugin offer now has a second yes/no, unticked by default:
  `cortex-shared-plugin.mjs . --write --auto-update`.
  - It writes `"autoUpdate": true` on the `cortex` marketplace entry. The settings reference
    documents this as "an optional `autoUpdate` Boolean" that makes "Claude Code refresh that
    marketplace and update its installed plugins in the background after startup". Third-party
    marketplaces default to `false`.
  - Without the flag the key is never written. The merge's output is byte-identical to before.
  - An entry already in the file keeps its `autoUpdate`, whether `true`, `false` or unset, whatever
    the flag says. The committed value outranks each teammate's own `/plugin` toggle
    (plugins/loading), so it was someone's decision. Status, `--write` and `--json` all say what the
    entry holds and that Cortex will not change it.
  - The same byte-preserving insertion and parse-back check apply. A second run writes nothing.
  - `/cortex` names it in the confirmation as its own line and says what it means: every teammate's
    Claude Code pulls new Cortex releases in the background. The README's team paragraph under
    "Keep it current" says the same, with the docs quoted.

  Validated on a zustand clone (b57db4f) with a fake team-brain connector and the hooks template in
  `.claude/settings.json`:
  - `--write --auto-update` added 12 lines and removed none.
  - It differs from the no-flag write only by `"autoUpdate": true`.
  - A second run was byte-identical.
  - A teammate's `false` survived `--auto-update` byte-for-byte, and status named it.

  Mutation-tested: 24 guards, 24 reds. The first run left one survivor, `autoUpdate` spread onto
  `"cortex@cortex": true` as well, and that case now has its own test.

### Fixed

- **On a Maven or Gradle repo the hooks row read "blocked — no generated paths" beside a committed
  build wrapper (#482).** `mvn wrapper:wrapper` and `gradle wrapper` generate `mvnw`, `mvnw.cmd`,
  `.mvn/wrapper/`, `gradlew`, `gradlew.bat` and `gradle/wrapper/`, and the next wrapper upgrade
  overwrites a hand edit. Nothing detected them, so `/cortex` offered no protected-paths hook, and
  REVIEW.md's do-not-report list named nothing.
  - They are now found the way #461 finds lockfiles: on disk, beside the root or a JVM build file
    the index saw. Names are exact, the scripts must be files and the wrapper homes must be
    directories.
  - A wrapper that is not there is never listed. `mvnw.sh`, `src/mvnw` and `.mvn/jvm.config` are not
    wrappers.
  - Wrappers get their own cap of 8, and one project's entries stay together, nearest project first.
    The first cut sorted them flat by depth, and on gs-rest-service's four sample projects the cap
    dropped every `wrapper/` directory.
  - A real `protected-paths.sh` with the wrapper patterns blocks `mvnw.cmd` and
    `.mvn/wrapper/maven-wrapper.properties`, and lets `.mvn/jvm.config` through.

  Validated with `cortex-loop --json` before and after:

  | Repo | Before | After |
  |---|---|---|
  | spring-petclinic (818c413; Maven and Gradle) | `blocked`, with or without an index | offered, 6 paths |
  | petclinic-kotlin (da08609; Gradle) | `blocked` | offered: `gradlew`, `gradlew.bat`, `gradle/wrapper/` |
  | gs-rest-service (3f4cef0; four nested projects, 53 files indexed) | `blocked` | offered, 8 paths: `complete-kotlin/`'s three and five of `complete/`'s six. The cap leaves out `complete/gradle/wrapper/` and both `initial` projects |

  gs-rest-service with no index still reads `blocked`: only the root is asked, and it has no build
  file there. On the step-7 copy of a private Spring workspace, the three Maven repos went from
  `blocked` to `present`, protecting `mvnw, mvnw.cmd, .mvn/wrapper/`. Their pnpm repo was unchanged.
  Every listed path was checked on disk as the kind it was listed as.

  Mutation-tested: 16 guards, 16 reds.

- **Deleting `/resume` or `/cortex-review` would not have tripped the eval alarm (#472).** Their
  tasks could be answered without the skill. With no skill, the `test` split scored 0.944 and 0.986
  soft, well inside the 0.1 limit. The generators now build traps from each skill's own rules. For
  `/resume`: `ahead N` on a branch that `--no-merged` does not list, a clean or dirty extra
  worktree, the current branch listed as unmerged, and a user who is leaving or back from time away
  while PRs are open. For `/cortex-review`: ADR and CHANGELOG lines in the present tense, lines
  that depend on hunks the summary hides, and stale lines that never repeat the old literal
  ("both signals", "the last week", "`core/` holds four modules"). `--record` also refuses a `hard`
  drop of more than 0.2, three tasks in fourteen, because soft cannot see a skill that gets every
  task nearly right. A list answer with a parenthetical on one item, the spelling `/resume` itself
  prescribes for a worktree, no longer loses every item after it. Each trap has a test that the
  right answer scores 1 and the trap scores below 1, and every generated truth is checked against
  the rule applied to the rendered prompt. Re-recorded baselines, with no skill in brackets, as
  hard / soft: `/ship` 1.000 / 1.000 (0.357 / 0.869), `/resume` 0.857 / 0.952 (0.143 / 0.653), and
  `/cortex-review` 0.643 / 0.927 (0.357 / 0.864). The alarm now fires on all three if the skill is
  deleted, but on `/cortex-review` only through `hard`, and only by one task. The one trap that
  separates it is the present-tense ADR line, and its skill text names only "ADR rationale" as
  history. `evals/README.md` says so.

## [2.39.1] — 2026-09-27

A fix release. 2.39.0 was pointed at more repos than the ones it was built against — a Vite app,
Spring Boot services on Maven and Gradle, a Kotlin project, Rust and Go codebases — and each entry
below is something it got wrong there. Every fix has a test that fails without it.

### Fixed

- **Re-running `/cortex` now checks the skills an earlier pass wrote (#462).** `/cortex` keeps
  existing files by design, so an upgraded repo got a new loop beside skills that had gone wrong:
  on the first one, two skills said the repo had no tests while it had a suite, and sent agents to
  `src/components/` paths that had moved. `index/lib/skill-drift.mjs` reads each
  `.claude/skills/*/SKILL.md` against the index and reports, with the line, only what the disk
  proves: a backticked path that is gone, a "no tests" claim beside counted test files, and an
  `npm run` / `pnpm` / `yarn` script no `package.json` declares or an `mvnw` / `gradlew` wrapper
  that is not there. A path the repo's `.gitignore` covers, a file the skill is about to create,
  and a claim scoped to one module are never reported. `cortex-skills.mjs` prints the lines and
  carries them as `drift` in `--offers`; `cortex-next` shows a `skill-drift` step only while one
  exists. `/cortex` adds each drifted skill to its single confirmation, and `/cortex-skills` fixes
  the flagged lines in the body only — asking first about any skill someone edited after it was
  written. On the repo that reported the issue it finds 12 lines across the two skills, and every
  one is real.
- **A Spring Boot application class was reported as an unreferenced file (#459).** The JVM starts
  it, so nothing imports it, and a path rule cannot tell `RestServiceApplication.java` from any
  other class in its package. `isEntrySource` (`index/lib/langs.mjs`) now reads the declaration —
  `@SpringBootApplication`, a static `main(String[])`, a Kotlin top-level or `@JvmStatic`
  `fun main` — with comments and literals blanked first; `build.mjs` marks the file `isEntry`, and
  `findOrphans` asks the same predicate so an index built before this release is answered right
  too. `package-info.java` and `module-info.java`, which declare no class anything could
  reference, are no longer candidates. Nothing wider: a `@Configuration` class nothing uses is
  still listed. On spring-guides/gs-rest-service the one unreferenced file, its application class,
  is gone; on spring-petclinic 6 → 1 (five `package-info.java` gone, `WebConfiguration` kept); on
  gothinkster's Gradle RealWorld app 3 → 2 (`RealWorldApplication` gone). Mutation-tested: ten
  guards broken one at a time, ten reds.
- **Maven and Gradle repos were offered a `src/main` brief "because" it had no tests (#460).**
  Their tests live in `src/test/<lang>/…`, mirroring `src/main/<lang>/…`, and `briefCandidates`
  counted only the tests inside an area — so the reason `no tests in this area — invariants live only
  in prose` appeared beside a report whose own coverage had found tests for most of those files, and
  the Structure tab of the View (coverage-based since #449) said the opposite. It now takes the
  `tested` set from `codeCoverage` — the name, import and mention signals the findings already use —
  which `analyse` computes once and shares with the untested-modules finding, and the View passes
  the same set. An area is untested only when it holds no test and no test was found for any of its
  code. On spring-petclinic (tests for 20 of 30), the RealWorld Gradle app (44 of 93) and the Kotlin
  petclinic (11 of 24) the claim is gone; with `src/test` dropped from petclinic's index it comes
  back, and pmndrs/zustand's `examples/` (0 of 17) keeps it while its `src` and `src/middleware`
  (6 of 7 each, tested from `tests/`) lose a claim that was just as false. `src/main` is still a
  candidate on size and churn — only the false reason and its ranking weight are gone.
- **Every Kotlin file was reported as unreferenced (#465).** `extractImports` has no case for
  Kotlin, so no `.kt` file ever had an edge, and Kotlin was not in `UNRESOLVED_LANGUAGES` — the
  list that turns "I cannot read these imports" into a stated blind spot rather than a claim that
  nothing uses the file. It is listed now: spring-petclinic-kotlin goes from 22 of 24 code files
  "unreferenced" to none claimed, and the report says `Import graph does not cover kotlin`
  instead. C#, Swift, Scala, Elixir, C and C++ had the same gap and are listed with it, and a test
  now fails when a code language has neither an import extractor nor a place on that list. Import
  readers for them are the real fix and are not in this release.
- **The protected-paths hook blocks on Windows too (#458).** Claude Code hands a Windows hook
  `C:\repo\dist\x.js`, and no POSIX pattern such as `*/dist/*` matches a backslash path, so the
  hook `/cortex` stamps let every protected edit through on that platform. It now turns `\` into
  `/` before matching, so one pattern set covers both; the jq and sed readers, the fail-closed exit
  and the bash-3.2-safe empty list are unchanged. `tools/test/cortex-loop.test.sh` runs Windows
  paths through both readers.
- **A test script that starts a watcher is no longer named as the test command (#456).**
  `"test": "vitest"` watches in a terminal and never exits, and `detectCommands` named it anyway —
  so the verification block, the verifier and `agent-evals.yml` all carried a command that hangs.
  `loop.mjs` now recognises runners that default to watching (Vitest without `run`, an explicit
  `--watch`/`--watchAll`, `react-scripts test`, `ng test`, `nodemon`), follows a script through
  the scripts it calls in the same manifest, and prefers `test:run`, `test:ci` or `test:once` when
  one runs once. With none, the test command is null and the verification row says why, rather
  than inventing a one-shot command nobody declared. On bulletproof-react's Vite app it reported
  `yarn test` before and no test command after; on vitest's `examples/basic`, `npm test` became
  `npm run test:run`.
- **Package-manager lockfiles are protected (#461).** No install offered to protect
  `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum` or their kin, so each
  one had to be added to REVIEW.md's out-of-scope list by hand. They are now detected by exact name
  and join the generated paths the hooks row and REVIEW.md read. They are looked up on disk beside
  each manifest the index saw, because the walker drops `*.lock` and `*-lock.json`, so an
  index-only rule passed its fixtures and found nothing on a real repo. On ripgrep it found
  `Cargo.lock` and `fuzz/Cargo.lock`, and on fzf `go.sum` and `Gemfile.lock`, all of them tracked.
- **The hooks row stops promising a test-file lock no template provides (#457).** On a repo with a
  test script and nothing to protect, it said "the hook that matters here is the test-file lock
  during a fix", stamped `protected-paths.sh` with an empty list and `format-changed.sh` with no
  case lines, and counted the row done. The row now applies only where a hook has work to do, a
  path to protect or a formatter to run. Anywhere else it says no hook has work to do here, and a
  hooks block already on disk does not count it as served. `loop.test.mjs` fails if any row's text
  names a file no template provides.

## [2.39.0] — 2026-09-27

2.38.0 was found by reading someone else's harness. This one was found by pointing Cortex at repos
it had never seen. Five private repos built to behave like a real team — a React monorepo with a
gateway, Spring services per feature and per country, a shared team brain, several developers — and
one public library, pmndrs/zustand, installed end to end the way a stranger would.

They found what the suite could not. A teammate's capture never reached another repo's catch-up.
Every `@scope/pkg` import in a monorepo dangled, so its shared packages read as orphans, and 58 Java
classes read as dead code because same-package classes never import each other. The View printed
the machine's own path into a page meant for sharing, broke at phone width, and gave three numbers
for one quantity. Files `/cortex` stamped failed the target repo's own format check. Each is fixed,
with a test that fails without the fix.

The release also makes `/cortex` the single front door, holds Cortex to Anthropic's documented
Claude Code rules — vendored with the sentence each rule comes from, and enforced on this repo in
CI — and adds a front-end to back-end route map, an overlap warning for parallel sessions, and a
PR review workflow `/cortex` stamps into the repos it serves.

**One install: `/cortex`.** Working project or brand new, a repo now goes from nothing to served in
one command and one confirmation. Before, "installed" meant a context layer and a menu of eleven
more commands in no stated order; `/cortex-next` existed to paper over that. Now the install owns
the *shape* a served repo ends up in — the artifact chain an AI-native team runs on, where an idea
becomes `intent.md`, then `spec.md`, then `plan.md`, then a tested diff, then a reviewed PR, and a
production breach writes the next `intent.md`.

### Added

- **`/cortex-review` runs in CI on every pull request.** `/cortex` now stamps
  `.github/workflows/cortex-review.yml` (`templates/loop/cortex-review.yml`): on `pull_request` it
  checks out full history, clones the pinned Cortex release (`CORTEX_REF`, filled from `VERSION`)
  into the runner's temp dir — outside the workspace, because the indexer counts untracked files —
  indexes the repo, and runs `cortex-review.mjs --since <base>` and `--citations --since <base>` on
  the PR's base...head diff. No model, no API key, nothing installed. The report goes to the job
  log and the run summary, and each provable broken citation becomes an annotation on its line.
  **Advisory by default:** the check passes. Setting the repository variable
  `CORTEX_REVIEW_BLOCKING` to `true` makes a provable broken citation fail the PR, and nothing else
  ever does. `index/lib/loop.mjs` gains the `review-ci` row (Deploy, rank 45): offered on GitHub
  Actions once `AGENTS.md` exists, present when any workflow runs `cortex-review`, blocked with its
  unmet need named otherwise. Tests run the workflow's own step script on real PR-shaped repos
  (a mention never fails; a moved file warns, and fails only when opted in), check the stamped
  shape, and pin that what `/cortex` stamps passes the claude-setup checker and is then detected
  as present. The acceptance harness's S4 now stamps the workflow into each workspace clone and runs
  its review step on a PR-shaped branch; that half of S4 passes, and S4 stays `XFAIL (step 8.4)` on
  the overlap warning alone.
- **Who serves this call? The FE ↔ BE route map, across a workspace.** Every index now carries
  `routes`: front-end calls (`fetch`, axios and other HTTP clients, wrappers such as
  `request("/orders")`, request-config objects and RTK Query endpoints, with string or template
  URLs), declared API bases (`baseUrl`, dev-server `proxy` keys), gateway route tables and
  http-proxy-middleware mounts, and Spring `@RequestMapping`/`@Get…`/`@Post…`/`@Put…`/`@Delete…`/
  `@PatchMapping` handlers with class and method paths combined and `server.servlet.context-path`
  applied. `{id}`, `:id` and `${id}` are one path variable. `node index/cortex-routes.mjs <dir>
  --workspace` joins every repo in a directory of checkouts — front-end call → gateway route → Spring
  handler, each as `repo/file:line` — telling two services with one API shape apart by the gateway's
  target. Unmatched calls, unused endpoints and gateway routes that reach nothing are **low**
  findings, and an unused endpoint is "worth checking, never safe to delete": URLs built at runtime
  are counted as unread, not guessed. Read-only; a missing index is built in memory and the output
  says so. On the Harbor test workspace 7/7 calls and 3/3 gateway routes resolve, and scenario S3
  flips from XFAIL to PASS; on the RealWorld React + Spring pair 22/22 calls reach 19/19 handlers.
  Design: `docs/specs/2026-09-27-route-map-design.md`.
- **The checker: does a repo's Claude setup follow Anthropic's own docs?** `index/lib/claude-setup.mjs`
  adds 23 `claude-setup/*` findings to the report `/cortex-install`, `cortex-view` and `cortex-next`
  already read — `CLAUDE.md` (and what it `@`-imports) over 200 lines, emphasis on many lines, an
  import to nothing; skill descriptions over 1,536 characters (counted in code points, so a
  Cyrillic description is not cut at half), bodies over 500 lines, unknown keys, trigger lists on a
  user-invoked skill, links to missing supporting files; subagent unknown keys, missing
  name/description, `:` in a name, keys a plugin agent ignores, and an agent that says it is
  read-only while its tools still grant Edit; hook commands naming a missing or non-executable
  script, a `PostToolUse` hook that exits 2, a settings file that is not JSON; and in Messages API
  code `content[0].text`, `thinking: disabled`, a small `max_tokens`, and prompts asking for the
  model's reasoning. Every finding quotes its rule's sentence and source URL, and is `medium` or
  `low` — never a failure. Plugins are found at the root and under a marketplace's `plugins/<name>/`.
  A new test stamps everything the `/cortex` skill places into a fresh repo and expects zero
  findings; dropping `format-changed.sh` from it reproduces the bug #428 fixed. Validated on
  superpowers (2 skill bodies over 500 lines), anthropics/skills (1) and anthropics/claude-code (an
  unknown `version` key) — every reported file opened and confirmed. On this repo it reports the 44
  skills' `capability` key, which the next step moves under `metadata:`. Three rules joined
  `core/claude-code.js` with their sentences (malformed skill and subagent frontmatter, hooks live
  in JSON settings), and `triggerPhrasing` moved there so the two readers share one heuristic.
- **Workspace packages resolve by name.** A pnpm/npm/yarn monorepo that writes
  `import { Button } from "@acme/ui"` now gets the edge: the index reads the workspace globs
  (`pnpm-workspace.yaml`, `package.json` `workspaces`, `!` negations included), maps each package's
  `name` to its directory, and resolves `@scope/pkg` through `exports`/`module`/`main`/`types`, then
  `src/index.*`, then `index.*`, and `@scope/pkg/sub` through an `exports` subpath or the file under
  the package. Only a file in the index becomes an edge. On a four-package pnpm workspace this took
  cross-package imports from 0/20 to 20/20; on TanStack Query, edges from 1,667 to 2,643.
- **Java same-package references resolve.** A class named with no import — a declaration,
  `new X(`, a generic argument, `X.y(`, an annotation — resolves to `<same dir>/X.java` when that
  file exists and the name is neither imported nor declared in the file. A test in
  `src/test/java` reaches the class it tests in the same package under `src/main/java`, which is
  what coverage needed. Comments and string, char and text-block literals never produce an edge.
  Three Spring services went from 0/58 such references to 58/58; Spring Petclinic's edges from 24
  to 91.
- **`CORTEX_E2E_WORKSPACE=<dir>` — the acceptance scenarios, run against a team's repos.**
  `tools/test/install-on-a-project.test.sh` gains a multi-repo mode beside `CORTEX_E2E_REPO`: point
  it at a directory holding a team's product repos and their team-brain, and
  `tools/test/e2e-workspace.mjs` clones them into the temp dir and runs the roadmap's S1–S4. It
  indexes every repo, derives the edges a correct map must hold from the repos themselves —
  workspace-package imports from `pnpm-workspace.yaml` / `workspaces`, and Java same-package
  references with no `import` — and checks each against the index. It joins every repo to the
  team with `team add`, captures a memory in each through the real MCP server, and asks every other
  repo's `catch-up` for it. One line per scenario, `PASS`, `FAIL` or `XFAIL (<step>)`; a scenario
  is `XFAIL` only when every failing check is one a named step exists to close, so a regression
  inside a still-expected failure is a `FAIL`. Read-only against the workspace, asserted by
  fingerprint. Unset, the fragment behaves exactly as before.
- **`/cortex-impact --against` — two sessions editing one repo now get a warning (#408, v0).**
  Parallel sessions on one repository had nothing to warn them; the only defence was noticing stale
  mtimes by hand, and a test run once reported nine failures that were another agent's edits landing
  underneath it. `node index/cortex-impact.mjs --staged --against <list>` compares your change set
  with another session's and reports the files you both touch and the **one-hop dependency
  collisions** — a file of yours importing one of theirs, or the reverse, which path comparison alone
  never shows. Theirs arrives as a list file (one path per line; CRLF, a BOM and `#` comments are
  stripped), as `-` on stdin, or as `--against-ref <branch>`, which reads `HEAD...ref` — their work
  since the branches diverged, with no fallback that would hand your own commits back as theirs.
  Paths are normalised on both sides (`\` or `/`, `./`, absolute inside the repo) by one function
  that `impactOf` now uses too. Counts are floors under `atLeast`; an empty or unreadable "theirs"
  exits 2 and is never reported as "no overlap"; a missing list file exits 1; findings exit 0, like
  every other answer this command gives. No daemon, no tick loop, no network. The workspace
  harness's S4 overlap check is now real rather than an expected failure — both forms, two git
  identities, one clone — and `tools/test/e2e-workspace.test.sh` runs it on a workspace it builds.
  Run against this repository's own branches it found the shared `CHANGELOG.md` and
  `index/cortex-impact.mjs (mine) imports index/lib/imports.mjs (theirs)` against a resolver branch,
  and said "empty, not no overlap" for a sibling session that had not committed yet.
- **The Cortex View opens on an Overview, and has a Structure tab.** The Overview is the repo's
  state on one screen: index fresh or stale, profile, how far team memory trails the code, and the
  Cortex version; files, import edges, test coverage, 30-day churn with a sparkline, findings by
  severity and the top three as a checklist; the import graph as a slowly turning amber particle
  cloud (hubs near the core, one lobe per area, click a point to open the file); the next commands,
  one click to copy; and a timeline of memory entries and commits. Structure draws the context
  layer as a tree — root `AGENTS.md`, the docs beside it, each code area with its scoped brief,
  busiest files and tests, and what Cortex generates — with every missing piece dashed and naming
  the command that writes it. Every existing tab stays. The page is still one offline file with no
  fonts to fetch, and still byte-identical for the same index: churn and the timeline end at the
  indexed commit, never at today, and the cloud is seeded from a hash of the file ids. A fact that
  could not be read says *not available* and why. Every text colour clears 7:1 on every ground in
  both themes and nothing is under 13px — both computed in `view.test.mjs` from the token objects
  the CSS is generated from. The theme follows the OS, with a remembered override; reduced motion
  stops the cloud; focus is always drawn. `index/lib/overview.mjs` gathers the new facts.
- **`/site-sync` and a site-drift check — the public site follows the source instead of trailing
  it (#416).** On every push to `master`, `.github/workflows/site-drift.yml` reads the site repo's
  committed `site-facts.json` (read-only), compares it with `cortex-site-facts.mjs` on master, and
  opens, updates or closes one `site-drift` issue. A site repo that does not exist yet, or has no
  facts file yet, is a neutral skip. The ritual refreshes the facts, redrafts only the pages whose
  sources changed since the site's version — the route → source map lives once, in
  `skills/site-sync/PAGES.md` — shows the diff and stops; on approval it opens a PR on the site repo
  and never pushes its deploying `main`. The site repo is one value: `CORTEX_SITE_REPO`, default
  `marinvch/cortex-site`. `/ship` points to it. A deliberate exception to "checks, not rituals":
  drafting prose needs judgment a check cannot make (roadmap D14).
- **A front door for someone who has never heard of Cortex.** The README's first screen is now what
  it is (new or legacy codebases, solo or team), a Cortex View screenshot
  (`docs/images/cortex-view.png`), the three install steps, and four bullets on what lands in a repo.
  The vault-era lines that led it — "capture first, organize later" and the MCP-and-vault paragraph
  — moved into the personal vault section, unchanged. The repo gained GitHub topics, and
  `docs/images/social-preview.png` (1280×640) is ready to upload as the social preview, which
  GitHub only accepts through its settings page.
- **`tools/cortex-site-facts.mjs` — the facts a public page states, extracted from source.**
  Version, Node floor, install commands, every ritual (`AGENTS.md` table joined with the skill
  folders — a mismatch fails the run) and every MCP tool, asked of the checkout's own server in repo
  and vault mode with the model-facing injection warning stripped. Deterministic and offline;
  `--check <file>` exits 1 and names each change ("ritual /resume added", "install command
  changed"). The site drifted four product versions because it restated these by hand (#415); this
  is what it renders from instead (#416). `tools/test/site-facts.test.sh` pins 36 assertions.
- **The Opus 5.5 prompting rules join them — eight `model.*` rules** from Anthropic's platform docs
  (*Prompting Claude Opus 5.5*), each with its sentence copied from the page: effort defaults to
  `medium` and should be measured against evals; thinking counts toward `max_tokens`; read a
  response by block type, not `.content[0]`; a refusal arrives as `stop_reason: "refusal"`;
  thinking cannot be disabled; asking for reasoning in the response can be declined; a text-only
  end of turn is a report, not proof of done; cap automatic continuations. The weekly docs check
  now covers 30 rules across 7 pages.
- **The official Claude Code rules, as data with their evidence — `core/claude-code.js`.** 22 rules
  from Anthropic's docs: skill and subagent frontmatter keys, the 1,536-character skill description
  cap, `SKILL.md` under 500 lines, the subagent fields a plugin cannot use, MCP output limits, hook
  exit codes and timeouts, and `CLAUDE.md` size and pruning guidance. Each carries its source page,
  the sentence on that page that states it, and the date it was confirmed; a rule no sentence states
  does not go in. Nothing consumes them yet — the checker that judges a repo's Claude setup reads
  from here next. `tools/cortex-claude-docs.mjs --check` re-reads the pages and fails when a sentence
  has left its page (exit 1) or a page could not be read (exit 2, never a pass); for the key lists it
  also reports fields Cortex does not know yet. `.github/workflows/claude-docs.yml` runs it weekly
  and opens a `docs-drift` issue. Users never fetch anything. [ADR
  0017](docs/adr/0017-anthropic-docs-are-the-authoring-source.md), and
  [`references/claude-code.md`](references/claude-code.md) for how to add a rule.
- **Skill evals, and a way to train skills against them — `evals/`.** 40 scored tasks each for
  `/ship`, `/resume` and `/cortex-review`, generated from fixed seeds with the ground truth known by
  construction: merge order checked against `/ship`'s own ranking rules, branches that only *look*
  deletable (squash-merged but still receiving commits, closed unmerged, old with no PR), the branch
  the dirt is on, stale lines versus history and unchanged facts, and changes with nothing stale at
  all. `evals/score.mjs` is the one scorer, and it is tested before anything trusts it.
  `evals/skillopt/` plugs the tasks into [SkillOpt](https://github.com/microsoft/SkillOpt), which
  keeps an edit to a skill only when it raises the held-out score — both roles over `claude -p`, so no
  API key. The evals treat a squash-merged branch with nothing committed since as deletable — a
  policy, stated here because the tasks encode it. Every held-out task is drawn from the same
  generator as training, so a score says the skill handles *these kinds* of situation, not every
  real one; the worktree rule under **Changed** is a case the generator cannot produce.
- **`/cortex`** — the front door. Indexes, reports, reads what the loop is missing, merges that with
  the findings worklist into one interview, plays everything back grouped by stage, and applies it in
  one pass behind a single `[a]ll / [p]ick / [n]one`. Hands off to `/cortex-scaffold`,
  `/cortex-brief`, `/cortex-skills` and `/setup-plugins` where they already own the writing.
- **`index/lib/loop.mjs`** and **`index/cortex-loop.mjs`** — which of eight loop artifacts a repo has,
  which it is missing, and which are blocked and on what. Deterministic, read-only, no clock.
  Detects the repo's real build/test/lint commands from `package.json` scripts and Makefile targets,
  and reports none rather than guess.
- **`templates/loop/`** — the verification block for `CLAUDE.md`, a report-only verifier subagent,
  `REVIEW.md`, build-time hooks with a protected-paths guard, the `intent/` home and its template,
  an agent-eval workflow, and control bands.
- `cortex-next` gains a **loop** step, and names `/cortex` as the entry point.
- **`tools/cortex-frontmatter.mjs`** — a strict, dependency-free check of every `skills/*/SKILL.md`
  frontmatter: flat `key: value`, `name` and `description` present and non-empty, no block-scalar
  description (it parses to `|` and the skill is never suggested), no unquoted `": "` or `" #"`, no
  value opening on `@`, a backtick or another YAML indicator. No warn mode. It is the one frontmatter
  parser in `tools/` — `cortex-capability.mjs` imports it, and `core/test/plugin.test.js` runs it in
  place of its own looser regex. `tools/test/skill-frontmatter.test.sh` pins each rule on a fixture.
  (#406)
- **`.cortex/local-paths`** — an install can exempt a folder that is local by design (a machine's
  own cron and watchdog scripts) from the absolute-path privacy check without editing the test. One
  literal repo-relative path per line; each applied exemption is printed on every run. A line naming
  the whole repo, climbing out of it, using a glob or pathspec magic, or covering no tracked file
  fails the suite. The file is caught by the `.cortex/` ignore rule, so upstream cannot ship one on a
  plain `git add -A`; a clone commits its own with `git add -f`. Absent — as upstream — the check is
  unchanged. (#419)
- **`/optimize-context` judges always-loaded lines by Anthropic's own test.** A new pass applies
  the best-practices prune test ("would removing this cause Claude to make mistakes?"), the
  broad-only rule, the one-line emphasis rule and the line limit, each cited by its rule id in
  `core/claude-code.js` (`claude-md.prune-test`, `claude-md.broad-only`,
  `claude-md.emphasis-one-line`, `claude-md.max-lines`) rather than a number restated from memory,
  plus the page's keep / cut-or-move table. Every finding it raises is still `[propose]` — the test
  says what to propose, a human still says yes.
- **Skills `/cortex-skills` writes are scoped with `paths:`.** Each stack candidate in
  `index/lib/skills.mjs` derives globs from the ids the index DETECTED — a Prisma schema gives
  `paths: prisma/**, **/*.prisma`, GitHub Actions gives `.github/workflows/**` — and the CLI prints
  the exact frontmatter line under the proposal for the ritual to copy. A value opening on a YAML
  indicator (`**/*.ts, …`) is quoted so it cannot parse as an alias. A candidate with nothing
  file-shaped detected (Stripe's webhook, a first test, Express routes) gets no `paths:` line at
  all, never an empty one; agents that ignore `paths` read the skill as before.

### Changed

- **Ready for Anthropic's plugin directory.** Checked against the directory's pre-submission
  checklist: `plugin.json` now carries `author`, `license`, `homepage`, `repository` and `keywords`
  (the checklist warns without an author), and `marketplace.json`'s unknown top-level `repository`
  moved onto the plugin entry, so `claude plugin validate .` passes with no warnings. The security
  scan rejects behaviour a README does not disclose, so the README gains **What Cortex runs, sends
  and fetches**: the indexer is offline; the MCP server's only network use is `git` against a
  team-brain the user connected; workflows `/cortex` stamps run in the user's CI; no telemetry.
  The README's `/cortex-view` row, "What lands" tree, CLI block and Tools table caught up with what
  shipped (`cortex-routes`, `cortex-placeholders`, `cortex-site-facts`, the loop artifacts, `adr/`),
  and `skills/site-sync/PAGES.md` now maps `/cortex`, `/cortex-review` and the View notes to the
  pages written from them — gaps `/site-sync` found and could not fill.

- **The docs site moved to [marinvch.github.io/cortex-site](https://marinvch.github.io/cortex-site/).**
  The site repo was renamed `ai-os-site` → `cortex-site`, served from `/cortex-site/`; the README
  links it and the repository's Website field points at it. Closes #415.
- **Cortex follows the Claude Code rules it reports on.** Run over this repo, the `claude-setup/`
  checker found all 45 rituals carrying `capability` (and two carrying `reached-by`) as top-level
  frontmatter keys, which Claude Code ignores without an error — while the same checker told users
  to put custom data under `metadata:`. Both keys now live in one `metadata:` map, the only nesting
  `tools/cortex-frontmatter.mjs` admits: any other nested key, a top-level `capability:`, an empty
  or inline `metadata:` all fail. `cortex-capability.mjs` and `cortex-skill-graph.mjs` read the new
  location through that one parser, and their output is byte-identical to before. The move was a
  throwaway script; the diff on every `SKILL.md` is frontmatter only. The new
  `tools/test/cortex-follows-its-own-rules.test.sh` runs the checker over this repo and fails on any
  finding — and plants one in memory to prove it can fail.
- **Rituals set `effort:` from their capability floor.** `low` on the 16 `mechanical` rituals,
  `high` on the 6 `strong` ones, nothing on the 23 `judgment` ones, which keep Opus 5.5's default
  `medium`. `core/test/plugin.test.js` pins the mapping, so effort cannot drift from the floor.
  **Eval verification is pending.** The three skills with evals — `/ship`, `/resume`,
  `/cortex-review` — are all `judgment`, so this change leaves their level where it was, and none of
  the 22 skills whose level did change has an eval to measure it with. The measured comparison
  (`evals/skillopt/run.py eval … --split valid_unseen` at `low`, `medium` and `high`) was not run for
  this entry: SkillOpt is not installed on the machine that made the change, and each run spends the
  maintainer's own Claude subscription. No scores are recorded here until it has been run.
- **The `agent-evals.yml` template continues a turn that stopped short, at most twice.** A model can
  end its turn on a status update with the work still open, and the template used to fail such a
  case on the spot. Now a clean end of turn whose work `accept.sh` still rejects is continued in the
  same session (`claude -p --continue`), at most two times, and a case still rejected after that is
  reported `PARTIAL` and fails the job. A run that ends in an error is a failure and is never
  continued. Both rules are Anthropic's for Opus 5.5 (`model.agentic.end-turn-is-a-report`,
  `model.agentic.continuation-cap`); the cap is tested against the rule's value, and the step's own
  script runs against a stub `claude` that returns a status-only message.
- **`/skill-creator` states the body limit in lines, and `/writing-for-agents` cites Anthropic.**
  The skill told authors "~500 words" where the skills page says 500 lines; the discipline cited only
  its upstream. It now links the skills, subagents, memory, best-practices, hooks and Opus 5.5
  prompting pages, and a test fails if a page `core/claude-code.js` vendors a rule from is missing.
  Both drifts were recorded in ADR 0017. `/skill-creator` also now says what frontmatter a new ritual
  needs: `metadata: capability:`, and `effort:` from it.

- **The prompt gate stopped firing on clear requests.** It scored "restore last session and give
  me what was done" and "go ahead do all of them" at 5/5 and interrupted both. Three causes:
  `restore`/`investigate`/`continue` and their kin were not action verbs, and `merged` did not
  match `merge`; `session`, `pr`, `branch`, `cortex` and other everyday words here were not domain
  words; and a go-ahead only bypassed at two words or fewer, so any tail made it a new request. Verbs
  now match inflected, a `/ritual` or a hyphenated ritual name counts as naming a component, and a
  go-ahead of up to eight words bypasses. "make it better" and "fix stuff" still fire, and the
  test pins both. The scoring rules left the root `AGENTS.md`, which loads every turn, for
  `skills/optimize-prompt/SKILL.md`; the hook's test fails if a word it scores on is missing there.
- **`/ship`, `/resume` and `/cortex-review` were trained against `evals/`.** Held-out tasks fully
  right on Sonnet 5, before → the text that ships: `/ship` 7 → 14 of 14, `/resume` 2 → 14 of 14,
  `/cortex-review` 13 → 14 of 14. The misses were the skills' wording, not the model. `/ship` read
  "files a second PR also touches, **next**" as *last*, and refused to delete a squash-merged branch
  because it named `git branch --merged` as the only basis — a squash merge never shows there; it
  now ranks PRs in strict tiers and decides each branch from one table. `/resume` counted gone and
  no-upstream branches as hidden work and routed to `/ship` with no PR open; `--no-merged` now
  decides, and routing is an ordered list. `/cortex-review` flagged lines that shared a keyword with
  the change as stale; it now tests the sentence's claim, and keeps *unverified* apart from *stale*.
- **`/resume` looks in every worktree.** The trained rule — only `--no-merged` decides which
  branches hold work — would have missed the session that built these evals: a branch with no
  commits, all of its work uncommitted in a worktree under a temp dir. `git worktree list` and a
  `status` per extra worktree now report that dirt with its branch and path.
- **"Finished" now means the chain is closed**, not that a context layer exists. A repo with
  `AGENTS.md` and no `REVIEW.md` or `intent/` is reported mid-sequence. Blocked artifacts — evals
  without CI, bands without a review gate — never hold completion open.
- `/cortex-install` is documented as the read half of `/cortex`, and still works alone.
- **The root `AGENTS.md` describes Cortex as a project**, used solo and by teams, not as a personal
  vault. It opened as "Cortex Vault — Operating Manual" and declared "this instance is `home`", so
  an agent working on the product was told to refuse the very work context teams install it for.
  The vault's manual — privacy, the `home`/`work`/`lab` firewall, the folder map — moved to
  `templates/vault-AGENTS.md`, and a vault carries a copy as its own `AGENTS.md`: `/onboard` and
  `cortex-vault-extract.sh` write it when it is missing and never over an existing one.
- **The vault skeleton moved out of the product root into `templates/vault/`** — `connections.md`,
  `references/voice.md` and the placeholder READMEs of the eight vault folders, which `.gitignore`
  re-included one `!` line at a time. `/onboard` and `cortex-vault-extract.sh` copy in whatever a
  vault is missing and never overwrite; the extractor also carries a filled root `connections.md`
  or `references/voice.md` out of an older checkout. The root's vault-folder ignore rules stay as a
  backstop. `tools/test/vault-skeleton.test.sh` pins the layout, and the `[[home]]` check on
  `connections.md` now fails when the file is missing instead of passing on nothing.

### Removed

What nothing read, ran or linked to. Each was checked with `git grep` first, and every pointer to
it was repointed or dropped in the same change.

- **`docs/superpowers/`** — about 17,000 lines of plans and specs for work that has shipped. The
  changelog and ADRs that cite them stay as written; git history keeps the files. (#405)
- **`docs/history/`** — the retired Node installer, the old view generators, the engine-era docs.
  The product's history is its git log and this file. The ignore rules for the pages those
  generators wrote stay, because an old checkout can still have them on disk (#420).
- **`skills/README.md`** — a partial ritual list that had fallen behind `AGENTS.md`'s table.
- **`references/cortex-plugins.md`** — an untested prose copy of
  `plugins/cortex-core-plugins.json` that had already drifted from it. `cortex-init.sh` now points
  at the JSON.
- **`templates/meeting.md`, `templates/connector.json`** — nothing referenced either.
- **The `reflect-session` SessionEnd hook** in this repo's `.claude/` — it appended to
  `brain/candidates.jsonl`, which nothing has read since June.
- The `mcp/node_modules/` ignore line, which `node_modules/` already covers.

### Fixed

- **The stamped protected-paths hook died on every edit on macOS when it had nothing to protect.**
  Most repos get an empty pattern list, and under `set -u` bash 3.2 — still macOS's default — reads
  `"${protected[@]}"` of an empty array as unset. The loop now uses `${protected[@]+"${protected[@]}"}`;
  a test stamps the empty list and pins the form, since a newer bash cannot reproduce the failure.
  Found by installing Cortex on a test team repo.

- **The workspace harness's S1 claude-setup check was a placeholder that failed on every run.** It
  said the checker "exists now — replace this placeholder" and could never pass. S1 now runs the
  checker over every code repo `/cortex` has served (root `AGENTS.md` + `CLAUDE.md` present) and
  passes only when none has a `claude-setup/*` finding; on failure the detail names the repo and its
  first finding down to file and key. It counts the same installed repos as the `.claude/`-artifacts
  line beside it, and a workspace with no served repo says so instead of passing by checking
  nothing. The harness reaches the checker through a new `cortex-findings.mjs --json` — every
  finding with its `kind`, writing nothing — rather than importing `index/lib`, because `--offers`
  drops findings with no offer and the report drops `kind`. `tools/test/e2e-workspace.test.sh` now
  builds a served repo that passes and adds a served repo with a planted top-level `capability:` key
  in a skill, which must fail naming it; `cortex-findings.test.sh` pins `--json`.
- **The 2,000-file frame test failed under load.** It averaged 30 frames from cold against 12 ms and
  read 12.4–18.6 ms while other suites ran, on a frame whose fastest run is about 1 ms. It now takes
  the fastest of 20 frames after a warm-up and adds a scaling check that is what actually guards
  against a quadratic draw: a 2,000-file frame must cost under 20× a 200-file frame sampled in
  alternation (about 10× when linear). Mutation-tested — a per-node pass over every node reads 37×,
  a per-node copy of the position array 104×, both red; the first of those stayed under the old
  12 ms average, so the old test could not see it. Twenty runs beside a full parallel
  `index/test` suite: 20/20 pass, where the old test failed 1 in 20 under the same load.
- **The View leaked the machine's path, broke on a phone, and disagreed with itself — found by
  running `/cortex` on a shallow clone of pmndrs/zustand.** Six defects, every one invisible to the
  literal fixtures in `view.test.mjs`:
  - **Privacy.** `DATA.generated.root` and the inlined sequence (`next.root`, `next.state.root`)
    carried the absolute root, so every page held `C:\Users\<name>\…`. The view now carries the
    repo's name and repo-relative paths only, and a backstop scrubs any string that still quotes the
    root or the home directory (a git or findings error message). `view-repo.test.mjs` renders a real
    git fixture and asserts no spelling of the root, the home directory or the OS user name appears.
  - **Phone width.** At 390 px the page was 459 px wide, no tab was reachable and the theme button was
    cut to "Da". The bar now wraps (brand and theme, search, then tabs on their own rows); every view
    stacks; tables scroll in their own box. The stacked Overview was a one-column grid whose auto
    rows collapsed to nothing under `min-height:0`, painting the cloud over the vitals — it is normal
    flow now. Checked in Chromium at 390, 820 and 1440 px, both themes: `scrollWidth` equals
    `innerWidth` on all seven tabs and each tab clicks.
  - **Structure tab.** It counted a child's brief as its parent's (3 briefs where 2 existed), drew
    `docs/adr/` as missing beside a `TEMPLATE.md`, offered `/cortex-brief root/` and
    `/cortex-brief .claude/`, and said "no tests found" for `src/` areas a top-level `tests/` covers.
    Briefs are now own or inherited, the command appears only where the findings report would offer
    it (`briefCandidates`, which now skips `.claude/` and `.cortex/`), and tests are counted by
    coverage.
  - **One number per quantity.** Imports read 70 / 69 / 66, code files 51 / 52 / 36, untested 11 / 26,
    steps 5-of-9 / 6-of-9 depending on the surface. The view now computes every count once
    (`stats.edges` is the index's own; `mapFiles` / `mapEdges` are the drawn subset and say so); the
    untested set comes from `codeCoverage`, now exported by `findings.mjs`, whose title counts every
    untested module rather than only those in listed directories; and `nextSteps` counts required
    steps only, so the page ticking its own optional step no longer moves the number. "Indexed
    <date>" was the commit's UTC date and the timeline used the committer's local date; both are UTC
    now and the bar says "last commit … UTC".
  - **Smaller.** Repeated basenames get their parent directory (`react/shallow.ts`,
    `add-test/SKILL.md`); backticks render as code; the Map reserves a gutter for its legend, which
    now folds; dark-theme edges rest at 34% and 1.1 px (light unchanged); an inline SVG favicon.
  - **Shallow clones.** Every file read "1 commits" and the hot-spot table was path order. The
    Overview detects `--is-shallow-repository`, churn is reported unavailable with the fix, and the
    untested list ranks by inbound imports instead.
- **A `/cortex` install broke the target repo's own tests.** Found by running `/cortex` on a clone
  of pmndrs/zustand: after the install, the repo's `pnpm test` failed, because
  `prettier --list-different` flagged ten files Cortex had just written. There were two causes.
  First, templates checked out on Windows had CRLF endings (`i/lf w/crlf`) and were copied
  byte-for-byte. `.gitattributes` now pins `templates/** text eol=lf`, and
  `index/test/stamping.test.mjs` checks the attribute on every template. Second, no step ran the
  repo's formatter over what was written. `/cortex`, `/cortex-scaffold`, `/cortex-brief` and
  `/cortex-skills` now each tell the agent to write LF, run the declared formatter on exactly the
  files it wrote, run the repo's own lint/format check, and report a failure that remains. The
  same test checks that each skill still says so.
- **The stamped `agent-evals.yml` used an unpinned `actions/checkout@v4` that kept its credentials.**
  zustand pins every action by SHA and sets `persist-credentials: false`, so a security reviewer
  would have flagged the stamped workflow. The template now pins checkout to `3d3c42e…` (v7.0.1),
  names the release in a trailing comment, and disables persisted credentials. A test checks that
  every stamped workflow pins each `uses:` to a 40-character SHA with its release named, and that
  every checkout sets `persist-credentials: false`.
- **`docs/adr/` was hard-coded, so on a docs-site repo the ADRs would have been published.** In
  zustand, `docs/` is the source of the public docs site: `docs.yml` builds `mdx: 'docs'` and
  deploys it to Pages. The new `index/lib/adr.mjs` holds the one answer. ADRs go in `docs/adr/`, or
  in `adr/` when `docs/` is a published site. It counts as one when it has a Docusaurus, VitePress,
  MkDocs, Sphinx, Jekyll, Hugo or Astro config, a `docs/package.json`, or a workflow that deploys
  Pages and names `docs`. ADRs already on disk stay where they are. Every reader accepts both
  locations: review's historical class, `isContextDoc`, the view's count and label, and `readState`
  (which now carries `adrDir` and `adrWhy` for the scaffold). `.cortex/adr/` was rejected because
  the walker skips `.cortex/`, so review would never see those records.
- **The scaffold's `{{` check had three false hits on every correct install.** Two were
  `TEMPLATE.md` files that keep their placeholders on purpose; the third was a workflow's `${{ }}`.
  The new `tools/cortex-placeholders.mjs` replaces the grep. It maps each written file to the
  template it came from and reports only that template's exact placeholders. It skips
  `TEMPLATE.md`, ignores `${{ }}`, and still catches a placeholder a formatter reflowed across
  lines. To make that design hold, placeholders in the prose templates are now phrases
  (`{{test command}}`, `{{an area}}`), never identifiers like `{{test}}`, which Handlebars, Vue and
  Jinja would parse as an expression. `tools/test/placeholders.test.sh` covers both directions.
- **`cortex-next` said "Next → /cortex" forever after `/cortex` had run.** Evals and bands are
  blocked until the first pass writes `CLAUDE.md` and `REVIEW.md`. After that, they wait on history
  that no second pass can create. The loop row now counts as done when one pass has nothing left to
  write. Each of the two gets its own row: `/cortex evals`, and `/cortex bands`, which is optional
  because a library with no production metric is finished without one. `/cortex` states that
  split in its playback and close, and documents being invoked with a row.
- **The instructions contradicted each other.** Preflight named `/cortex-install` as the entry
  point to `/cortex`, the ritual that runs preflight first. It also printed
  `node index/cortex-index.mjs .`, a path that does not resolve from the target repo; it now prints
  `/cortex` and an absolute indexer path. `/cortex` and `/cortex-install` said the indexer writes
  only under `.cortex/`, but its first run also appends three lines to `.gitignore`; both now say
  so at the consent gate. `/cortex-scaffold` said `CLAUDE.md` is one line and nothing else, while
  `/cortex` appends the verification block to it. Scaffold now says the block is the one addition.
- **The stamped hook settings claimed each hook finishes "well under a second."** The Prettier
  format hook takes about 2.6 s per edit on Windows. The note now gives that cost.
- **Six detection bugs found by running `/cortex` on `pmndrs/zustand`.** Each was checked on the
  zustand clone and on `pmndrs/jotai` and `shadcn-ui/taxonomy`, and each guard was broken on
  purpose to watch a test fail (21 mutations, 21 red).
  - **Hand-written guides were reported as a protected path.** `docs/reference/migrations/` holds
    two Markdown upgrade guides, and the `migrations?/` name alone made `/cortex` propose a hook
    blocking edits to them. The directory name is now a hint and the file is the evidence: SQL or
    code, and never under a `docs/` tree. zustand: 1 protected path → 0; taxonomy keeps
    `prisma/migrations/`.
  - **A web library was reported as React Native.** `package.json` was scanned for `"react-native":`
    anywhere, and zustand uses it as an `exports` condition. JSON manifests are now parsed, and only
    `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies` (Composer:
    `require`, `require-dev`) count. A manifest that does not parse declares nothing.
  - **A module tested through a barrel read as untested.** zustand's persist tests import
    `zustand/middleware`, which re-exports `./middleware/persist.ts`, so persist was ranked "untested
    (high)". The index now marks `export … from` edges with `reexport` (and the `names` a named
    re-export gives), and coverage follows them from a tested file through every hop, cycle-safe. A
    named re-export is followed only when the test uses one of its names, so `ssrSafe as
    unstable_ssrSafe`, which no test calls, stays untested. zustand: 26 → 22 untested modules
    (persist, combine, redux, subscribeWithSelector, react). jotai: 97 → 93, and each of the four is
    named by a test.
  - **Cortex's own output changed its findings.** `tests/AGENTS.md`, written by `/cortex-brief`,
    counted as a test (15 → 16). It also mentions `vitest.config.mts`, which made that file look
    tested and dropped `rollup.config.mjs` and `eslint.config.mjs` out of the untested finding. Only
    code, scripts and `.bats` files can now be tests, and coverage checks this even on an older
    index. zustand: 15 tests again, and the three root configs are back in the untested finding.
    On this repo, three `evals/data/*/test/tasks.json` files are no longer counted as tests.
  - **The lint command was not found when it was called `test:lint`.** zustand and jotai both
    reported `lint: null`. Lint now matches `lint`, then `test:lint`, then a single `lint:*` script.
    Several `lint:*` scripts with no aggregate are not guessed, and a fixer (`lint:fix`, `fix:lint`)
    is never chosen.
  - **A second findings run on the same day overwrote the first without saying so.** The rule of one
    report per date is unchanged, but when the earlier report was different the command now prints
    that it was replaced, and how to keep both with `--out`. An identical re-run prints nothing
    extra.
- **The destructive-guard test failed at random, and four other checks could have (#433).** Under
  the `pipefail` that `tools/test/run.sh` sets, `code_of f | grep -q resolve_in_root` reported a
  guard that was there as missing whenever `grep -q` matched and exited before `sed` flushed its
  last buffer: `sed` took SIGPIPE, the pipeline returned 141. `cortex-sync-skills.sh`'s call sits in
  `sed`'s second 4 KiB block with a third to come, so it lost that race once on a loaded CI runner.
  Every such pipe now hands `grep -q` a here-string instead — the guard scan, the secrets-marker
  scan, the `reached-by:` check, the two `.gitignore` rule checks, and the employer-firewall match
  in `cortex-scan-projects.sh`, where a lost race would have registered a work repo. A canary with
  the guard early in a file past a pipe buffer fails on every run of the old pipe;
  `pipefail-grep.test.sh` keeps the pattern out of every fragment and every pipefail tool; and
  `scan-projects.test.sh` is the first test of the firewall at all.
- **A headless `/cortex` reported an install whose `.claude/` half had been refused.** Under
  `claude -p`, Claude Code refuses the verifier, the hooks and `settings.json`: "Writes to a small
  set of paths are never auto-approved, except in `bypassPermissions` mode…", "The safety check runs
  before Claude Code evaluates allow rules from settings", and "In a `-p` run with no host, these
  requests are denied either way." Those sentences, and the one that makes `--permission-mode auto`
  the way through ("Writes to protected paths route to the classifier even when an allow rule
  matches"), are now rules in `core/claude-code.js`, re-confirmed with the rest against the live docs
  on 2026-09-27. Every loop row carries `protectedWrites`; `cortex-loop.mjs` names the mode on a
  missing `.claude/` row; `/cortex` reads its result back from disk and names a refused write
  instead of reporting it; and the E2E workspace pass fails S1 with the paths and the flag. The
  skill's new *Running unattended* section says all of it, and never offers `bypassPermissions` as
  the default.
- **`/cortex` missed the build on Maven, Gradle and pnpm repos, and stamped an eval workflow that
  could not pass.** Found by the Harbor proving ground. `detectCommands` read only a Makefile and
  npm scripts, so a Spring repo with `./mvnw` had every verification row blocked, and a pnpm
  workspace was told to run `npm test`. It now reads a root `pom.xml` (`./mvnw -q verify`,
  `./mvnw test`, or `mvn` with no wrapper) and a Gradle build (`./gradlew build`, `./gradlew test`),
  and picks the package manager from `packageManager`, then the lockfile (`pnpm run build`,
  `yarn test`, `bun run test` — `bun test` is Bun's own runner). `agent-evals.yml` failed on the
  first PR that added `AGENTS.md`: with no cases the glob ran literally under `set -e`; one failing
  case aborted the rest; `accept.sh` needed an executable bit; the exact-match `Bash(<test>)` rule
  denied the test command with any argument; nothing installed the repo's toolchain or
  dependencies; and each case inherited the last one's edits. It now skips with a notice when there
  are no cases or no API key, runs every case, resets the tree between them, allows the test
  command as a prefix rule under `--permission-mode dontAsk`, installs Claude Code with the native
  installer, and takes the repo's own CI setup steps through a new `{{SETUP_STEPS}}` placeholder.
  It keeps loading `CLAUDE.md` on purpose — `--bare` would skip the configuration under test. The
  stamped workflow is now parsed as YAML in a test and checked field by field.
- **A teammate's capture in one repo never reached a catch-up in another.** Two defects, both
  found by acceptance scenario S2 on the five-repo proving ground (capture 0/4, catch-up 0/12;
  after: 4/4 and 12/12). `team add` wrote the *project* into the connector's `slug` field and the
  resolver read `slug` as the *team*, so every connected repo looked for its team-brain clone at
  `team/<project>/`, wrote there, and failed with `not_a_git_repo`. The connector is now
  `{ team, project, teamBrainRepo }` (`team add --project`, with `--slug` kept as its old
  spelling), and an old `{ slug, teamBrainRepo }` connector still resolves: to a clone at
  `team/<slug>` if there is one, else to the clone whose `origin` is `teamBrainRepo`, with the
  startup line saying it is the old shape. And `catch_me_up` never pulled and never read a note —
  it returned the local clone's commit subjects. It now fast-forwards the clone (ff-only, so local
  work is never rewritten), returns `teamNotes` from every project of the team since the date,
  newest first and bounded to stay under the transport cap, and reports a failed pull in `pull`
  instead of returning a stale answer as a quiet week. A connected repo's captures also default to
  its project rather than the team-brain's `inbox`.
- **`cortex-cron.sh` lost its AI summary whenever the response opened with a thinking block.** It
  read `.content[0].text` with `max_tokens: 800`; a model that thinks can put a `thinking` block
  first, and thinking counts toward the limit, so the digest shipped with no summary and nothing
  said why. It now joins every text block, sends `max_tokens: 16000`, and names a refusal or a
  `max_tokens` cut-off on stderr instead of publishing half a sentence. Tested against canned
  responses from a stub `curl`.
- **The hooks `/cortex` stamps failed with "permission denied" on macOS and Linux.** The commands
  ran `.claude/hooks/*.sh` directly, but those scripts are written with no executable bit, and a
  file created on Windows is committed as 100644 anyway. The commands are now
  `bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/<script>.sh"` — no mode bit needed, and a project path
  with a space no longer splits. A repo stamped before this keeps the old command in its
  `.claude/settings.json`; prefixing the two commands with `bash` and quoting the path fixes it.
- **The prompt gate still fired on "yes write the spec".** Only yes/ok + six hand-picked verbs
  counted as a go-ahead. Now yes/ok/sure + any verb on the scorer's action-verb list does, within
  the same eight-word cap.
- **Every repo `/cortex` stamped ran a hook script that did not exist.** `templates/loop/settings.hooks.json`
  registers `.claude/hooks/format-changed.sh` on every `Edit|Write`, and no template for it was
  ever written. It is one now: it formats only the edited file, with formatters `loop.mjs` reads
  from the config each one itself reads (`go.mod` → gofmt, `[tool.ruff]`/`ruff.toml` → ruff,
  `[tool.black]` → black, a Prettier config or `package.json#prettier` → Prettier via
  `npx --no-install`), and does nothing where none is declared. Every path exits 0 — a PostToolUse
  hook runs after the edit and has nothing to block. `index/test/loop.test.mjs` now fails when any
  script a hook command names has no template, or the `/cortex` table never says where it lands.
- **The verifier `/cortex` writes into a repo could edit the code it was checking.** Its prose said
  "change nothing", and nothing enforced it. `templates/loop/verifier.md` now sets
  `disallowedTools: Edit, Write, NotebookEdit`, the subagent field Claude Code enforces, and
  `index/test/loop.test.mjs` fails if any of the three drops out. It keeps `Bash`, which it needs to
  run the change — a shell can still write a file, so this closes the default path, not every one.
- **`recall_memory` and `get_project_context` returned whole files, with no cap.** Claude Code warns
  at 10,000 tokens of MCP output and cuts at 25,000 by default; one oversized memory file came back
  as 272,000 characters and was truncated by the client with no marker. Every tool result is now
  capped once, in the transport (`mcp/lib/stdio.js`, 40,000 characters), and an oversized one comes
  back as a parseable document marked `truncated: true`, with the total size and a hint to narrow
  the request. `mcp/test/result-cap.test.js` runs the server against an oversized memory file.
- **Four rituals only a person can run still advertised triggers to the model.** `/connect-brain`,
  `/migrate-engine`, `/onboard` and `/team-init` set `disable-model-invocation: true` and kept
  "Use when … says …" trigger lists, against Cortex's own rule that a user-invoked description is a
  one-line summary for the `/` menu. Each is one line now, and `tools/cortex-frontmatter.mjs` fails
  a user-invoked skill whose description says "Use when", "Triggers", or quotes two or more
  phrases.
- **Four ritual descriptions were not valid YAML.** `/cortex`, `/cortex-review`, `/install-project`
  and `/optimize-context` each carried an unquoted `": "` in `description:`, which a strict YAML
  parser rejects as a second mapping. Reworded, not quoted, so the one-line readers in `tools/` and
  the shell tests still see the text they always did. Found by the new frontmatter check. (#406)
- **The ADR template prescribed a title style no ADR uses** ("Use X for Y"). It now describes the
  practice — a short claim that states the decision, not the topic — with three real examples.
  Both copies: `docs/adr/TEMPLATE.md` and `templates/adr.md`, which is what `/cortex-scaffold` stamps
  into a target repo. Existing ADRs keep their names; their inbound links are the asset. (#404)
- **A declaration file is now an import target.** JS/TS resolution never tried `.d.ts` or
  `/index.d.ts`, so a shared-types module written as declaration files could only be reached by a
  specifier spelling the whole extension. On `shadcn-ui/taxonomy`, eleven `import … from "types"`
  hit nothing and `types/index.d.ts` carried no inbound edge; now it carries eleven. `.d.ts` is tried
  after every implementation extension, so `x.ts` still wins over `x.d.ts`. (#411)
- **Rust: a file that is its own crate root now reaches the path-shortening loop.** Anything
  directly in `tests/`, `benches/`, `examples/` or `src/bin/` sits under no `lib.rs`/`main.rs`, so
  `use crate::hay::SHERLOCK` in ripgrep's `tests/regression.rs` tried `tests/hay/SHERLOCK.rs` and
  stopped. Such a file is now rooted at its own directory — only when no crate root contains it.
  Edges: ripgrep 119 → 122, tokio 1151 → 1154, none lost. (#412)
- **`/catch-me-up` and `/setup-plugins` failed on their first command on a plugin install.** Both
  told the agent to run `node <vault>/mcp/ai-os.js`, and a plugin install has no vault checkout —
  and even pointed at the plugin, `catch-up` demanded `AI_OS_ROOT` and exited 1. Both now run
  `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js"`, and `catch-up` with no root reads the repo it is run
  in — its committed `.cortex/memory/` since `--since` and its git log — naming the vault half it
  skipped. With `AI_OS_ROOT` at a vault it adds that vault's notes and team-brain commits; at a
  repo's `.cortex/` it reads that repo. It writes nothing, and a misspelt `CORTEX_PROFILE` still
  fails at entry. `mcp/test/rituals-on-a-plugin-install.test.js` runs each command as its SKILL.md
  prints it, from a copy laid out like the plugin cache.
- **`/team-add`, `/team-init` and `/connect-brain` still looked for Cortex's code in a vault.** The
  fix above named two skills; three more told the agent to run `<vault>/mcp/…`, and `/scan-projects`
  pointed at `<vault>/tools/cortex-init.sh`. All now reach the script through
  `${CLAUDE_PLUGIN_ROOT}` and keep `AI_OS_ROOT` for the vault, which the team commands still need
  as the place the clone lands. `/connect-brain` says the plugin path carries its version, so a
  registration made from it needs re-running after an update. The plugin-install test now covers
  `/team-add` and `/team-init`, runs `team add` as printed against an on-disk remote, and fails on
  any `SKILL.md` naming `<vault>/mcp/`, `tools/`, `core/` or `index/`.
- **The `index/` tests left every fixture repo behind in the OS temp dir.** Twelve files made
  `cortex-idx-`, `cortex-find-`, `cortex-open-`, `cortex-walk-` and similar dirs with `mkdtempSync`
  and never removed one — 7,500+ on the machine that found it, about 130 per full run. They now go
  through `index/test/tmp.mjs`, which registers one root-level `after` hook per file, so the
  cleanup runs even when an assertion fails first. A full `node --test index/test/*.test.mjs` run
  leaves the `cortex-*` count unchanged.
- **The `core/` and `mcp/` tests leaked the same way — 29 and 186 temp dirs a run.** Each package
  now has its own copy of that helper (`core/test/tmp.js`, `mcp/test/tmp.js`), so no suite imports
  another's tests. Both runs now leave the OS temp dir exactly as they found it. The last straggler
  was `smoke.test.js`, which killed its server without waiting for the exit; on Windows a live
  process pins its cwd, so the cleanup found the dir still locked.

### Found by running it, not by writing it

Validated on `got`, `fzf` and `flask`, then mutation-tested — nine guards, nine failing tests. The
first real runs found four defects no fixture had: a missing index read as "greenfield, no code yet"
over hundreds of files; `null` printed inside an evidence sentence; a blocked row naming the one
prerequisite that was already met; and `flask`'s stack attributed to a nested example's manifest.

## [2.38.0] — 2026-09-13

The previous two releases were found by *using* Cortex. This one was found by reading someone
else's. A full audit of a peer agent harness assessed thirty-two of its mechanisms; six were taken,
and two candidates were dropped after verification rather than shipped on the audit's word — the
create-only write primitive had no clobber to prevent here, because `core/memory.js` appends and
never replaces.

The two most valuable findings were not imports at all. Looking for the peer's guards is what made
anyone look at ours, and both were failing open.

### Fixed — the root guard walked up on errors that were not "it isn't there"

`realpathOfNearestExisting` walks up to the nearest existing ancestor so a create target that does
not exist yet can still be guarded. Its `catch` was bare, so it swallowed every error and kept
walking.

Only absence earns a walk up: `ENOENT`, and `ENOTDIR` for a file used as a directory. `EACCES`,
`ELOOP`, `EPERM`, a poisoned argument — each means the guard **could not answer the question**, and
the bare catch answered it anyway. It walked up to an ancestor that *does* resolve inside the root,
so `resolveInRoot` returned success and the guard passed. Demonstrated against the old code: a path
carrying a NUL byte returned a result instead of throwing.

This is the primitive `mcp/lib/vault.js` and `core/memory.js` are both built on, so the blast radius
was every door onto a vault.

### Fixed — `cortex-sync-skills.sh` ran `rm -rf` on a path it never resolved

`docs/changing-cortex.md` has stated for a year that a destructive shell tool routes its target
through `resolve_in_root`. This tool never sourced the library. `${DST:?}` stops an empty variable;
it does not resolve symlinks.

Not theoretical. With `.claude/skills` as a junction pointing out of the checkout, the old script
**deleted content outside the repository** and copied canonical into the hole. The first test
written for it asserted the outside file still existed — and passed, because the file did exist,
holding someone else's content. It fingerprints the whole outside tree now. That is this repo's own
"assert the property, not the symptom" rule catching the test written to enforce it.

### Added — the guard rule is now scanned, not claimed

`tools/test/destructive-guard.test.sh` reads every shipped shell tool for a delete **or a move** —
`mv` counts, because ADR 0010's original finding was a `mv` — and fails one that neither calls
`resolve_in_root` nor declares a `cortex:no-root-guard` exemption **with its reason** in its own
header. A canary fixture proves the detector fires before its silence is trusted.

It found a second offender immediately: `cortex-vault-extract.sh` carried its "checked and not
affected" justification in a planning document, where no reader of the script would ever meet it.

ADR 0010 is amended rather than rewritten. Its rejected alternative held that guarding every tool
was noise because "two were checked and do not need it" — true the day it was written, and it
silently stopped being the whole list. The rejection still holds on its own terms; what was wrong
was making the claim once instead of making it checkable.

### Added — the skills mirror records what it wrote

`.claude/skills/` is gitignored, so a directory existing only there has no history and deleting it
is unrecoverable. That is why mirror-only directories were reported and never removed. But two
situations were indistinguishable: a skill the tool mirrored and canonical has since deleted, versus
a directory you created locally that exists nowhere else.

A ledger of what the sync itself wrote separates them. Only the first is ever removable, behind an
opt-in `--prune-mirrored`, and **every way of not knowing** — absent ledger, wrong header, truncated
line, a digest that no longer matches — resolves to the second. `--check` stays read-only and writes
no ledger either.

### Added — MCP tools declare whether they return other people's text

`recall`, `recall_memory`, `get_project_context`, `catch_me_up` and `list_projects` now carry a
trust boundary in the tool **description**, where the model reads it, rather than in documentation it
never sees. A `returns: FOREIGN | OWN` field sits beside `mode`, and a row that omits it — or claims
`FOREIGN` without the sentence — fails at import, so the eighth tool cannot ship unmarked.

`list_projects` is marked foreign deliberately: it returns no file bodies, but its slugs are
user-authored filenames, and `ignore-previous-instructions.md` is a legal project name.

### Added — a handoff note says it is a record, not instructions

`/handoff` writes in-flight state that a fresh agent reads whole, and its content is inherently
command-shaped — the skill requires a suggested-skills section. "Ran `/ship` on the release branch"
reads to a reader with no memory exactly like an instruction to run `/ship`. The peer harness shipped
that failure and re-ran a recalled command, duplicating issues and branches.

The frame travels **inside the artifact**, because the artifact is what gets read; a warning living
only in `SKILL.md` is one the next agent never sees. `/dream` got a source-side rule instead — its
file is append-only and multi-author, so a per-entry banner would repeat all day — and
`/catch-me-up` got the read-end rule, since that is where a recorded command becomes a replayed one.

### Added — `cortex-role-reviewer` defends against its own findings

Grounding the reviewer in the index fixes *where* a finding points, not *whether* it should exist. A
grounded reviewer can cite a real line for a problem nobody has, and six angles dispatched on one
diff each feel obliged to produce something.

It gains a six-question pre-report gate, proof required for High (the quoted line, a concrete
failure, and the named guard that fails to stop it), an explicit licence to return zero findings, and
a false-positive table derived from this repo's own ADRs rather than a generic list — a library
suggestion against ADR 0004, an N+1 warning about a single offline pass, a DRY complaint about the
copies that parity tests exist to pin.

### Fixed — a dispatched subagent nothing proved exists

`core/test/install.test.js` collects dispatched agents by matching `subagent_type:` in skills, and
`/cortex-review` named its subagent in prose. So the assertion covered `cortex-auditor` and silently
skipped `cortex-role-reviewer`: deleting that file left the suite green while the ritual broke for
the user, at the moment they ran it. The skill changed, not the test — widening the regex to match
prose makes the test weaker and invites the next unmatched phrasing.

## [2.37.1] — 2026-09-05

2.37.0 shipped with a paragraph about bugs that fail open. Both fixes here were found the same
day by *using* it: one by pointing 2.37.0 at a real React app, the other by an agent running a
test the way the documentation says to run it and destroying this repository's `README.md` in the
process.

### Fixed — a `tsconfig.json` holding only `references` made every alias invisible

Alias discovery read files named exactly `tsconfig.json` / `jsconfig.json` and followed `extends`
**upward**. It never followed `references`.

The Vite React-TS template — the output of `npm create vite@latest -- --template react-ts` — is
**solution-style**: the root `tsconfig.json` is `{ "files": [], "references": [...] }` and the
`paths` live in `tsconfig.app.json`. The root contributed no aliases because its `compilerOptions`
is empty; `tsconfig.app.json` was skipped on the filename check. Every `@/…` import in such a repo
was invisible.

Measured on one, same tree both runs: **13 resolved imports became 109**, and **30 files reported
unreferenced became 1** — the survivor being `vite-env.d.ts`, which is the right answer. Layers went
from 3 to 8. Every consumer of the graph — orphans, impact, depth, the viewer, the untested-module
ranking — had been confidently wrong on that repo, and the report it produced looked clean.

Two decisions inside the fix are worth knowing:

- **A referenced config's alias table is keyed at that config's own directory**, not the referrer's.
  Its `paths` resolve against its own `baseUrl`, so keying at the referrer hands every package in a
  workspace the first-listed package's files.
- **Configs governing the same directory are merged, not raced.** The Vite layout puts three configs
  at the root and only one declares `paths`; a first-match lookup would drop aliases by declaration
  order. The specificity comparator was hoisted so the merge and the single-table case cannot rank
  the same aliases differently.

The comment above this code already described the identical symptom on a Next.js app. The `extends`
half was fixed then and `references` was never considered — `index/AGENTS.md` now records that it
happened twice, the same way, because the fixtures shared the code's blind spot both times.

### Fixed — a shell test run outside the runner built its fixtures in this repository

A `*.test.sh` under `tools/test/` is a **fragment** that `run.sh` sources, not a script. The runner
makes a temp directory and exports `$WORK` and `$REPO_ROOT`. Run a fragment on its own and both are
empty:

```sh
cd "$WORK/proj"     # becomes `cd ""` — fails, and does not stop the script
git config user.email t@t
> README.md ; git add -A && git commit -qm init    # ...in whatever directory you were standing in
```

On 2026-09-05 an agent ran `bash tools/test/cortex-view.test.sh` from the repository root — **the
exact form the leaf briefs print** — and the fixture rewrote the git identity, overwrote `README.md`
with `# readme`, overwrote `package.json` and committed twice on `master`. Nothing failed. The
damage was the test passing.

`docs/changing-cortex.md` already required a destructive shell *tool* to route through
`resolve_in_root`. The shell *tests* had no equivalent, so one half of `tools/` was guarded and the
other was not.

The obvious fix — a check inside `_helpers.sh` — would never have fired, because **none of the 26
fragments sourced it.** So `_helpers.sh` gained a top-level gate that refuses to load unless `$WORK`
and `$REPO_ROOT` are set and `$WORK` is a real directory, and every fragment gained one line making
it the first thing reached. One guard, 27 call sites. `run.sh` exports before sourcing, so the gate
never fires under the runner.

All 26 fragments got it, not only the ten with a bare `cd "$WORK`: five others build fixtures under
`$WORK` without cd'ing at all, which with `$WORK` empty writes to the **filesystem root**.
Separately, ten bare `cd` lines gained `|| exit 1` — the missing `||` was the root cause, not just
the unset variable.

`tools/test/fragment-guard.test.sh` asserts it in two halves, because either alone fails open. The
**behavioural** half builds a real git repo, runs every fragment inside it with the variables unset,
and requires each to exit non-zero with the tree fingerprint — files, sizes, `git log`,
`git config --local` — byte-identical. The **structural** half checks that every fragment sources
the helpers first and no fragment `cd`s without `|| exit 1`; under the runner a missing guard line is
invisible, so that is what stops a fragment written tomorrow from skipping it.

It was mutation-tested against a scratch copy: with the gate removed, the incident reproduces
exactly, and all three behavioural assertions catch it.

**43 rituals. 529 shell assertions.**

## [2.37.0] — 2026-09-05

An agent team with an owner per layer read this repo against its own documents. One failure class
dominated the findings, and it is the reason this release is mostly `Fixed`: **a bug that fails open
and silently.** Not a crash, not a stack trace — a confident, plausible, wrong answer that every
test agreed with. Seven of the fixes below are that shape, and in three of them the wrong answer was
`0`, which reads as good news.

### Fixed — a flag written before the root sent `.cortex/` into the caller's own directory

`cortex-enrich.mjs plan --include src /path/to/repo` took `--include` as the root, resolved nothing,
fell through to `process.cwd()` and wrote `.cortex/` **into whatever directory the user happened to
be standing in**. It never failed; it succeeded somewhere else.

The first fix stepped over known valued flags, and was still wrong: `-include` (one dash) is not
`--include`, so it sailed past the guard and became the root again. The rule is now that **any**
leading `-` is a flag, `FLAGS` is a name → takes-a-value allowlist, and a flag not in it is a usage
error rather than a silent root. The same parser now rejects an unknown subcommand instead of
treating it as a path.

### Fixed — eight CLIs answered confidently about a directory that was not there

`index/lib/root.mjs` is new: one pure predicate, `rootProblem(root)`, returning a message or `null`.
A CLI handed a path that does not resolve to a readable directory now exits **1** — a usage error,
distinct from **2**, which means a precondition was not met — and says *"Nothing was changed."*

Before it, a typo in the path produced an index of zero files, zero findings and zero coverage gaps,
reported as a clean result. Eight CLIs adopted it (`index`, `findings`, `enrich`, `impact`, `next`,
`review`, `skills`, `view`). `cortex-memory` deliberately did **not** — its `--root` names the memory
store, and `append` creates that store by design, so the guard would break the one CLI whose job is
to make the directory exist.

This is not `core/paths.js`. That one asks whether a path stays inside the root; this one asks
whether the root is a thing at all.

### Fixed — no dependency in an XML or Elixir manifest could ever be found

The largest find in the release. `declaresDependency` matched a dependency name only when the
character before it was one of a hand-listed set covering JSON, TOML and YAML delimiters — and
nothing else. Maven writes `<groupId>org.springframework.boot</groupId>`; Mix writes
`{:phoenix, "~> 1.7"}`. The preceding character is `>` or `:`, so **every dependency in every
`pom.xml`, `build.gradle`, `.csproj` and `mix.exs` was invisible**, and had been for as long as those
manifests were listed. The boundary is now the negated set `[^A-Za-z0-9_.-]` — what a word boundary
actually means, rather than a list of the delimiters someone remembered.

Seven rows follow it, each validated against a cloned public repository rather than a fixture:
`spring`, `aspnetcore`, `phoenix` (frameworks) and `csharp`, `elixir`, `swift`, `scala` (languages).
Java, Python, PHP/Laravel and Express were already listed and, for the JVM half, already broken.

A comment block now records what was **considered and declined** — C/C++, Kotlin, framework rows for
Go/Rust/Scala/Swift, data-layer rows — because a row not added is a decision, and an unrecorded
decision gets re-litigated by the next reader who notices the gap.

### Fixed — "nothing changed" and "git could not answer" were the same sentence

`cortex-review.mjs` passed a 64 MB `maxBuffer` to its git call. `cortex-impact.mjs`, doing the same
job, did not — so a wide enough `--since` overflowed the default buffer, threw, was caught, and
returned an empty list that printed as **"nothing changed"**. The two are now one module,
`index/lib/changed.mjs`, returning `{ files, failures }`: a git command that could not answer is
reported as a failure, never as an empty result.

### Fixed — the report could not see a dormant exemption, and offered a split with nothing to split

Two defects in `index/lib/findings.mjs` that were hiding each other. The dormant-exemption check sat
*after* an early `continue` that fired whenever a pattern had no hits — so an exemption that had
stopped matching anything, the exact thing the check exists to surface, could never be reported. And
the brief offer was emitted unconditionally, including when it had no targets, so the report
proposed splitting a file into nothing.

Fixing the ordering alone would have made it worse: `findings.mjs` and its own test would both
surface as false rows, because the marker match had to be narrowed to a ten-line header window
first. Each bug was the other's cover.

### Fixed — `status` condemned the batches that `merge` had already accepted

`validateBatch` and `classifyBatches` each read the shape of an enrichment result their own way, and
disagreed. `batchRows()` is now the single reader for both.

The comment above it says only what is true: one reader, so the two can no longer disagree **about
the shape of a result**. They can still disagree about its content, and that part is deliberate.

### Changed — the MCP tool list is enforcement, not advertising

`mcp/lib/tools.js` is new: one table where each tool declares `mode: repo | vault | any`, with
`toolsFor(repoMode)` and `assertAvailable(name, repoMode)`. The list a client is shown and the check
a call passes now come from the same place — previously the list was filtered by mode and the call
was not, so a vault-only tool named directly by a client in repo mode still ran. `server.js` went
from 120 lines to 97.

### Fixed — three documents claimed more than the checks beneath them enforce

`index/AGENTS.md`, `docs/changing-cortex.md` and `tools/AGENTS.md` each described a guarantee in
stronger terms than the code provides. This is the drift axis of `/cortex-review` finding exactly
what it was built for — and the same overclaiming turned up **inside the commit that fixed the first
round of it**, in the sentences explaining a fix rather than in the fixes themselves.

Related: a line number is now avoided as a citation form in agent-facing prose. `file.mjs:211` is
the one citation a reader cannot verify without opening the file and counting, and it rots on the
next edit — one of the miscitations found here was correct when written and was broken by a later
commit touching a different concern.

### Added — an owner per layer

`.claude/agents/{core,index,mcp,docs}-owner.md`. Four teammate briefs, one per layer of
`core/ ← index/ + mcp/`, each carrying its boundary, its tripwires and its test command. The
architecture rule already had a test in `core/test/architecture.test.js`; it now also has a reader.

They live in `.claude/agents/` rather than `agents/`, and the footer of each says why: `agents/` is
what an installed plugin loads, so a teammate brief placed there would ship to every Cortex user as a
subagent they never asked for. These are for working **on** this repo.

### Added — tests at the level the tools are actually used from

Five new shell suites — `cortex-enrich`, `cortex-findings`, `cortex-index`, `cortex-skills` and
`dormant-exemptions` — plus unit tests for the three new modules. Two of the CLIs that write into a
repo had no test at the level they write from, which is precisely why the `.cortex/`-in-the-wrong-
directory bug survived a suite that was otherwise passing.

**43 rituals. 521 shell assertions.**

## [2.36.0] — 2026-08-30

Three prompts arrived as candidate additions. One was already 90% covered by an existing ritual and
became an extension of it instead; one asked for a criterion that measures the wrong thing; one was
genuinely new. The result is a ritual that judges the skill collection by what it did for someone
rather than by reading it.

### Added — `cortex-skill-usage.mjs` and `/skill-audit`

Every other audit in Cortex reads the skills. This reads the **session record**, because a skill's
real defect is usually invisible in its own file: well written, correct, wired in, and never reached.
The first run found **28 of 42 skills untouched across 51 sessions** — including `/handoff` and
`/catch-me-up`, both of which read perfectly well.

Two counts, kept separate on purpose, because the gap between them is the diagnosis:

| typed | auto | Means |
|---|---|---|
| > 0 | 0 | the description does not match how the work actually arrives |
| 0 | > 0 | it triggers on its own — the slash command is decoration |
| 0 | 0 | nothing reaches it; `cortex-skill-graph.mjs` says whether that is wiring or a missing front door |

**Privacy is the first thing the test asserts, before any counting.** The tool reads a directory
holding everything the user has ever typed and extracts skill names and timestamps only — no prompt
text, in any output mode. A marker string is planted in the fixture and asserted absent from both the
report and the JSON. `CORTEX_SESSIONS_DIR` exists so no test ever reads a real transcript.

`/skill-audit` carries the nuance that keeps the finding from doing damage: `/dream`, `/handoff` and
`/team-init` are **deliberate acts**. Zero automatic invocations is correct for those, and optimising
them into triggering themselves would be a defect rather than a fix. The ritual has to say which
skills it placed in that category, so the judgment is visible instead of assumed.

**Staleness is deliberately not a verdict.** It was the criterion originally asked for; nothing in
this repo is older than 30 days, and mtime runs backwards as a signal — a skill that is correct does
not get edited, so age measures stability as often as rot. It prompts a re-read of a skill's *claims*
(a named file, flag or command that no longer exists), never a conclusion from the date.

### Changed — `/optimize-context` gains a machine scope

Rather than a third near-duplicate ritual for the same job. `~/.claude/CLAUDE.md`, `agents/` and
`skills/` load in **every session on every project**, so a paragraph nobody needs there is paid for
on every turn of every task — the most expensive and least examined context in the setup.

It also inverts the main trim, which is why it needed writing down rather than assuming the repo
rules carry over. A rule moved out of a repo file into a skill survives, because something routes
back to it. A rule moved out of a global `CLAUDE.md` **stops applying in every session where that
skill does not trigger** — and triggering is description matching, exactly the thing that cannot be
guaranteed. So machine scope keeps the *invariant* and moves only the *method*, and safety or privacy
rules do not move at all. The honest outcome is often a file shorter in method and no shorter
overall; the ritual is told to report it that way instead of quoting a line count as if it were the
goal.

### Added — `agents/cortex-role-reviewer.md`

A second subagent, dispatched by `/cortex-review` with one angle: `security`, `performance`,
`accessibility`, `data-integrity`, `operability` or `dx`.

The failure it is built against is the ungrounded expert persona. A "security expert" that has not
read the repo returns the OWASP top ten — true everywhere, actionable nowhere, and authoritative
enough to cost the reader a careful pass for nothing. So each reviewer grounds itself in
`cortex-impact.mjs` first (who depends on the changed files, and which of them no test covers) and
**must cite `path:line`**; a claim it cannot anchor is a topic, not a finding. The generic-advice trap
is named per role in the brief, and the reviewer compares against the repo's own patterns rather than
its defaults — a route guarded differently from the others is a finding, one guarded the same way is
not, whatever the reviewer would have chosen.

`/cortex-review` picks one or two roles by what the diff actually touches. Six reviewers produce a
report nobody reads, and the one real finding drowns. "Nothing in my angle" is an explicitly correct
result, and the return shape includes what was checked and cleared — a review listing only problems
leaves the reader unable to tell "fine" from "never looked".

**43 rituals. 351 shell assertions.**

## [2.35.1] — 2026-08-30

Cortex run against itself, and the findings report was wrong about Cortex.

### Fixed — the coverage signal for subprocess-tested CLIs was blind to the usual way of naming one

`mention` exists precisely for a CLI spawned as a subprocess: the test neither imports the module nor
is named after it, so the other two signals cannot see it. It matched only a **bare** quoted basename
— `"cortex-capability.mjs"` — while every shell test in this repo names the CLI by its path:

```bash
VER="$REPO_ROOT/tools/cortex-capability.mjs"
```

The slash defeated the match. Four CLIs covered by a 338-assertion suite were reported untested, and
`tools/` was ranked as an area needing its own brief partly *because* of that miscount.

Not cosmetic: the findings report is the install wizard's script
([ADR 0006](docs/adr/0006-the-report-is-the-wizards-script.md)), so a false "untested" changes the
interview a user is walked through, not just a document they read.

A quoted string may now be a **path ending in** the basename. The boundary is `/` or the opening
quote, never nothing — without it `helper-build.mjs` would borrow coverage from a test naming
`build.mjs`. Reporting a covered file as uncovered costs a re-read; the reverse tells someone a risk
is verified when it is not, so the boundary stays strict. `index/test/coverage.test.mjs` pins both
directions, including that a genuinely untested module stays untested — a signal that never says
"no" is not a signal.

### Added — the two tools shipped in 2.35.0 without tests now have them

`cortex-preflight.mjs` (12 assertions) and `cortex-plugin-check.mjs` (14). Both were real gaps, not
artefacts of the miscount above: with the signal fixed, `cortex-capability`, `cortex-skill-graph` and
`cortex-version` read as covered and these two correctly did not.

The preflight tests assert the **gate**, not the report: a path that would be committed exits
non-zero, because a caller that only reads stdout will not read a warning. Plus the property, not the
symptom — the whole tree is fingerprinted before and after, so "it writes nothing" cannot pass by
avoiding one artefact someone thought of.

The plugin-check tests cover the trap the tool exists for: a marketplace clone that is current while
the installed cache is stale must still **fail**, because the installed copy is what runs.

### Fixed — a test that overrode `HOME` was reading the real machine on Windows

Found by writing the above. `os.homedir()` answers `USERPROFILE` on Windows and `HOME` elsewhere, so
a fixture setting only `HOME` passed against the developer's actual plugin registry — passing for the
wrong reason, which is worse than failing. One `as_home()` helper now sets both and hands node a
native path, since node resolves a bare `/tmp/...` against the current drive there.

Exactly the class of bug `bash -n` and shellcheck cannot reach, which is why the shell half has
behaviour tests at all.

### Added — `tools/AGENTS.md`

The last area without a leaf brief, at 75 recent commits and 20 test files. It holds what is specific
to this directory: why a script is `.sh` or `.mjs` (decided by the reader — a user who may not have
Node, versus structured state the product already models), the three rules deliberately duplicated
across files that cannot share code and the parity tests that pin them, `resolve_in_root` for
anything destructive, the home-directory rule above, and the five `--check` modes that guard failures
with no error state.

`core/test/architecture.test.js` does not walk `tools/`, so the layering test will not catch a
mistake here. That is the reason these rules are written down rather than assumed.

**Findings on this repo: 4 → 2, both Low and informational.**

## [2.35.0] — 2026-08-30

The rituals were meant to compose — define a thing once, point at it from everywhere else. Nobody
had ever measured whether that held. Two of them turned out to be unreachable, and the ten rituals
covering "where did we leave off" had been invoked zero times in 51 sessions.

### Added — `cortex-skill-graph.mjs`, and the rule it makes checkable

A ritual nothing points at is not broken. It runs when you type its name — so only a user who
already knows it exists ever gets there, and the work it would have done gets done again, worse, by
whoever went second. `/team-init` created a team-brain and never named the command a member runs to
join it. Every ritual that scaffolded a repo needing manual credential setup re-explained the steps
instead of handing off to `/wizard`, which writes the script.

The tool reads the skill bodies rather than a maintained list of edges, because a maintained list is
a second copy and second copies drift — which is the failure it exists to catch. Both link syntaxes
count: an earlier hand count read only `/slash` and reported `/resolving-merge-conflicts` as reaching
nothing, when it points at `[[domain-modeling]]` in its second step.

Isolated in one direction is normal and often correct: a router is nearly all outbound, a shared
discipline nearly all inbound. Isolated in **both** is the defect. `--check` fails on it, and
`tools/test/skill-graph.test.sh` plants a stranded fixture to prove the guard can actually fail — a
guard nobody has seen fail is indistinguishable from one that cannot.

The escape hatch is declared, not hardcoded: `reached-by: <what triggers it>` in the frontmatter, for
the two rituals genuinely reached by something other than a ritual — `/optimize-prompt` by the
`UserPromptSubmit` hook, `/resolving-merge-conflicts` by an interrupted rebase. It has to name the
trigger; a bare `true` is the check switched off wearing the check's clothes.

### Added — `cortex-preflight.mjs`, asked once instead of restated everywhere

Root, profile and index freshness are the three facts nearly every ritual needs before it may write,
and each restated them in prose. Prose copies drift: `AGENTS.md` described the mode/audience seam as
*two* questions long after `profile` made it three. One call now answers all three, plus the
`git check-ignore` the privacy rule demands before archiving anything personal.

The profile half is **not** re-derived — it comes from `core/profile.js`, which reads only
`CORTEX_PROFILE`. A bash reimplementation would have been a fourth copy of the firewall rule.

Staleness is mtime-based, so a fresh clone reads as stale. That error points at re-running a cheap
deterministic index; the opposite error hands someone a confident map of code that has moved.

### Added — `/resume`, and the ten rituals it exists to reach

A month of session history shows the same ask across **6 projects and 12 separate days**: *continue
the last session · what's left to be done · продължи работата*. Meanwhile `/handoff`,
`/catch-me-up`, `/cortex-next`, `/cortex-review`, `/cortex-audit`, `/weekly-review`, `/daily`,
`/capture`, `/grilling` and `/wizard` had **zero invocations in 51 sessions** — typed or
auto-triggered. The rituals existed; nothing reached them.

`/resume` is the front door. It reads the state off disk — branches, open PRs, `.cortex/memory/`,
`cortex-next` — states committed / uncommitted / diverged / remaining, and only then routes. It
never reconstructs what a previous session decided: a plausible invented decision is
indistinguishable from a real one, which is the single failure that would make it worse than
nothing.

### Added — `/ship`

Shipping fails two ways. A bad change landing is the loud one. A good change never landing — parked
on a branch, stacked behind a PR that merged first — is quieter and happens more. One PR at a time,
because a stack whose base merges first strands everything above it. When several are already open,
merge order is ranked rather than arbitrary: anything another PR is based on, then anything touching
shared files, then the rest. Deletes only `--merged` branches; "looks old" is exactly where
abandoned-but-wanted work lives.

### Added — `/plugin-sync` and `cortex-plugin-check.mjs`

A plugin reaches a session through three copies — repo `VERSION`, marketplace clone, installed cache
— and nothing announces a mismatch. Every command is present, every skill loads, and the model
follows last week's instructions against this week's code, so a correct fix looks broken and the
obvious conclusion is the wrong one. Updating the marketplace alone does **not** move the installed
cache; that is the step people skip, which is why each stage is reported separately instead of as one
version number.

It found live drift on the machine it was written on: repo at 2.34.1, installed cache at 2.33.0.

### Fixed — two skills named a script by a path that does not exist in a target repo

`core/test/plugin.test.js` caught it: `node tools/cortex-version.mjs` and
`node tools/cortex-skill-graph.mjs` are repo-relative, and a skill runs inside somebody else's
checkout. Both go through `${CLAUDE_PLUGIN_ROOT}` now. The test was already there and already
correct — this is the first change it stopped.

### Changed — the rituals now reach each other

`/team-init` ↔ `/team-add`, `/dream` ↔ `/handoff` (running one is not running the other, and
`/handoff` alone on a day that taught you something loses the lesson), `/setup-plugins` →
`/connect-brain`, `/onboard` → `/scan-projects`, `/install-project` → `/wizard`,
`/catch-me-up` → the two rituals whose output it reads.

`/skill-creator` now requires a new ritual to carry at least one edge, and stops recommending a
hand-rolled `cp -r` for the slash-command mirror — that copies once and thereafter never refreshes a
changed skill or removes a deleted one, which is how the mirror drifted to 22 of 30 skills.

**42 rituals. No ritual isolated in both directions.**

## [2.34.1] — 2026-08-24

The re-audit that verified v2.34.0 found the graph itself was modelling the wrong repo. Cortex
stopped being a personal vault at v2.0.0; `.cortexignore` never noticed.

### Fixed — every orphan the viewer reported was a generated file

All eight came from `.cortex/` — four `findings/` and four `memory/` notes. The Gaps tab is where a
reader looks for a note nothing links to, and it was reporting build output. A real orphan appearing
tomorrow would have landed ninth in a list of eight false ones, which is the same as not reporting
it.

`.cortex/index/`, `.cortex/findings/` and `.cortex/view/` are now excluded. `.cortex/memory/` is
deliberately **not**: it is authored knowledge ([ADR 0002](docs/adr/0002-committed-repo-memory.md)),
so a memory note nothing links to is a genuine orphan. The list went from eight entries to four, and
all four are real.

### Fixed — four files shared one graph id

A note id is a slug of the **basename**, so the root `AGENTS.md` and the three package briefs in
`core/`, `index/` and `mcp/` all claimed the id `agents` — six of 24 nodes were ambiguous once the
`findings/`/`memory/` date collisions are counted. A `[[AGENTS]]` wikilink resolved to whichever the
walker reached first, and the dead-link check can be satisfied by the wrong file.

`core/`, `index/`, `mcp/` and `agents/` now sit in `.cortexignore` beside `tools/` and `skills/`,
which were already there for the same reason: they are source, not vault knowledge. The collision
goes with them.

**The sharp edge is still in `tools/_cortex-lib.sh`** — `note_id()` slugs on basename, so any two
same-named notes in different directories still collide. Fixing that properly means moving three
pinned copies of the slug rule together (`_cortex-lib.sh`, `mcp/lib/slug.js`, and the copy embedded
in the generated HTML, held in step by `mcp/test/slug-parity.test.js`). Recorded rather than done,
because nothing in the graph collides today.

Graph after: **16 notes · 27 links · 0 dead · 4 orphans, all real.**

### Fixed — the `references/` row was a subset that did not say so

`AGENTS.md` named four of the six frameworks; `context-engineering` and `nested-briefs` were absent
though both are live nodes with inbound links. The same shape v2.34.0 just fixed in the README's
ritual table, two rows further down the same file. Both added.

## [2.34.0] — 2026-08-24

The remaining `/cortex-audit` findings — the ones held back last release because they were judgment
calls rather than mechanical fixes. Each is a document making a claim that stopped being true.

### Fixed — the README's ritual table was a second, incomplete copy

It listed 20 rituals and read as *the* list. Ten were missing from it entirely: `/cortex-brief`,
`/cortex-impact`, `/cortex-profile`, `/domain-modeling`, `/grilling`, `/handoff`,
`/improve-codebase-architecture`, `/resolving-merge-conflicts`, `/wizard`, `/writing-for-agents`.
Nothing detected the gap, because a partial copy and a complete one look identical until someone
counts — there is no error state, only a reader who never learns that `/cortex-impact` exists.

Syncing the two tables would have bought a few months. Two maintained copies drift; that is what
they do. README now carries a **declared subset of six** with its size and the total written in
numerals, and points at `AGENTS.md` for the complete table. A subset that says it is a subset cannot
fail the way an undeclared one does.

`tools/test/ritual-table.test.sh` holds it: one row per `skills/*/SKILL.md` and one skill per row,
every row naming a skill that exists, and the README's "6 of 39" checked against both. It also fails
if the subset grows past ten rows — at that size it has stopped being a taste and become a second
table again.

### Fixed — the README described a repo that no longer exists

Two claims in the tools section, both false since `core/` and `index/` shipped: the heading said
*"all bash, zero deps"*, and a note said *"the only Node in the repo is the optional MCP brain"*.
There are three Node scripts in `tools/` alone, plus `core/`, `index/` and two Claude Code hooks.

The half that was still true is the half worth keeping, so it is now stated directly: nine scripts,
six bash and three Node, none of which need `npm install` — the guarantee is
[ADR 0004](docs/adr/0004-no-runtime-dependencies.md), and "all bash" was only ever shorthand for it.
Four scripts missing from the table (`cortex-sync-skills.sh`, `cortex-vault-extract.sh`,
`cortex-capability.mjs`, `cortex-version.mjs`) are listed.

### Fixed — a committed file linked a gitignored one

`connections.md` cited `[[home]]`. `home.md` is the personal vault's entry point and this repo
gitignores it, so that link was dead in every fork and the single dead link in the graph the viewer
draws. Removed, with the direction that does work — link *from* `home.md` to the committed file —
written down beside it. The regression check lives in the ritual-table test.

### Fixed — `CONTEXT.md` was an island

The glossary every other document leans on had no wikilink in or out, so it was reachable in
`cortex.html` only by someone who already knew it was there. It now links `[[codebase-design]]`,
`[[vault-architecture]]` and `[[operating-principles]]`, and says what separates it from each.

### Fixed — two ADRs nothing cited

`0002-committed-repo-memory.md` and `0003-git-decides-what-belongs-to-a-repo.md` were the only two
with no inbound link from any committed document. Both are now cited from the file that states
their rule — 0002 beside the `core/scrub.js` requirement in `docs/changing-cortex.md`, 0003 beside
`walk.mjs`'s "asks git, not `.cortexignore`" in `index/AGENTS.md`. An ADR nobody links is an
argument nobody reaches when they go to overturn it.

### Fixed — three templates' missing frontmatter was undocumented

`templates/adr.md`, `templates/CONTEXT.md` and `templates/target-AGENTS.md` are the only files in
`templates/` with no YAML frontmatter. That is correct — they are stamped into *another* repo, where
they are source files rather than notes filed in this vault's graph — but it was inferable only from
the absence. Each now says so in its header comment, so the next audit reads it as a decision.

### Housekeeping

`fixt.tmp.cjs`, a spent one-shot patch script from 2026-08-19 that throws on its first line, moved
to `archives/spent-scripts-2026-08-24/` (gitignored, confirmed with `git check-ignore -v`).

One audit finding was **not** acted on. The retired-`engine/` link at
`docs/superpowers/plans/2026-06-11-personal-ai-os-fusion.md:466` sits inside a fenced
```` ```markdown ```` block — it is a quoted draft README the plan proposed, not a live link.
Rewriting it would falsify what the plan said in exchange for fixing nothing.

## [2.33.1] — 2026-08-24

### Fixed — half the ritual table in `AGENTS.md` was not a table

Found by `/cortex-audit`. A bare sentence — *"Run `node tools/cortex-capability.mjs` for what each
ritual needs"* — sat **inside** the ritual table, between the `/cortex-profile` and `/dream` rows.
Markdown terminates a table at the first non-row line, so the twenty rituals below it — `/dream`,
`/handoff`, `/install-project`, `/analyze-spec` and `/skill-creator` among them — rendered as raw
pipe-delimited text rather than as a table.

This is the single source of truth every agent working in this repo reads first, and half its ritual
menu was malformed. The sentence now sits after the table ends; the table is one contiguous block of
39 rows again.

### Fixed — the README taught the drift mechanism the manual warns about

`README.md` told readers to run `cp -r skills/* .claude/skills/` to get slash commands. `AGENTS.md`
explains, two hundred lines away, that a plain `cp -r` "never removes anything or refreshes a changed
skill" — which is exactly how the local mirror had drifted to **34 of 39 skills, 5 missing and 7
stale**, with `/cortex-next` and `/cortex-view` among the missing. The README now points at
`bash tools/cortex-sync-skills.sh` and says why, naming `--check` for reporting drift without writing.

### Fixed — the privacy rule under-stated its own boundary

`AGENTS.md`'s list of gitignored personal folders omitted `resources/`, though `.gitignore` ignores it
and `README.md` lists it correctly. An agent trusting the manual alone could have treated
`resources/` as shareable.

## [2.33.0] — 2026-08-24

### Fixed — a finished enrichment showed up as no enrichment at all

Running `/cortex-enrich` to completion on this repo — 53 batches, 307 of 318 files, zero validation
issues — produced a viewer that still printed *"no enrichment — run /cortex-enrich"* and a sequence
that still listed the step as never run. Two mismatches in one seam, neither of which errored.

**The filename.** `merge` writes `.cortex/index/enriched.json`. `cortex-view.mjs` and
`index/lib/next.mjs` both looked for `enrichment.json`. Three readers, two spellings, and only
`findings.mjs` had the right one.

**The shape.** `mergeEnrichment` writes `files` as an object keyed by path; `buildView` read
`summaries`, an array. So even with the filename fixed, every card stayed bare.

Both survived for the same reason, and it is worth naming: **enrichment is optional by design**, so
every reader treats absence as the normal case. An empty result is indistinguishable from a repo
that never ran the pass — which makes a wiring bug in an optional feature invisible in exactly the
way a wiring bug in a required one is not.

`ENRICHED_REL` now names the file once in `index/lib/enrich.mjs` and all four sites read it from
there — the same argument [ADR 0013](docs/adr/0013-the-version-has-one-home.md) makes for the
version. `buildView` accepts the object form merge actually produces, and still accepts the array
form so an existing enrichment is not orphaned.

### Added — this repo's own enrichment

307 files now carry a summary, a role and tags, written from reading each file rather than from its
path. They show on the Map's file cards and feed `recall`.

## [2.32.0] — 2026-08-24

### Fixed — `cortex-enrich status` counted filenames, so 33 stale results read as complete

Found by running `/cortex-enrich` on this repo. `status` reported **39/53 batches complete**. Six
were. The other 33 were careful, complete answers written eight days earlier — to a *different plan*.

`batch-<n>.json` records which batch it answered only by its number, and the numbering is a property
of the plan. Re-index after the repo has moved and batch 26 is no longer the same seven files, so
every result file after the first drift point answers a question that no longer exists. `status`
decided completeness with `readdirSync` and a filename regex — it never opened one.

`merge` validates and would have reported it, but **`status` is what an agent reads to decide what
work is left**. An agent following the skill would have skipped all 39 as done and merged summaries
describing the wrong files. That is worse than no enrichment: enrichment feeds `recall`, so a stale
summary is not a wrong answer once, it is a wrong answer every time anyone searches — and it reads
as authoritative.

Batches are now sorted into **done, stale and pending** by reading each result and comparing its
paths to the batch's own file list, exact set equality both ways. Stale is its own state, listed
before pending and named batch by batch with what is wrong:

```
6/53 batches complete

33 batch results answer a different plan — redo or delete:
  batch 7 — core: 2 of 12 files unanswered, 2 paths this batch does not contain
```

Folding it into either neighbour is the bug in miniature: counted as done it is skipped, counted as
pending it looks like fresh work when a wrong answer is already on disk waiting to be merged.

`classifyBatches` lives in `index/lib/enrich.mjs` rather than the CLI — importing the CLI runs its
top-level command dispatch and calls `process.exit`, which silently killed the test process after one
test when the function was exported from there.

## [2.31.0] — 2026-08-24

### Changed — a node is a file, so it now says which file

The Map drew every file as a coloured dot with its name floating above it. At any real repo size the
names collided with each other, belonged to nothing in particular, and the only way to identify
anything was to hover it one at a time.

A node is now a **chip**: a rounded card with the area colour as a left bar and a wash across the
card, the category glyph the dots used to carry alone, and the filename set in the mono face the
rest of the page already uses for paths — a filename is code, not prose. Hit-testing follows the
rectangle, because a radius test against a 200px-wide card leaves most of it unclickable.

Three things had to change with it, each of which was its own bug:

- **Overlap.** Radial repulsion keeps *centres* apart, which is not the same as keeping wide cards
  apart. A separation pass on the actual rectangles now runs three times a frame — once is not
  enough, because resolving A against B pushes A into C.
- **The layout never settled.** It drifted forever, so every attempt to fit it to the window was
  undone by the next frame. It now cools to a stop.
- **The view did not fit.** The graph opened with a third of itself past the edge. It fits after the
  simulation settles — but never below the zoom where the chips stop being readable, because a page
  that fits perfectly and cannot be read has optimised the wrong thing, and never after the user has
  touched the view, because moving someone's camera out from under them is worse than a bad first
  frame.

**Zoomed out, the dots come back.** Below that threshold the labels would be illegible anyway, and
the loose organic shape of the whole repo is what that zoom level is good for. Chips to read, dots
to see the shape.

## [2.30.0] — 2026-08-24

### Fixed — the Map drew a halo of disconnected files, and some of them were not disconnected

Two separate causes, found by looking at the picture rather than at the code.

**Shell libraries were invisible.** A script names its library through a variable far more often
than by literal path — `LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_cortex-lib.sh"` and then
`. "$LIB"`. The specifier reaching the resolver was `$LIB`, which matched no file, so **28 of this
repo's 30 shell files had no edge at all**. Resolution now substitutes same-file literal
assignments (one hop, first assignment wins, nothing executed and nothing chased), and falls back to
the tail after the last slash of a computed prefix — tried **only** against the sourcing script's
own directory, so two unrelated `setup.sh` files can never become one edge.

Validated against real repos rather than fixtures, and it found a form nobody here anticipated:
**ohmyzsh 10 → 16 edges**, the six new ones all zsh's `source "${0:A:h}/file"` — *the directory of
this file* — every one of them true, none lost. **nvm 0 → 0**, which sources through its own
function: it suppresses nothing and invents nothing. This repo: 121 → 126 edges.

**The rest were parked, not hidden.** A node with no edges has only repulsion acting on it, so the
simulation flung it outward — 34 loose labels orbiting the structure, reading as *half this repo is
disconnected*. They now sit in a captioned band below the graph: still drawn, still clickable, still
searchable, no longer pretending to be part of the layout. The remaining ones are honest — shell
tests sourced through a loop variable (`. "$f"`, which has no answer), and tests that read files
instead of importing them.

The legend says what the band means, and hedges it the way the orphan finding does: **no resolvable
import edge is a question, not a verdict.** A dynamically loaded file looks exactly like an unused
one.

## [2.29.0] — 2026-08-24

### Added — `/cortex-view`, because the documented command did not work for anyone who installed the plugin

The viewer shipped with one address: `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-view.mjs" .`. That
variable is set **inside a skill and nowhere else**, so a user who installed Cortex as a plugin and
typed the documented line into their own terminal got `node "/index/cortex-view.mjs" .` and a
missing file. Verified, not assumed: in a plain shell here, `CLAUDE_PLUGIN_ROOT` is unset.

Their only working alternative was a path into the plugin cache pinned to the installed version —
which breaks on the next update. So the feature Cortex advertises as *"see the repo instead of
reading about it"* was reachable only from a clone of Cortex itself.

`skills/cortex-view/SKILL.md` gives it an address a person can remember. The skill carries the
consent gate (`.cortex/` may not appear in someone's project on a run they did not ask for) and the
four hedges the picture needs more than the prose did — an orphan is a question, "no test found" is
a floor, markdown is not drawn, depth is a floor too.

`/cortex-next`, `/cortex-install`, the README and the `AGENTS.md` ritual table now all name
`/cortex-view` rather than the node line. The sequence step that told users to run something that
could not work was the last one it printed.

## [2.28.0] — 2026-08-24

### Fixed — "unreferenced" meant "unimported", and Cortex reported it about itself

Run against this repo, the orphan finding named `tools/cortex-version.mjs` and
`tools/cortex-capability.mjs` — the script that releases Cortex and the script that proves its
capability table. Both are invoked by ADRs, by `docs/changing-cortex.md`, by `AGENTS.md` and by a
shell test. Neither is `import`ed by anything, so both were listed as unreferenced.

That is how repo tooling is normally wired, and it is the failure mode the finding's own docstring
warns about: *"a reader either believes it and deletes live code, or learns the section is noise and
stops reading the ones that are true."*

A file whose path another file names literally is referenced. The signal is the most checkable one
available — the literal repo-relative path appearing in the text of some other indexed file, the
same standard `citationDrift` holds itself to, run in reverse. **The direction of error is chosen:**
this can only ever *remove* entries from the list. Missing a true orphan costs a suggestion nobody
was obliged to act on; inventing one costs trust in every other line of the report.

Validated against three real repos rather than fixtures: apex-engine 20 → 17, and **no change** on
`token-dashbord` or `expressjs/express`, whose remaining orphans are Jest `__mocks__` and standalone
`examples/` — genuinely unimported, correctly still listed. It suppresses where there is evidence
and nowhere else.

Orphan detection now lives in `index/lib/orphans.mjs`, shared by `findings.mjs` and the viewer. There
were two copies; they would have drifted the moment either learned something, which is precisely what
just happened.

### Fixed — the secret-scan exemption told you to re-read files it never named

The finding said *"worth re-reading occasionally: the marker is a claim by whoever added it, not a
guarantee"* — against a bare count. That is not an instruction anyone can follow, and the entire
reason an exemption is surfaced rather than applied silently is so a human can go and check it.

It now names each file and how many secret-shaped strings it carries. Both of this repo's were
checked while making the change and are honest: scanner test assertions (`hunter2`,
`correcthorsebattery`) and a fixture repo built from sixteen zeroes.

## [2.27.1] — 2026-08-23

### Fixed — the answer was buried under 2,478 image tiles ([#367](https://github.com/marinvch/Cortex/issues/367))

`/cortex-impact`'s "Not in the index" section is the one the skill is most emphatic about, because a
path the graph does not know contributes nothing to the walk and silently ignoring it reads as
"nothing depends on this". So it printed every unknown path, one per line.

On a repo with a DeepZoom tile set that came to **2,483 entries, 2,478 of them tile PNGs**. The
actual signal — two staged source deletions a reader genuinely had to resolve — was buried, and the
terminal never reached the affected / unverified / suggested-tests sections at all. **A section
nobody can read has the same effect as one that was dropped, while looking like diligence.**

Assets are now counted by directory and extension; source is still listed one per line. The total is
unchanged, and `--json` still carries every path. The asset list is a **closed set** of binary media
and archives rather than "anything that does not look like code" — an unfamiliar extension is still
shown individually, because surfacing the path nobody expected is the whole job of the section.

Grouping is by nested map rather than a joined string key: the first version used a space, which
would have split a directory named `my assets` into a bogus path on any repo that uses spaces.

### Fixed — `/optimize-context` classified by location, halving its headline number ([#372](https://github.com/marinvch/Cortex/issues/372))

Pass 1 decided "always-loaded" vs "on demand" by where a file sits — root versus nested. For
`.github/instructions/*.md` that is wrong: Copilot decides by `applyTo` frontmatter, so two files
with `applyTo: "**"` load on **every** file while sitting in a directory the skill treated as
on-demand. On the repo that reported this, the headline number the skill says to lead with was
understated by roughly half.

The error ran in the dangerous direction — a repo looks leaner than it is, so the findings that
would recover the most context rank lowest or get dropped. There was a second-order effect too: two
always-loaded files are co-loaded, and that is what makes repointing one at the other
content-preserving rather than lossy. Without reading the frontmatter, a safe repoint was
indistinguishable from an unsafe one.

Pass 1 now carries a signal table (`applyTo`, `alwaysApply`, `globs`, location as the fallback) and
requires stating which signal was used per file, so the classification can be checked rather than
trusted.

## [2.27.0] — 2026-08-23

### Added — vendored code is declared, and stops skewing everything that ranks by size ([#369](https://github.com/marinvch/Cortex/issues/369), [#368](https://github.com/marinvch/Cortex/issues/368))

`walk.mjs` asks git what exists and nothing else, and that stays right. The gap was afterwards: a
legitimately committed vendored tree — a plugin cache, a generated server, another tool's
instruction files — was indistinguishable from hand-written source. On a real repo with ~1,900 lines
of application TypeScript, the index reported 13,532 lines, the **top three** scoped-brief candidates
were all vendored with the actual application fourth, and `/cortex-enrich` planned 13 of 21 batches
over that material.

The mechanism is **declared, never guessed** — the same rule as `go.mod`, `composer.json` and
`tsconfig`. `.gitattributes` already has the vocabulary, and it is the one GitHub itself uses:

```
.agents/**  linguist-vendored
.ai-os/**   linguist-generated
```

A repo that has already marked its vendored trees gets this for free; one that has not says so in a
file its other tools already read, rather than learning a Cortex-only format. A repo that declares
nothing is completely unaffected — asserted by a test, because that is the property that makes this
safe to ship.

**Nothing is excluded from the index.** Git-truth stands: a file you cannot see is worse than one
you can rank correctly. What changes is that `briefCandidates` and `isEnrichable` skip vendored
material, and `stats.vendored` names what was skipped — a cost estimate that silently omits half a
repo reads exactly like one that covers it.

### Added — `/cortex-enrich plan` can finally scope itself ([#368](https://github.com/marinvch/Cortex/issues/368))

The skill has always told the agent to "offer to enrich only the areas that matter if the repo is
large". There was no flag to express that, so the only way to obey it was to eyeball `batches.json`
and skip `batchIndex` values by hand — leaving `status` reporting a large pending set with nothing
to say the skipping was deliberate. **A partial run and an interrupted one looked identical.**

```bash
cortex-enrich.mjs plan . --include src/
cortex-enrich.mjs plan . --exclude .github/,.vscode/
```

The scope is written into `batches.json` and replayed by `status`, so "still to do" and "never
planned" are finally different states. Prefix matching is on path segments, so `--include src` does
not sweep in `srcextra/`.

## [2.26.0] — 2026-08-23

### Fixed — the protection was attached to a skill, not to the act ([#366](https://github.com/marinvch/Cortex/issues/366), [#370](https://github.com/marinvch/Cortex/issues/370))

Two issues, one root cause. `/cortex-scaffold` was the only place that added `.cortex/` to
`.gitignore`, and `/cortex-install` was the only place that stated the consent gate — but neither is
the only place that **creates** `.cortex/`. `/cortex-brief` re-indexes when the index is stale,
`/cortex-enrich plan` writes batches, `/cortex-scaffold` and `/cortex-skills` re-index, and an
install a user stops halfway through has already written one. Each left a directory of generated
artifacts in `git status`, and one of them created it on a user who was never asked.

**The mechanical half moved into code.** `index/lib/generated.mjs` ignores the generated
directories at the moment `.cortex/` first exists, by whichever entry point got there first — no
skill has to remember. Append-only and never clobbering: a broader `.cortex/` the user wrote
themselves is honoured rather than duplicated, and `.cortex/memory/` is never ignored, because it is
committed on purpose.

**The gate stayed in the skills, and is now checked.** ADR 0005 says the missing invocation flag
"is only safe while the gate is present"; `core/test/plugin.test.js` now fails if a skill that can
create `.cortex/` does not say the user must be asked first. A machine can be relied on to remember
a `.gitignore` line. It cannot be relied on to ask, so that half is tested rather than assumed.

Every CLI now prints what it created and what it ignored — "generated and gitignored" must never
quietly mean "invisible".

`/cortex-brief` also gained the step it was missing: **if there is no root `AGENTS.md`, hand off to
`/cortex-scaffold`.** Every leaf opens by pointing up at a root, and step 3 wires a routing table
into it, but no step said what to do when there is none — so the agent improvised a spine, which is
exactly what `/cortex-install` step 6 forbids.

### Fixed — `--out` had quietly stopped meaning it

Caught while writing the above. `--out` exists so Cortex can be pointed at a project someone cares
about without modifying it, and the new gitignore write used the repo root rather than the output
path — so `--out` began editing the target's `.gitignore` while leaving no `.cortex/` behind.

The read-only test could not see it: it checked for a stray `.cortex/` directory and nothing else.
It now fingerprints the **whole tree** before and after, so a write to somewhere the author did not
think to name still fails. Verified by disabling the fix and watching both assertions fail.

## [2.25.1] — 2026-08-23

### Fixed — churn silently reported zero on any repo younger than the window ([#365](https://github.com/marinvch/Cortex/issues/365))

`hotspots()` counted commits over a hardcoded three-month window. A repo whose entire history
predates it scored `commits: 0` for **every** file, and nothing said so — not an error, not a
warning, just a signal that had quietly become a constant. Found on a real repo with 11 commits and
120 files.

The damage was downstream and invisible: `/cortex-brief`'s "ranked by size, churn and absence of
tests" degraded to ranking by size alone, `/cortex-impact` lost its tiebreak, and the viewer's hot
spots emptied. Every one of them printed its usual confident sentence.

When the window finds nothing and the repo does have history, all of it is counted and the index
records which window was used — `stats.churnWindow` is `"3 months ago"`, `"all history"`, or `null`
when there is no git at all. That last distinction is the one `UNRESOLVED_LANGUAGES` exists to keep
for imports: *I looked and found nothing* must not print the same sentence as *I could not look*.
The findings report now says "in this repo's whole history" when that is what it means, rather than
claiming three months.

### Fixed — skills invoked Cortex's scripts by a path that does not exist in a target repo ([#371](https://github.com/marinvch/Cortex/issues/371))

Rituals run **inside a target repo**, where `index/` does not exist — the plugin lives in the plugin
cache. `skills/cortex-impact/SKILL.md` told the agent to run `node index/cortex-impact.mjs`, which
fails with `MODULE_NOT_FOUND` unless the agent silently substitutes an absolute path; one that does
not reports the ritual as broken.

The issue named one skill. There were **21 occurrences across five** — `cortex-impact`,
`cortex-review`, `diagnosing-bugs`, and `cortex-install` and `cortex-next`, both of which acquired
theirs earlier the same week. All now use `${CLAUDE_PLUGIN_ROOT}`, and `core/test/plugin.test.js`
fails on any skill that invokes an `index/`, `core/`, `mcp/` or `tools/` script by a bare path — the
lint the issue asked for, so this cannot come back. The README's plugin-facing commands are fixed
too, with its clone-only block labelled as such.

## [2.25.0] — 2026-08-23

### Added — TypeScript path aliases resolve, so modern repos stop reading as empty

`index/lib/imports.mjs` resolved relative specifiers and treated everything else as an external
package. On a modern TypeScript repo that is most of the graph. Measured on a real Next.js app:

| | before | after |
|---|---|---|
| resolved imports | 116 | **589** |
| orphans reported | 154 | **20** |
| layer depth | 4 | **11** |

428 of that repo's imports were written `@/components/…` against 104 relative ones. The index held
about a fifth of its edges, and **every consumer was confidently wrong** — the orphan finding named
134 files that are imported constantly, `/cortex-impact` under-reported blast radius on all of them,
`depth.mjs` flattened the architecture to four levels, and the viewer drew a scatter of unconnected
dots. Each output was correctly hedged and each was useless.

`tsconfig.json` / `jsconfig.json` `paths` and `baseUrl` are **declared**, exactly like `go.mod`'s
module path and `composer.json`'s PSR-4 prefixes, so reading them is not a guess. `build.mjs`
follows the `extends` chain — splitting options into a base config is the normal layout, and a
resolver that stops at `extends` sees nothing — and matches the nearest config per file, so a
monorepo package's own aliases beat the root's.

Two properties keep it honest. The alias pass runs **only after** the relative resolver returns
null, so it is strictly additive: a repo declaring nothing cannot get a different graph because of
it. And a bare specifier no alias claims stays external — resolving `react` to a local file because
a `baseUrl` sat above one would be worse than missing the edge.

`parseJsonc` handles what these files actually contain: `//` and `/* */` comments, which every
TypeScript generator writes, and the trailing comma a real config carried after its last `paths`
entry. Strings are respected, so a `//` inside a URL survives. Unparseable input returns `null` —
a config that cannot be read costs its aliases, never the run.

**Validated against six cloned and local repos**, not fixtures: across all of them, **every one of
the newly resolved targets exists on disk** — zero false edges — and the two with no `tsconfig`
produced byte-identical indexes to before. Nothing in the existing test suite could have found this
gap, which is the argument for the rule.

## [2.24.2] — 2026-08-23

### Fixed — the viewer crashed on the first repo that had an import cycle

`index.cycles` is `depth.cyclic`: a **flat list of the paths** sitting in a strongly connected
component, not a list of cycles. `buildGaps` read it as an array of arrays, so `c.map` threw and
blanked **every tab** — Map, Files, Areas, the sequence, all of it. The page loaded its chrome and
nothing else.

It survived review, unit tests and CI because this repo has zero import cycles and the fixture
passed `cycles: []`. The branch had never executed. It took pointing the tool at somebody else's
codebase to run it once — which is the whole reason
[the standing rule](AGENTS.md) is to validate `index/` against real repos rather than fixtures:
a fixture is written by the same person as the code, and it inherits their blind spots.

The count was also mislabelled. Three files in one cycle were reported as "3 cycles", which
disagreed with what `cortex-index` prints for the same repo — it says "3 files in import cycles".
Both now say the same thing. `tools/test/cortex-view.test.sh` grew a real two-file cycle in its git
fixture, so the branch runs on every CI job from here.

### Fixed — a dozen nodes all called `index.jsx`

On a React app the map drew twelve nodes reading `index.jsx`, every one a different component and
none of them identifiable. A basename is only a name when it is unique. Barrel and route files
(`index`, `main`, `mod`, `__init__`, `route`, `page`, `layout`) now carry their directory —
`Modal/index.jsx`, `Header/index.jsx` — which is what a developer calls them anyway. Ordinary files
keep their plain name.

## [2.24.1] — 2026-08-23

### Fixed — the page disagreed with itself between runs

`cortex-view` read "see the repo as a graph" off the filesystem while writing the very page that
step refers to. The first run therefore rendered a stale answer about itself, and a second run
produced different bytes from the same index — which breaks the determinism the rest of `index/`
promises, and makes the page undiffable. It now states the fact it is in the middle of making.
`readState` grew a narrow `overrides` seam for exactly this case: a caller mid-write that knows
something the filesystem does not have yet. It is not for assuming a step someone else must run.

### Added — CLI tests for the two CLIs that print instructions

`index/AGENTS.md` already set the standard: a CLI earns a shell test when its failure mode is a
confident wrong sentence rather than a crash, which is why `cortex-impact.mjs` has one. Both CLIs
added in 2.24.0 meet that bar and shipped without one.

`tools/test/cortex-next.test.sh` (24 assertions) and `tools/test/cortex-view.test.sh` (17) run
against real git fixtures. They defend the sentences, not the numbers: that a bare repo is told the
entry point by name, that an optional step never becomes "next", that a retired `.ai-os/` engine
outranks every finished step, that `/optimize-context` is offered before `/cortex-scaffold` no
matter which file was written first — and, for the viewer, that it refuses rather than rendering an
empty page, writes nothing outside `.cortex/`, leaves tracked files byte-identical, and emits a page
with no remote script. The determinism regression above is the assertion that caught it.

`cortex-next` also asserts the thing worth asserting about a read-only tool: run on a bare repo, it
leaves no `.cortex/` behind. That is the product's central claim, made executable.

## [2.24.0] — 2026-08-23

### Added — the sequence, and a picture of the repo

Cortex had an ordering problem, not a capability one. Every ritual knew its own job and none of them
knew what came after, so the honest answer to *"I installed the plugin, now what"* was a table of
eleven commands sorted by nothing. A user who ran `/cortex-install` was handed a menu and left to
guess which row applied to them — and the one row that had to come **before** `/cortex-scaffold`
(`/optimize-context`, on a repo that already had an `AGENTS.md`) was indistinguishable from the ten
that did not.

**`/cortex-next` answers it, from the filesystem rather than from memory.**

```
node index/cortex-next.mjs .          # the ordered runbook, ✓ / → / ·
node index/cortex-next.mjs . --line   # one line, for a footer
node index/cortex-next.mjs . --json   # for a ritual to walk
```

Every ✓ names its evidence — `.cortex/index/index.json`, a report under `.cortex/findings/`,
`CONTEXT.md`, a `<dir>/AGENTS.md`, a `SKILL.md` under `.claude/skills/`. A step nothing on disk can
settle is `optional`: it never becomes "next" and never blocks, so nothing is ever ticked silently.
This is a script and not a judgment call for the same reason the index is deterministic — the
sequence is a fact about the repository, and a model re-deriving it each session hands the user a
different answer every time they ask.

`cortex-index`, `cortex-findings` and `cortex-view` now end with the same `Next →` line, so the
order is never something you have to go back to the README to look up.

### Added — `cortex-view`: the repo as one offline page

The vault has had a force-graph viewer since v1, but `tools/cortex.sh` walks vault folders and
follows `[[wikilinks]]`. Pointed at a codebase it found nothing and cheerfully wrote an empty graph.
This is the codebase half:

```
node index/cortex-view.mjs .     # writes .cortex/view/repo.html and opens it
```

One self-contained page — no server, no CDN, no runtime, data inlined, works offline. **Next steps**
(the sequence above, with this repo's position), **Map** (files coloured by area, laid out by import
depth so it reads top-down rather than as a hairball), **Files** (who imports it, what it imports,
both clickable), **Areas**, **Gaps** (orphans, cycles, busiest untested code).

Three things it deliberately does not do. It does not draw markdown or config: they have no imports,
and on this repo 171 isolated nodes pushed the 98 connected ones off screen. It does not call an
orphan dead — regex import resolution makes dynamic imports invisible, so every row is a question.
And it does not invent a coverage number: it reuses `lib/coverage.mjs`, so a file exercised only
through a subprocess reads as untested, which is the safe direction to be wrong in.

It follows the viewer's system theme and renders at device resolution.

## [2.23.0] — 2026-08-22

### Added — `--citations`: drift without a diff
`/cortex-review` has always had a Drift axis: *did this change make one of these documents wrong?*
It is change-triggered, and that turns out to make it **structurally blind to the second of the two
failures its own header cites**:

> `AGENTS.md` pointed at `mcp/lib/scrub.js` for months after scrub moved to `core/`

The stale pass seeds only on files a diff touched. Once `mcp/lib/scrub.js` stopped existing, no diff
could ever touch it, so the document naming it was never flagged. The tool could not see the example
it was built for — and neither could anything else, which is the state of every repo that installed
Cortex and then shipped for six months without running a review. Documents do not rot from one
change; they rot from a hundred, each of which individually looked fine.

A citation that no longer resolves is provable staleness, and it needs neither a diff nor a model.

```
node index/cortex-review.mjs --citations              # the whole layer, no diff
node index/cortex-review.mjs --citations --since HEAD~20  # the CI gate
node index/cortex-review.mjs --citations --fix        # a patch for the provable ones
```

**Three classes, because "wrong" is a claim the tool mostly cannot make:**

| Class | Means | Gate |
|---|---|---|
| `provable` | The path is gone and **git recorded where it went** | fails |
| `suspected` | The path is gone and nothing proves a destination | reports |
| `historical` | An ADR, or prose stating an absence ("…is deleted") — correct as written | reports |

Only `provable` exits non-zero, which is what makes it safe in CI. An ADR *should* name retired
files; a check that fails a build over accurate prose gets switched off, and then nothing is checked
at all.

`--fix` emits a unified diff on stdout and **writes nothing** — `index/` may not modify a target repo
outside `.cortex/`, and `cortex-review.mjs` promises in its header that it writes nothing at all.
That is what "self-heal" reduces to once you refuse to guess: a small, provable subset, proposed in
a form a human can reject in one command.

### Fixed — what running it on a real repo taught, twice
Both numbers below come from pointing the checker at this repository, not at fixtures.

**Resolution is doc-relative first.** `mcp/AGENTS.md` saying `` `lib/resolve.js` `` means
`mcp/lib/resolve.js`. Resolving only against the root reported 27 findings where 7 were plausible.

**A slash is not enough to make a token a path.** The first working implementation returned **157**
findings on this repo and almost none were drift: forty ritual names (`/cortex-audit`), JSON-RPC
methods (`tools/call`), repo slugs (`marinvch/Cortex`), bare directory names. Two rules — a
repo-relative path never starts with `/`, and its last segment carries an extension — brought it to
7, the same seven the design predicted. `../` in a markdown link is now resolved too; it was
reporting `mcp/AGENTS.md`'s own ADR links as dangling.

Not one of these showed up in tests written from literals. Real prose was the only thing that
surfaced them, which is now written into `index/AGENTS.md` as a rule for the next change here.

### Not covered, on purpose
It checks **pointers, not sentences**. `index/AGENTS.md` saying "Coverage uses two signals" while the
code used three is real drift and invisible here — the path was never wrong. Catching that needs a
model reading prose against code, which the ritual may do over this candidate list. The CLI must not:
a deterministic tool that claims to find *all* drift is worse than one that states where it stops.

## [2.22.2] — 2026-08-22

### Added — the index says what a guessed skip cost it
[2.22.1](#2221--2026-08-22) stopped `bin/` from overruling git, which fixes the common case. But a
guess remains a guess: an untracked file under `bin/`, or any repo with no git to ask, is still
dropped on the strength of a directory name. That was the expensive half of
[#360](https://github.com/marinvch/Cortex/issues/360) — not that the number was wrong, but that it
*looked complete*. Every other number the indexer prints describes what it found; there was none
for what it did not.

`listFiles` now returns `{ files, skipped }`, the index carries `stats.skipped`, and `cortex-index`
prints one line when there is anything to print:

```
Indexed 1 files (2 lines), 0 imports, 0 tests
Skipped by name: 1 file under bin/ — git-tracked files there are indexed as source
```

The line disappears once git can answer, so a repo where `bin/` genuinely is build output pays a
single line and a repo where it is not is told what to do about it.

Two limits on the count, both deliberate, because a number nobody can act on buries the one they
can:

- **Only ambiguous names.** `node_modules/` is not a guess, so it is not a gap — and walking it to
  produce a count would cost more than the index does.
- **Only measured files.** A path is counted only if it was read as text under the size limit, so
  the number means *readable source you cannot see* rather than compiled output. Otherwise it would
  be loudest in exactly the repos where the skip was right.

`walkFiles` now descends into an ambiguous directory and drops per file rather than pruning at the
directory, so the git and non-git paths produce the same count. Certain names are still pruned where
they were.

`index/test/walk.test.mjs` gains the four halves of this: that a guess is counted, that a certainty
is not, that the non-git case is covered, and that a compiled artefact never counts as hidden
source. `build.test.mjs` and `cli.test.mjs` cover `stats.skipped` and the printed line.

## [2.22.1] — 2026-08-22

### Fixed — `bin/` hid a repo's source, and shell tests did not count as tests
Two reports from a homelab install ([#360](https://github.com/marinvch/Cortex/issues/360),
[#361](https://github.com/marinvch/Cortex/issues/361)), both in `index/`, both silent.

**`bin/` and `obj/` were skipped by name, overruling git.** `CODE_SKIP_DIRS` treated them as build
output unconditionally, so every file inside vanished from the index even when git tracked it — and
the run printed a file count with no hint that anything was missing. The reporter's ops repo lost 12
of its 38 files; `cortex-findings`, `cortex-review` and `cortex-impact` all then reasoned about a
repo with a third of its code absent.

The two names now live in `AMBIGUOUS_SKIP_DIRS`, resolved by asking git rather than by guessing from
the name: a **tracked** file under `bin/` is source, an untracked one is still output. That is the
same principle the file already opened with — "which files belong to a repository is a question git
already answers" — applied to the one place it had been excepted. Outside a git repo the name is
still all the evidence there is, so nothing changes there. The set stays at those two on purpose:
`node_modules/` is committed in plenty of repos and must never be indexed.

Against two real repos, the files this was hiding are the ones that matter most:

| repo | recovered |
|---|---|
| `tj/n` | `bin/n` — the entire program — plus `bin/dev/release` and `test/bin/run-all-tests` |
| `bats-core` | `bin/bats` — the tool's entry point |

`test/bin/run-all-tests` shows the second half of the bug: the skip matched `bin` at *any* depth, so
it also swallowed directories that merely had one inside them.

**`test-*.sh` was not recognised as a test, which produced a false High finding.** `TEST_PATTERNS`
knew `test_*.py` (pytest's underscore) but not the hyphenated form that shell and ops repos have
used for decades — `test-foo.sh` beside `foo.sh`. A repo with a passing 17-assertion suite was told
"No test files found", ranked **High**, as the first thing in its report. A false High is worse than
a wrong count: it teaches the reader to discount everything under it. `*.bats` was unmatched too.

The hyphenated prefix is now recognised for `sh`, `bash`, `zsh` and `py`, and `.bats` outright.
Deliberately not for `ts`/`js`: `src/test-utils.ts` is a helper, not a test.

### Added
- `index/test/walk.test.mjs` — the walker had no test file of its own. Covers the tracked-file
  override, the untracked file that must still be skipped, `node_modules/` staying out even when
  committed, and the non-git fallback.

## [2.22.0] — 2026-08-19

### Added — `/diagnosing-bugs`, ported and given the repo's map
The last unharvested skill from [mattpocock/skills](https://github.com/mattpocock/skills) that fit
Cortex. Phases 1–6 are upstream and sound: **build a red-capable feedback loop before forming any
theory**, reproduce, minimise, generate 3–5 falsifiable hypotheses before testing one, instrument
one variable at a time, fix with a regression test, clean up.

Three additions, and each is only possible because the repo has an index and a context layer:

- **Phase 0 — orient before guessing.** `cortex-impact` gives the blast radius and, more usefully,
  *which of it no test covers* — a bug lives disproportionately in code nothing exercises, and the
  uncovered dependent is where the Phase 5 regression test belongs. `cortex-review` gives the
  documents that govern the suspect, which frequently *state* the bug outright: "the raw body is
  required for signature verification". `index.layers` places it — a depth-0 failure implicates
  everything above it; an entry point usually does not implicate the kernel.
- **A violated invariant outranks a hunch.** Phase 3 ranks anything Phase 0 surfaced near the top,
  because it is the only class of hypothesis that arrives with written evidence behind it.
- **The regression test must fail for the right reason.** Upstream says *watch it fail*; that is not
  enough. A test failing for an unrelated reason goes green on the fix and proves nothing. This repo
  shipped four such assertions in a single week and found every one by making the code wrong on
  purpose. Phase 6 also asks that a bug caused by a stale document gets the document fixed — that
  one recurs otherwise.

`capability: judgment`. Phase 0 is skipped when the repo has no `.cortex/` index; the rest works
anywhere.

`/diagnosing-bugs` and `/cortex-review` both read the context layer and are **not**
interchangeable: review judges a *change* you already made, diagnosis hunts a *symptom* you cannot
explain. Phase 0 is where the second borrows the first's evidence.

## [2.21.0] — 2026-08-19

### Fixed — `index.layers` was a list of directories
It grouped files by top-level folder, so `.github`, `agents` and `docs` were reported as
architectural strata. The CLI printed *"Areas: 23"* and the findings report said *"23 structural
areas"* — only the field name still claimed to be layering, and anything reading `index.layers`
for structure got folders.

It is `index.areas` now, from `inferAreas`. Same data, honest name.

### Added — real layering, from the import graph
`index.layers` now means what it says: depth 0 imports nothing inside the repo, depth *n* is one
more than the deepest in-repo file it imports. Every file carries `depth`, and `index.cycles` lists
files with no order among themselves.

This needed trustworthy edges across every language, which arrived in 2.18.0 — it was not
computable before.

It reproduces this repo's documented architecture without being told it: `core` avg depth 0.50,
`index` 0.90, `mcp` 1.45 — the `core/ ← index/ + mcp/` that `AGENTS.md` claims and
`core/test/architecture.test.js` enforces by hand.

**Cycles are condensed, not skipped.** The first version memoised a depth-first walk and skipped
back-edges: correct on a DAG, quietly wrong everywhere else, because a node finalised while a
dependency was still on the stack keeps a depth computed without it and every dependent compounds
the error. On gson that produced **fourteen levels with ninety-nine files sharing the deepest** — a
number that looks like architecture and is arithmetic noise. Tarjan for strongly-connected
components, then longest path over the condensation, gives gson seven levels and 31 files in
cycles.

An earlier draft also marked everything *downstream* of a cycle as cyclic, which on a Java repo —
where mutually-referencing classes are ordinary — swallowed 163 of 313 files. Only the members of a
cycle are in it.

Documentation is excluded: a markdown file imports nothing and sat at depth 0 beside the kernel,
which put 238 documents into "the foundation" and buried the handful actually there.

Both numbers are printed by `cortex-index`, because a reader shown only one will assume it is the
other — which is exactly what the old field name did.

### Tests
11 added and mutation-tested. One mutation was **missed and should have been**: removing the
self-edge filter changes nothing, because the condensation already drops edges inside a component.
The guard is defensive rather than load-bearing, and the test now says so instead of implying it
protects something.

## [2.20.0] — 2026-08-19

### Added — `/cortex-review`: the context layer gets read back
Cortex writes `AGENTS.md`, `CONTEXT.md` and ADRs. Nothing ever **read them back**. The context
layer could be generated, and audited for bloat by `/optimize-context`, and never once consulted
to judge a change — which made it write-only, and left the whole product one-directional.

Two axes:

- **Standards** — does the change break a rule this repo has *written down*? Quoted, with
  `file:line`. A finding that cannot cite the document it rests on is an opinion, and is labelled
  as one.
- **Drift** — did the change just make one of those documents **wrong**? This is the half no other
  review tool looks for, and this repo has shipped the failure twice: `index/AGENTS.md` said
  *"Coverage uses two signals"* for weeks after it used three, and the root pointed at
  `mcp/lib/scrub.js` months after scrub moved to `core/`. Neither broke a test. Both misled the
  next agent that read them — the entire cost of a context layer being wrong rather than absent.

`node index/cortex-review.mjs --staged | --since REF | <paths> [--json]` is the deterministic
evidence pass: governing briefs nearest-scope-first, glossary terms, and every document that names
something the change touched. It finds and cites; it never judges. The ritual does the judging, at
the `judgment` capability floor.

Three rules earn their keep, each found by running it rather than reasoning about it:

- **The nearest brief first, and the root always too.** A review reading only the leaf misses the
  repo-wide invariants. Sorting on the display label (`"(repo root)"`, eleven characters) put the
  root ahead of every leaf — the exact opposite of the stated order.
- **A shim is not a third authority.** `CLAUDE.md` and `GEMINI.md` hold one line, `@AGENTS.md`.
- **A basename is evidence only when it identifies one file.** `coverage.mjs` occurs once, so a
  document naming it means that file. `AGENTS.md` occurs in every package — matching it flagged
  twenty documents the moment the root brief was edited. Length cannot see that; the index can.

A repo with no context layer is told so, and pointed at `/cortex-install`. Improvising a review
from general principles is how a tool that claims to check *documented* rules starts inventing
them.

### Tests
14 unit and 16 CLI. The module was **mutation-tested** — all six rules deleted in turn, each
caught. One CLI assertion was **vacuous on first writing**: it matched the phrase "two signals",
which also appears in the tool's own cautionary footer, so it passed with the quoted line removed
from the output entirely. It now asserts the rendered `:3  <text>` form.

## [2.19.0] — 2026-08-19

### Fixed — the secrets finding cried wolf on well-maintained repositories
Run against six respected open-source projects, **four came back with a `critical` secrets
finding, and not one was a leak**:

| repo | matched | what it actually was |
|---|---|---|
| gson | `token="$next-version$"` | a Maven antrun placeholder |
| sinatra | `secret: 'CHANGEME…'` | a commented-out example in Rack's own docs |
| requests | `http://{}:{}@{}:9000` | a Python format template |
| gin, requests | `tests/certs/*.key` | test certificates |

Severity is control flow ([ADR 0006](docs/adr/0006-the-report-is-the-wizards-script.md)) — the
wizard walks `offers()` top-down — so **the first question Cortex asked a new user was a false
alarm**. A tool that cries wolf on four of six respected repos teaches people to skip the section,
and then it fails on the one that matters.

Two rules, in `core/scrub.js` and `index/lib/findings.mjs`:

- **A placeholder standing in for a credential is not a credential.** `${VAR}`, `{{var}}`, `{}`,
  `$name$`, `<your-key>`, `process.env.X`, `CHANGEME`. This is not a loosening of the gate: there
  is no secret in a reference to protect.
- **A match only under a test or fixture path reports `medium`, not `critical`**, with wording that
  says where it came from. A test certificate is a real private key and belongs in the report; it
  is not the thing to deal with first. One match outside a test path and the finding is critical
  again, so this cannot be used to hide a leak by filing it under `tests/`.

All six repos now open the interview with `scaffold`, the question actually worth asking first.

### Fixed — the scanner flagged its own documentation
Writing those examples as literals set the scanner off against `core/scrub.js` itself. They are
prose now: a file that must never hold credentials should not need an exemption marker to describe
them, and reaching for the marker by reflex is how a real finding gets buried later.

### Tests
Four added, **mutation-tested in both directions** — the placeholder rule disabled *and* inverted,
the severity rule removed *and* over-applied. Each mutation fails a different test, so neither rule
can silently stop working or start swallowing real leaks.

## [2.18.0] — 2026-08-19

Ruby, PHP and Java had *no import extraction at all* — not a resolution gap, an absent case in the
switch. And `UNRESOLVED_LANGUAGES` had never named them, so all three reported blindness as
absence. Measured against `sinatra/sinatra`, `slimphp/Slim` and `google/gson`:

| repo | language | edges | unreferenced |
|---|---|---|---|
| gson | Java | 0 → **1018** | 122 → 15 |
| Slim | PHP | 0 → **305** | 72 → 7 |
| sinatra | Ruby | 0 → **109** | 56 → **0** |

`/cortex-impact` on `Gson.java` — the library's central class — reported *"Nothing in the index
imports these"*. It now reports **124 affected files**.

### Added — Java, PHP and Ruby imports resolve

- **Java.** A package is a directory, so `import com.google.gson.internal.Excluder` is
  `com/google/gson/internal/Excluder.java` beneath a `src/main/java`-style root. Roots are matched
  longest-first, because a multi-module build has one per module and the same package path can
  exist under two. `import static a.b.C.member` names a member, so the path shortens until it lands
  on a file.
- **PHP.** PSR-4 maps a namespace prefix to a directory and `composer.json` declares it — read, not
  guessed, for the same reason Go reads `go.mod`. Longest prefix wins, so a specific namespace beats
  the umbrella one. `autoload-dev` counts too.
- **Ruby.** `require_relative 'x'` is path-relative; `require 'sinatra/base'` searches the load path,
  which for a gem is its `lib/`. Extraction tags the relative form so the resolver never has to
  guess which one a line meant. A repo shipping several gems has several load paths — sinatra
  carries three.

Every candidate must exist in the index, so a wrong reading yields no edge rather than an invented
one. Third-party namespaces (`java.util`, `Psr\Http`, the `rack` gem) resolve to nothing, correctly.

**A stated limit:** Java classes in the *same package* need no import, so a class used only within
its own package still shows as unreferenced. Resolving that means resolving unqualified type names,
which needs a parser — ruled out by [ADR 0004](docs/adr/0004-no-runtime-dependencies.md). Most of
gson's fifteen remaining orphans are that, plus `package-info.java` files and build-time templates.

### Fixed — a language with a framework row but no language row
`rails`, `laravel`, `django` and `flask` were signals; Ruby, PHP, Java and Python were not. A
Sinatra app is not Rails and a Maven project is neither, so all four reported **no language at
all** — and the skills chosen from an empty stack are the generic ones.

Java is asserted from either build tool, since a Gradle project has no `pom.xml` and is no less
Java for it.

### Fixed — the reported manifest list had drifted from the manifest specs
It is a second regex rather than something derived from `SIGNALS`, and it never learned about Maven
or Gradle: gson detected Java *from* `pom.xml` while reporting zero manifests. It now lists all
eight of gson's modules.

### Tests
Ten added, and the resolvers were **mutation-tested** — each rule deleted in turn to confirm
something failed. No regression across the other four repositories: gin holds at 248 edges, ripgrep
at 119, requests at 98, Cortex itself at 93.

## [2.17.0] — 2026-08-19

### Added — Rust imports resolve
2.16.0 taught the reports to say *"Cortex cannot resolve rust imports"* rather than *"nothing
depends on this"*. Saying it honestly was the floor, not the goal.

`resolveRustImport` handles `mod x;` and `use crate::a::b`, measured against `BurntSushi/ripgrep`:
**0 edges → 119**, and **92% of extracted specifiers resolve**. The remainder are inline
`#[cfg(test)] mod tests { … }` blocks, which have no file to point at — an honest ceiling rather
than a gap.

Three rules carry it, each found by pointing it at a real workspace rather than reasoned out:

- **A crate root owns its own directory.** `mod color;` in `src/lib.rs` means `src/color.rs`; the
  same line in `src/printer.rs` means `src/printer/color.rs`. The same holds for a nested `mod.rs`,
  which is where getting it wrong does damage — the crate-root fallback silently returns the wrong
  file rather than nothing.
- **`crate::` means the crate the FILE is in, not the workspace.** Roots are derived from where
  `lib.rs`/`main.rs` actually sit, not from `Cargo.toml` + `/src`: ripgrep keeps its binary crate in
  `crates/core/main.rs` with no `src/` at all, and the manifest-derived guess missed a third of the
  workspace. Longest match wins.
- **A file directly in `tests/`, `benches/`, `examples/` or `src/bin/` is its own crate root**, since
  cargo compiles each as a separate binary. Without this every integration test's helper module
  resolved to nothing.

A use path is tried longest-first and shortened, because `use crate::json::Printer` names a type
inside `json.rs` — only the filesystem knows where the module stops and the item begins. Every
candidate must exist in the index, so a wrong reading yields no edge rather than an invented one.

`UNRESOLVED_LANGUAGES` is now empty and stays in place. The distinction is the point: a language
listed there that does resolve suppresses a real graph, and one missing that does not resolve
reports blindness as absence. Both fail silently, so a test pins both directions.

### Fixed — `pub mod x;` was never extracted
The pattern matched bare `mod x;` only, so it missed precisely the public surface of every library
crate. Three of ripgrep's `ignore` modules were reported unreferenced while `lib.rs` declared them
one line away from ones that resolved fine. `pub(crate) mod` too.

ripgrep's unreferenced list: **59 → 8**. What remains is `build.rs`, benches, examples, fuzz targets
and a facade crate — all genuinely imported by nothing.

### Tests
Seven added, and the suite was **mutation-tested** rather than assumed. One rule — the crate-root
module directory — could be deleted with nothing failing, because the fallback rescued the only case
under test. The fix was a fixture where both candidate files exist, so the fallback returns the
*wrong* one instead of nothing. No regression elsewhere: gin holds at 248 edges, requests at 98,
Cortex itself at 93.

## [2.16.0] — 2026-08-19

The Go, Rust and Python signal rows had only ever been exercised by fixtures written by whoever
wrote the test. Pointed at three real repositories — `gin-gonic/gin`, `BurntSushi/ripgrep` and
`psf/requests` — two of them produced an empty import graph, and everything downstream reported
that emptiness as fact.

**gin: 130 files, 0 edges.** `/cortex-impact` on a file the whole framework depends on printed
*"Nothing in the index imports these"*. The orphan finding called **59 of 130 files** unreferenced.
Both outputs carried their honest hedge and both were useless.

### Added — Go imports resolve
A Go import names a *package*, and a package is a directory, so one specifier resolves to many
files — the only language here that does. `resolveGoImport` reads the module path from `go.mod`,
strips it to get a directory, and maps that to the non-test `.go` files in it. Manifest-driven and
deterministic, like the rest of the index.

Imports outside the module stay external. `net/http` is a real dependency but not a file in this
repo, and an invented edge is indistinguishable from a true one for every consumer of the graph.
The module boundary is checked on a path separator, not a string prefix: `github.com/x/y-extra` is
not `github.com/x/y`.

**gin now indexes 248 edges.** `/cortex-impact` reports 16 affected files with correct depths, and
the orphan finding reports none.

### Fixed — Cortex said "nothing depends on this" when it meant "I did not look"
Rust still resolves through a module system Cortex does not model. That was already documented in
`imports.mjs`; what was not handled is what the reports do with it. Every Rust file was an orphan
by construction, and `/cortex-impact` reported no dependents for all of them.

`UNRESOLVED_LANGUAGES` now names those languages so consumers can tell blindness from absence:

- the orphan finding **excludes** them, and a separate finding says the graph does not cover them —
  a quietly missing finding is indistinguishable from a clean bill of health
- `/cortex-impact` prints *"Cortex cannot resolve rust imports, so it has no graph for these files.
  This is not 'nothing depends on them' — it is 'Cortex did not look'."*

On ripgrep the unreferenced list went from **59 files to one** — a Homebrew formula that genuinely
is not imported.

Also fixed: that finding read *"1 file appear unreferenced"*, visible only once the count dropped
to one.

### Tests
Four added. One was **vacuous on first writing** — the module-boundary assertion passed even with
the boundary check removed, because a loose prefix match sliced out a directory name that happened
not to exist. It now uses a directory the loose match would find, and fails when the check is
removed. Every new assertion was verified by planting a regression.

## [2.15.0] — 2026-08-19

Found by pointing Cortex at two repositories on stacks it had never been tuned on — a mobile app,
and a monorepo whose manifests live in subdirectories. Both passes were read-only: the index went
to a temp file via `--out`, and neither target was left with a `.cortex/`.

The monorepo passed cleanly, which is the more reassuring half. Cortex read all four nested
`package.json` files, and reported Express, React, Mongoose, TypeScript and GitHub Actions with a
correct evidence sentence for each. Nothing about that stack had been anticipated.

### Added — React Native and Expo are detected
The mobile app reported as `react`, full stop. Every skill proposed from that stack described a
website, and nothing in the report hinted the answer was wrong — the failure `stack.mjs` warns
about in its own header comment, reached from the outside for the first time.

They are two rows, not one. A bare React Native app is not an Expo app — different build, different
router, different commands — and collapsing them would put an `npx expo` instruction in front of
someone with no `expo` CLI. A test pins that a bare RN app is *not* called an Expo app.

### Fixed — a repo with a test runner and no tests fell between two candidates
`write-first-test` required that *no* runner be declared; `add-test` fired whenever one was,
regardless of whether a single test existed. A repo with jest in `devDependencies` and zero test
files landed in the gap and was told **"jest already set up — new work should extend it, not invent
a second way"**, when there was no convention to extend. That is `create-expo-app`, CRA, and most
starters — not an edge case.

Zero tests is now the whole trigger for `write-first-test`, and `add-test` requires a runner *and*
an existing test to read the convention off.

The offer had to become honest rather than merely present. Its old title — *Set up a test runner and
write the first real test* — is visibly wrong to someone whose manifest already names one, and a
report wrong on the part a reader can check is not trusted on the parts they cannot. That is exactly
why the previous test forbade the offer here. It is now titled *Get a real test running for the first
time*, true either way, with the evidence sentence naming which case the repo is in: "jest is in a
manifest but no test file exists — the runner is installed, not used".

### Tests
Two added, both verified non-vacuous by planting regressions. The revised test pins the *wording* of
the offer rather than its absence, and carries the old assertion's reasoning so the next person to
widen a candidate knows what the constraint was protecting.

## [2.14.0] — 2026-08-19

### Added — `/cortex-impact`: what breaks if this changes
The index has carried import edges since the first version, and everything read them forwards:
*what does this file import*. Nobody asks that. The question before touching a file is the reverse
one — **who depends on me, and is any of it tested?** Nothing could answer it.

`node index/cortex-impact.mjs <paths|--staged|--since REF>` walks the graph backwards and prints the
blast radius nearest-first: hop count, whether a test exercises each file, and churn as the tiebreak
within a depth. Three sections carry the answer — paths the index does not know (reported, never
dropped: a typo contributing nothing reads as *nothing depends on this*), files no test exercises,
and the tests worth running. `--json` for a ritual to walk, `--depth N` to bound an enormous radius.

Deterministic per `index/AGENTS.md` — no LLM, no network, no clock — so it sits in the `mechanical`
capability tier and runs on any model, or none.

**Every number is a floor.** Import resolution is regex-based ([ADR 0004](docs/adr/0004-no-runtime-dependencies.md)
rules out a parser, since a plugin install clones the repo and runs no build), so dynamic and
computed imports are invisible. The field is `atLeast`, there is no `total`, and no flag turns it
into one: "3 files affected" when the truth is 5 invites a reader to stop looking; "at least 3"
does not. An empty radius prints *a floor, not a proof* — an entry point or a dynamically loaded
module looks exactly like dead code here.

### Changed — coverage detection has one home
`index/lib/coverage.mjs`, extracted from `findings.mjs` where the three-signal heuristic (name ·
import · string-mention) was computed inline. Impact needs the same answer, and a second copy would
agree today and disagree in a month with nothing to say which was right. Behaviour is unchanged —
all 41 findings tests pass against the extracted module.

### Tests
`index/test/impact.test.mjs` (15) covers the reverse walk, cycles, depth ordering, the churn
tiebreak, unknown-path reporting and output stability. `tools/test/cortex-impact.test.sh` (20)
covers the CLI against a real git fixture, and most of its assertions defend a *sentence* rather
than a number — the failure mode here is a confident total, not a crash. Both were verified
non-vacuous by planting regressions.

## [2.13.0] — 2026-08-19

### Added — every ritual declares what it needs from the setup running it
Cortex names self-hosted and own-LLM setups as an audience ([ADR 0008](docs/adr/0008-three-audiences-one-seam.md))
and gave them nothing to consult. A ritual that needs multi-round judgment looked exactly like one
that appends a line to a file.

The failure this closes is not a crash. A weak model runs `/cortex-enrich`, writes plausible-but-wrong
summaries for every file, and those summaries feed `recall` — so it is not a bad answer once, it is a
bad answer **every time anyone searches**, and nothing announces it.

- **`capability:` frontmatter on all 34 rituals** — `mechanical` (12), `judgment` (16), `strong` (6).
  Assigned by asking one question each: what happens on a small model? "Still works" is mechanical;
  "produces something plausible and wrong" is judgment, because plausible-and-wrong is the failure
  nobody notices.
- **`node tools/cortex-capability.mjs`** prints the table, filterable by tier. It reads the
  frontmatter rather than restating it, so the table cannot drift from the rituals it describes.
- **Every `strong` ritual carries a `## When the floor is not met` section** — a declared floor with
  no way under it is a wall. Each names a real alternative rather than "use a better model":
  `/level-up` → `/audit` (a fixed rubric instead of judgment); `/analyze-spec` → `/plan-feature`;
  `/improve-codebase-architecture` → the deterministic findings report; `/grilling` → the same
  interview conducted in writing, so the file carries the state the model cannot; `/cortex-audit` →
  run it with every finding treated as `[judgment]`, withdrawing the autonomy but keeping the scan;
  `/cortex-enrich` → **skip it**, because enrichment is additive by design and a missing one degrades
  Cortex to deterministic behaviour while a wrong one poisons it.
- **Two guards.** `core/test/plugin.test.js` asserts every skill declares a valid floor *in the
  frontmatter* — checked across all skills, not a named list, so a new ritual cannot ship undeclared —
  and that every `strong` one has its degraded section. `tools/test/capability-floor.test.sh` asserts
  the CLI that reads them, because a table nobody can print is a table nobody consults.

This was the last open item on the 2026-08-15 "big task" follow-on list, and it was blocked on the
ritual collapse in 2.9.0: a floor declared on both `/cortex-doctor` and `/cortex-audit` would have
described one job twice and hardened the duplication. Collapse first, declare second.

## [2.12.0] — 2026-08-19

### Added — a profile says which world an install serves
The employer firewall always opened by asserting *"one vault instance holds exactly one world"* — and
then hardcoded that world to *personal*. So a work machine could not say it was one, even though the
manual's own answer to work knowledge is "a separate vault instance on the work machine". And the
rule was prose everywhere and code nowhere: grepping `core/`, `index/` and `mcp/` for "firewall"
returned one hit, in an unrelated test.

- **`core/profile.js`** owns `home` · `work` · `lab`, declared with `CORTEX_PROFILE`.
  `home` (the default) refuses employer and client material. `work` is the same rule read from the
  other side — employer material is expected, personal notes are refused, because a private note in
  a work brain is the mirror of the leak `home` guards against. `lab` refuses nothing.
- **`lab` refusing nothing and publishing nothing is one decision, stored as one policy object.** A
  profile that refused nothing locally and still pushed would be a way to switch the firewall off and
  keep leaking. `mcp/lib/capture.js` still *writes* the team note — sealing must not lose work — and
  returns `pushed: false, error: "outward_sync_disabled"` instead of a silent success.
- **Declared, never detected.** A work laptop and a home laptop have the same shape on disk, so
  there is nothing honest to infer; the same reasoning that made `server` a declared audience in
  [ADR 0008](docs/adr/0008-three-audiences-one-seam.md). Inferring it from a hostname would be a
  guess about which secrets are safe to write down.
- **The default fails safe.** An undeclared work machine gets the strict-about-employer-content
  firewall — worst case, a refused write someone wanted. The opposite default would let an
  undeclared machine behave like a lab, which is a leak rather than an inconvenience.
- **An unknown value is fatal.** `CORTEX_PROFILE=works` exits 1 and names the valid set. Falling back
  quietly to `home` would look identical to a correct home install while the user believed the
  firewall pointed the other way.
- **`/cortex-profile`** reports and sets it, and is required to explain the consequence first — a
  profile decides what Cortex will refuse to write. It also names the mismatch worth catching:
  `work` left on a personal machine fills the brain with employer content on a box that may sync to
  a personal remote.
- The server's startup line now prints all three axes:
  `cortex: profile=home (default) audience=solo (...) mode=vault root=...`
- [ADR 0015](docs/adr/0015-a-profile-is-the-world-an-install-serves.md).

### Changed
- `AGENTS.md`'s firewall now says *which* profile it describes instead of asserting one world. It is
  still `home` for this instance, and the twelve ritual restatements are unchanged — detecting
  "employer content" deterministically is not possible, and pretending otherwise would be worse than
  the honest prose. What moved into code is the axis and the one enforceable consequence.

## [2.11.0] — 2026-08-19

### Added — skills chosen from the stack, not from a default list
Every repo used to get the same two skills. A Next.js app with Prisma and no tests got exactly what
a Rust CLI got, because nothing downstream of the index could tell them apart — the context layer
was tailored and the skills were not.

- **The index knows the stack now.** `index/lib/stack.mjs` detects runtime, frameworks, data layer,
  services, test runner and delivery from manifests and file paths — deterministic, per
  `index/AGENTS.md`: no network, no LLM, no clock. It reads dependency names as **keys**, so
  `next-auth` never implies Next.js and `flask-admin` never implies Flask.
  Two signal shapes, because the difference is load-bearing: a file can **confirm** a manifest hit
  (a Prisma dependency without a `schema.prisma` is someone else's schema, and an `/add-migration`
  skill pointing at it would be worse than no skill) or **stand alone** (a `tsconfig.json` is proof
  of TypeScript by itself, since framework-compiled repos never name the compiler).
- **`index/lib/skills.mjs` proposes from that stack** — declarative, the way `offers()` already is.
  Each candidate declares its own `when()` and an evidence sentence naming what was *detected*, so
  the set is enumerable without reading any bodies and a new stack is a row, not another branch.
  Rank is control flow: the ritual walks it top-down, as in
  [ADR 0006](docs/adr/0006-the-report-is-the-wizards-script.md).
- **`index/cortex-skills.mjs`** prints the proposal, or `--offers` for the JSON worklist. It writes
  **nothing at all**, not even under `.cortex/`.
- **`/cortex-skills`** presents the proposals with their evidence, the user picks each one, and the
  agent writes the bodies — because a useful body quotes this repo's real commands and real paths,
  and inventing those is exactly the failure a deterministic module cannot detect in itself.

On a real Next.js repo this now detects TypeScript · Next.js · React · Prisma · NextAuth · Stripe ·
Supabase and proposes six skills, each with its reason: a webhook skill because Stripe is a
dependency, a migration skill because the repo owns a Prisma schema, a first-test skill because it
has none.

### Fixed
- **A stackless index now proposes nothing instead of guessing.** An index written before stack
  detection has no `stack` key, and falling back to an empty one let candidates fire on `stats`
  alone — telling a repo with Vitest configured that it had "no test runner in any manifest", when
  nothing had read a manifest. Every candidate's evidence presumes detection ran; if it did not, the
  honest answer is to say so and re-index.

### Changed
- `/cortex-scaffold` now offers `/cortex-skills` alongside `/cortex-brief` as the next step, and says
  what it is for: the context layer it just wrote is tailored to the repo, and its skills are not.
- `tools/test/install-on-a-project.test.sh` asserts the whole chain end to end — index detects the
  stack, the proposal names the skills that stack implies, and the target repo is left untouched.
  The fixture gained a `tsconfig.json` and declares `@prisma/client` rather than the CLI, which is
  what a real Next.js repo looks like; both corrections came from the fixture failing and exposing
  genuine detection gaps.

## [2.10.1] — 2026-08-19

### Fixed
- **`/cortex-scaffold` could skip a file it was told to write, and report success.** Step 3 lists
  the files as bullets, and a bulleted list is easy to half-complete — the second shim is the one
  that goes missing, because writing the first satisfies the feeling of having written the shims.
  Observed on a real install: `CLAUDE.md` was written and `GEMINI.md` was not. Nothing errored.
  A missing shim fails silently and forever — that agent reads no context, and the gap only ever
  surfaces as it being inexplicably worse in that repo.
  Step 4 verified placeholders, commands and paths, but never that the files it had just been told
  to write existed. It now runs an explicit existence check over the whole list, and anything
  MISSING is written or named to the user as deliberately skipped.

### Changed
- **`archives/` holds one lifecycle now: your vault's, ignored in full.** It used to hold two — the
  product's own retired pieces (the Node installer, the engine-era framework docs, the old view
  scripts, the stale-engine prompts) sat next to personal removals, so the ignore rules needed six
  lines and two negations to say which half was shareable. Every negation is a chance to get it
  backwards, and getting it backwards *in this folder* means committing something that was archived
  to keep it private. The rules are now `archives/*` plus `!archives/README.md`.
- **The product half moved to `docs/history/`**, with a README saying what each retired piece was
  and what replaced it. `.cortexignore` already excludes `docs/`, so none of it is loaded as
  knowledge — retired instructions should not come back through recall as if they were current.
- **`tools/test/archives-is-personal.test.sh`** pins both halves: everything under `archives/` is
  ignored except the README, nothing but the README is tracked there, `docs/history/` is tracked and
  excluded from the graph, and no file still points at a pre-move path.

### Added
- **`tools/README.md` documents how to try Cortex on your own repo without letting it write
  anything** — `CORTEX_E2E_REPO=/path/to/your/repo bash tools/test/run.sh install-on-a-project`.
  It runs the real pipeline against your code and asserts your repo is left without a `.cortex/`.

### Fixed
- **A v1.0.0 changelog entry named a private repository.** Cortex is public, and developing it by
  testing against real repositories creates a standing temptation to write down what was learned in
  the terms it was learned in — which ties a named account to a private codebase. The entry now
  describes the shape and not the subject, and `tools/test/no-private-names.test.sh` keeps it that
  way: it fails if any tracked file names a known private project, or if a test hardcodes an
  absolute path to somebody’s repo instead of taking `CORTEX_E2E_REPO` at runtime.
- **`.gitignore` said "dated archive folders come from `/cortex-audit` and `/cortex-audit`."** A
  find-and-replace in 2.9.0 renamed both halves of "`/cortex-doctor` and `/cortex-audit`" when only
  one of them was the collapsed ritual. The line is rewritten as part of the change above.

## [2.10.0] — 2026-08-19

### Added — the version fact has one home
- **`tools/cortex-version.mjs` owns version propagation.** A release used to write the version by
  hand into seven files and verify it in four, so releasing was a memory exercise with a test that
  fired *after* the mistake — and two sites where it never fired at all. `VERSION` is now the
  interface and the rest are implementation:
  `node tools/cortex-version.mjs --set 2.10.0` stamps them all, a bare run checks for drift, and
  `--list` shows what each site holds. Adding a site is one entry in `SITES`, which **both** the
  writer and the checker read — a checker with its own private idea of where versions live is how
  four of seven sites came to be verified.
- **The `## [x.y.z]` changelog entry is checked, never generated.** A release entry says what
  changed and why, which no string substitution knows; `--set` refuses and names the missing
  heading. The link *reference* is fully derivable, so that one is generated — it was the site that
  got missed by hand, because a missing one breaks no build and renders as literal text.
- **`tools/test/version-sites.test.sh`** — the guard behind the generator, not instead of it. It
  fails a build whose sites disagree, and exercises the writer against a scratch repo via
  `CORTEX_VERSION_ROOT`, so the writer is never shipped having only ever been read.
- [ADR 0013](docs/adr/0013-the-version-has-one-home.md).

### Added — proof that Cortex works on somebody else's repo
- **`tools/test/install-on-a-project.test.sh`** runs the whole install pipeline — index → findings →
  the `--offers` worklist the wizard walks — against a repository shaped like real product code: a
  Next.js app with TypeScript, an api directory, generated Prisma output, committed `.env` files and
  no tests. Every other test in the suite points Cortex at fixtures shaped by the people who wrote
  the tests; this one asserts the product works, not just the parts.
  It **builds** that repo rather than pointing at a path on disk, so it runs on every machine. Set
  `CORTEX_E2E_REPO=<path>` to additionally run a read-only pass against a real project — that mode
  writes through `--out` and asserts the target repo is left without a `.cortex/`, which is
  `/cortex-install`'s promise made executable.

### Fixed
- **`core/package.json` read `2.2.0` while the product shipped `2.9.1`** — six releases behind,
  drifting in silence because nothing compared it to anything. It is in `SITES` now, so it cannot
  rot again. This was the exact failure `mcp/test/version.test.js` exists to prevent, occurring in
  the one site it does not cover.

### Decided
- [ADR 0014](docs/adr/0014-the-package-split-stays-rejected.md) — **Cortex is not being split into
  published packages.** [ADR 0001](docs/adr/0001-two-repos-not-two-packages.md) set the test ("the
  split is a directory boundary, not a distribution one") and
  [ADR 0004](docs/adr/0004-no-runtime-dependencies.md) settles it: a plugin install clones the repo
  and runs no `npm install`, so three manifests would be resolved by nobody. The rotted
  `core/package.json` above is the empirical version of the same argument — a manifest nobody
  resolves is a manifest nobody notices is wrong. Recorded so the next review stops here.

## [2.9.1] — 2026-08-19

### Fixed
- **`capture` filed notes under the UTC day, not yours.** `core/date.js` stamps local time;
  `mcp/server.js` carried its own clock — `new Date().toISOString().slice(0, 10)` — eleven lines
  below an import of `core/memory.js`, which stamps through `core/date.js`. A thought captured at
  01:00 in UTC+3 landed in `daily/2026-08-18.md` when the person filing it was living on the 19th.
  Demonstrated end-to-end through the MCP protocol at 03:59 UTC with `TZ=Pacific/Midway`: before the
  fix `capture` wrote `inbox/2026-08-19.md`, a day that timezone has not reached; after it, the
  `2026-08-18.md` the user is actually in. `server.js` was the **only** UTC clock in the repository —
  memory, findings and every shell tool already stamped local — so the fix is a deletion, not a
  choice between conventions.
- **Two shell scripts invented a date when `date` failed.** `|| echo 2026-07-01` wrote a hardcoded
  past day into every project stub's frontmatter, and `|| echo 0` set an epoch of zero that made
  `age_days` go negative, silently classifying every dormant repo as active — the inverse of the
  check it fed. Both are plausible wrong values a reader cannot spot. There is no system Cortex runs
  on without `date`, so the stamp is now a hard, named failure.

### Added
- **`core/date.js` has its first test.** It was the one `core/` module without one, which is how a
  second clock came to sit beside it unnoticed. The suite pins local-vs-UTC at both ends of the day,
  zero-padding, and the explicit-`Date` seam that keeps callers testable — with `TZ` fixed inside the
  test so it means the same thing on a UTC machine and a negative-offset one.
- **`mcp/test/one-clock.test.js`** scans `mcp/` for `new Date()`, `Date.now()` and `toISOString`, so a
  second clock fails the suite instead of shipping. Same shape as
  `mcp/test/vault-is-the-only-door.test.js`. The allowlist has one reasoned entry: `lib/noteid.js`
  uses an epoch as a collision-resistant id component, never as a calendar day.
- **`cortex_today`, `cortex_timestamp` and `cortex_epoch`** in `tools/_cortex-lib.sh` — the shell
  counterpart of `core/date.js`, used by `cortex-rm.sh` and `cortex-scan-projects.sh`.
- **`tools/test/date-parity.test.sh`** pins the two scripts that cannot source the lib.
  `cortex-init.sh` is a zero-dependency installer and `tools/server/cortex-cron.sh` lands on a server
  beside only `server-setup.sh`, so both keep their own `date` call and get the slugify treatment: a
  parity test comparing format strings (normalising `%F` against `%Y-%m-%d`) and refusing any new
  literal fallback. Shell tests: 107 → 118.
- [ADR 0012](docs/adr/0012-one-clock-per-language.md) — the wall clock is read in exactly one place
  per language, and two tests enforce it.

## [2.9.0] — 2026-08-19

### Changed — `/cortex-doctor` and `/scope-area` are gone
Four rituals covered two jobs. Typing either removed name now resolves to nothing; reach for
`/cortex-audit` and `/cortex-brief`, which absorbed them along with their trigger phrases.

- **`/cortex-doctor` → `/cortex-audit`.** The doctor scanned six categories. The `cortex-auditor`
  subagent that `/cortex-audit` dispatches scans the same six, plus employer-firewall breach, plus a
  content-health signal — the doctor's scan was a strict subset of the auditor's, and
  `/cortex-audit` already carried an inline fallback for when the subagent is unavailable, which is
  the doctor's whole remit. That fallback is now a real pointer: it names `agents/cortex-auditor.md`
  as the file to read and run, so the report comes out the same either way and only the context
  isolation is lost.
- **`/scope-area` → `/cortex-brief`.** Both wrote one `AGENTS.md` leaf into a critical directory and
  wired a root routing table; their rules were the same sentence written twice. The only real
  difference was where step 1 got its candidate, and `/cortex-brief` now has both entry points —
  ranked from the index, or a directory you name, which skips the ranking. It also picked up the
  three leaf conventions it lacked: a leaf points up to the root, a fact that moves into a leaf comes
  out of the root, and a leaf ships in the same PR as the code it covers.
- **The prose that told them apart is deleted, not rewritten.** Each sibling said "I am not my
  sibling" in its own body, again in the other's, and a third time in `AGENTS.md` — 33 lines of a
  file every agent loads on every run, and the second-most-churned file in the repo. Two ritual rows
  and three gotchas are gone from `AGENTS.md`, two rows from `README.md`.
- **`/audit` and `/reindex` were held to the same test and survived it.** Read-only scoring of
  content, mutating repair of structure, and rebuilding the graph are three jobs, not one. Three
  health rituals became two, not one.

### Fixed
- **`AGENTS.md` named four rituals as carrying `disable-model-invocation`; eight do.** The list was
  never updated as rituals were added, so a gotcha written to prevent an agent auto-firing a
  destructive ritual was silently describing half the set. It now names all eight and points at
  `grep -l disable-model-invocation skills/*/SKILL.md` as the list of record.

### Added
- [ADR 0011](docs/adr/0011-four-rituals-covered-two-jobs.md) records the decision, what survived it,
  and the test it establishes: when the prose separating two rituals grows longer than the
  difference it describes, they are one ritual.

## [2.8.1] — 2026-08-18

### Fixed
- **`cortex-vault-extract.sh` could delete the personal layer after an incomplete copy.** The script
  is careful by design — dry-run by default, `--apply` to copy, `--remove-source` as a separate
  opt-in, and a verification before anything is deleted. Its own header says why: *the personal layer
  is gitignored, so it exists only in your working tree, and a careless delete is unrecoverable.*

  The verification counted the wrong set. `copied=$(find "$DEST" -type f | wc -l)` counts
  **everything already in the destination**, not what this run copied. Verified: a destination
  holding 8 unrelated files reported `copied 10 files` for a 2-file move. A non-empty destination —
  what you have after a first attempt goes wrong — inflated the number enough for a partial copy to
  clear the `-lt "$total"` guard, and `--remove-source` would then delete the source.

  It now counts per planned path, comparing source and destination with the same
  `.gitkeep`/`README.md` exclusions the plan phase uses, and refuses to remove anything if any path
  is short — naming which. A test proves a copy that fails never reaches the delete.

### Added
- **Behavioural tests for `cortex-vault-extract.sh`** (21 assertions; 107 shell assertions total) —
  the last untested destructive tool. Pins that the dry run writes nothing, `--to` is required, it
  refuses outside the Cortex repo, an empty vault exits 0, `--apply` leaves the source in place, and
  `--remove-source` keeps the `.gitkeep` and `README.md` placeholders.

## [2.8.0] — 2026-08-18

### Fixed
- **`cortex-rm.sh` would archive a file from outside the vault.** Verified, not theorised:

  ```
  $ cd vault && bash tools/cortex-rm.sh ../outside/secret.md
  ✓ archived → archives/removed/secret.20260818-134621.md
  ```

  It did `ROOT="$(pwd)"` and then `[ -f "$ROOT/$F" ]`, which accepts `../` without complaint.
  ADR 0007 made `mcp/lib/vault.js` the only door onto a vault root for exactly this reason; **the
  bash half never got the same treatment.**

  Not remote-exploitable — it is a local CLI run with a path someone typed. It was worth fixing
  anyway because the tool cannot keep its own promise: it says *archive, don't delete* and prints
  "recover from `archives/removed/`", and for a file dragged in from outside, the original location
  is gone from the record. And because Cortex is driven by agents, which construct paths — "a person
  would not type that" is not a property of this codebase.

### Added
- **`resolve_in_root` in `tools/_cortex-lib.sh`** — the shell counterpart of `core/paths.js`. It
  lives in the shared lib, not in `cortex-rm.sh`, so the next destructive tool inherits the guard
  instead of re-deriving it; "five modules each had to remember" is the failure ADR 0007 was written
  about. Uses `cd` + `pwd -P` rather than `realpath` (absent on macOS by default, and ADR 0004 keeps
  this repo dependency-free), and walks up to the deepest existing ancestor so a target that does not
  exist yet still resolves. Not a string-prefix check: a symlink out of the root passes any prefix
  comparison and is still an escape. Recorded in
  [ADR 0010](docs/adr/0010-the-shell-half-gets-the-guard-too.md).
- **Behavioural tests for `cortex-rm.sh` and `cortex-sync-skills.sh`** (72 shell assertions total).
  Six `cortex-rm.sh` promises are pinned that never were: the note is moved rather than deleted,
  `[[slug|alias]]` becomes the alias, a bare `[[slug]]` becomes plain text, `archives/` is not
  rewritten, and **an unrelated link in the same file survives** — the de-link pass `sed -i`s every
  note containing the slug, so a greedy pattern would quietly damage the whole vault, and two links
  in two files would not catch it.

  For `cortex-sync-skills.sh`, the test that matters is that a **mirror-only** skill survives a full
  sync. `.claude/skills/` is gitignored, so deleting one is unrecoverable — which is exactly what
  nearly happened on 2026-08-17 to a skill a parallel session had written there and nowhere else.

  Checked and deliberately left alone: `cortex-vault-extract.sh` resolves its root from the script's
  own location, and `cortex-scan-projects.sh` only removes inside `$VAULT/projects/` under a
  slugified name, which cannot express a traversal segment. Adding a guard where there is no door is
  noise, and noise is how a real guard stops being noticed.

## [2.7.0] — 2026-08-18

### Added
- **`server-setup.sh` provisions the cron half.** It set up the git half of server mode and stopped;
  scheduling was a section of `references/living-cortex.md` a human copied by hand.

  `bash tools/server/server-setup.sh cron <clone-url> [work-dir]` clones the working brain, creates
  the env file, and **prints** the two crontab lines it recommends — changing nothing else. Re-run
  with `--install` to write them into a marked block (`# cortex-cron (managed)`) that replaces any
  previous one and leaves every other cron line untouched.

  **Printing is the default on purpose.** A crontab is user-global, easy to clobber and annoying to
  reconstruct, and people run setup scripts speculatively. This is the consent structure Cortex
  already uses (ADR 0005, ADR 0006) applied to a new surface: read and report, apply on request.

  The cron script path is resolved from `server-setup.sh`'s own location. The docs hardcoded
  `$HOME/ai-os`, which is wrong for anyone who cloned elsewhere — and a provisioning step that prints
  a path which does not exist is worse than one that prints nothing, because it looks finished.

### Fixed
- **The documentation told operators to put a live API key in their crontab.** The published example
  was `ANTHROPIC_API_KEY=sk-... bash cortex-cron.sh --daily` as a crontab line. `crontab -l` prints
  it — the one command anyone runs to check their schedule — and it is carried into any backup of
  `/var/spool/cron`. It also contradicted the rest of the repo, where `core/scrub.js` refuses a memory
  write carrying a credential and `/wizard` output is never committed with values baked in. **The
  docs were asking for exactly what the code refuses.**

  The key now lives in `${XDG_CONFIG_HOME:-$HOME/.config}/cortex/cron.env` at mode `0600`, which the
  crontab lines *source*. Created with `umask 077` rather than a `chmod` afterwards, so it is never
  briefly world-readable, and never overwritten if it already exists. `cortex-cron.sh`'s own usage
  comment stopped teaching the pattern too. Recorded in
  [ADR 0009](docs/adr/0009-provisioning-prints-before-it-installs.md).

## [2.6.1] — 2026-08-18

### Added
- **The shell half has behaviour tests.** `bash tools/test/run.sh` — a dependency-free harness
  (ADR 0004: no bats, no shellspec) that discovers `tools/test/*.test.sh` and runs each in its own
  subshell and temp directory. 43 assertions over `cortex-cron.sh` and `server-setup.sh`, wired into
  the existing `cortex-init test` workflow.

  CI already `bash -n`'d and shellchecked every script and ran `cortex-init.sh` end to end. What it
  had none of was **behaviour** for `tools/server/`, and that is where every bug below lived. Tests
  build real git repositories in temp directories — a bare repo on disk is a complete remote, so push
  and pull are exercised honestly with no network.

### Fixed
- **A broken AI summary is no longer silent.** A bad key, a retired model id or an unreachable
  network all produced a normal-looking digest, exit 0, and no warning. The deterministic fallback is
  the design working as intended — the *silence* was the defect, and it is how a nonexistent
  `CORTEX_MODEL` sat unnoticed. `cortex-cron.sh` now reports the failure on stderr, names the model,
  echoes part of the response, and states plainly that the run itself is fine. **The exit code stays
  0**: a failed optional summary must never fail the cron run, which would trade a silent bug for a
  loud regression. It also warns when `jq` is missing, since the response is then unparseable even on
  a successful call.
- **`server-setup.sh` died on an unset `$USER`.** Not guaranteed to be exported — absent under cron
  (which strips the environment), in minimal containers, and in Git Bash on Windows. Under `set -u`
  that killed the script one line before printing the clone URL, which is the entire reason anyone
  runs it, and *after* it had already created the repo. Falls back through `USERNAME` and `id -un`.
- **`server-setup.sh client` reported success while producing an unusable clone.** Its commit and
  push are both `|| true`, so on a machine with no git identity — a fresh server or container,
  exactly where it runs — the commit failed, no branch existed, the push failed, and it printed
  `ready` anyway. The MCP's pull/push would then fail later for a reason nobody could trace back. It
  now verifies the upstream exists, names `git config user.email` as the fix, and exits non-zero.
- **The test runner could not fail correctly.** Two bugs found while writing the first real test: a
  test file that died mid-way reported `0 passed, 0 failed` and exited 0 — a crashed suite looking
  exactly like a passing one — and `assert_exit` ended with a bare `set -e`, switching on a mode the
  runner had deliberately switched off, so the first non-zero command after any assertion killed the
  file. Both fixed before any test was trusted.

### Changed
- `cortex-cron.sh` accepts `CORTEX_API_URL`, so the API failure path is testable at all. A hardcoded
  endpoint cannot be exercised without the network; the test points at a closed local port.

## [2.6.0] — 2026-08-18

### Added
- **The three-audience resolver — the last open item of the big task.** Cortex claimed to serve solo
  developers, teams and self-hosted setups, and only solo was ever exercised. `/team-init`,
  `/team-add`, a connector file and `tools/server/` all existed; nothing tied them to the running
  brain.

  `mcp/lib/resolve.js` now answers where the brain is and who it serves —
  `resolveBrain({ cwd, env }) → { audience, root, team, teamClone, source }`. `server.js` resolves
  once at startup.

  **Solo and team are detected**, from a `.cortex/connector.json` found by walking **up** from the
  working directory — an agent runs in a subdirectory far more often than at a repo's top, and
  without the walk-up team mode silently degrades to solo. **Server is declared** with
  `CORTEX_AUDIENCE=server`, because it leaves no filesystem trace to detect: it is solo minus
  interactive prompts, plus a scheduler, plus a model that is not Claude Code. Declaring beats
  detecting, so a scheduled run inside a connected repo is still a server run.

  A malformed `connector.json` resolves to solo with `source: "unreadable:<path>"` rather than
  throwing. A brain that refuses to start because one JSON file is corrupt has turned a papercut
  into an outage.

  **The resolver never invents a root.** The three-mode spec described a fallback chain — connector,
  then `AI_OS_ROOT`, then a repo-local `.cortex/memory/` — and `mcp/AGENTS.md` forbids exactly that:
  an unset `AI_OS_ROOT` is a hard exit, because a guessed root can file a private note into a work
  repository. The invariant won; the fallback is recorded as a rejected alternative in
  [ADR 0008](docs/adr/0008-three-audiences-one-seam.md) so it is not re-proposed as an improvement.

### Changed
- **`capture` and `catch_me_up` stopped asking the caller which world it is in.** `team` was a tool
  *argument*, so the calling agent had to know it was on a team before it could act like one — the
  seam leaking in the one place the design says it must not. The team now comes from the resolution;
  a repo with a connector writes to the team brain without anyone asking. The argument survives as an
  explicit **override**, and its description says so.
- **`audience` is a third axis, not a rename of `mode`.** `mcp/lib/mode.js` owns repo-vs-vault;
  `resolve.js` owns solo/team/server. They are orthogonal — a repo-mode brain can run on a server, a
  vault-mode brain can belong to a team — and welding them into one word would guarantee a future bug
  where changing one silently changes the other. It also keeps `CORTEX_AUDIENCE` clear of the
  `CORTEX_MODEL` that `cortex-cron.sh` already reads.
- The startup line now reports `audience`, `source`, `mode` and `root` on **stderr** — never stdout,
  which is the MCP protocol channel where one stray line corrupts the stream for every client. A test
  parses every stdout line as JSON to keep it that way.

### Fixed
- **`tools/server/cortex-cron.sh` had a dead model id.** `CORTEX_MODEL` defaulted to
  `claude-sonnet-4-6`, which no longer exists. The API call is `curl … || true`, so this never
  aborted a run — it failed **silently**, producing a digest with no AI summary and exit 0. The
  scheduler appeared to work while half of it was dead. Now `claude-sonnet-5`; the silence itself is
  fixed in 2.6.1.
- **The two halves of server mode shared no vocabulary.** `cortex-cron.sh` keyed on `BRAIN_DIR` while
  the rest of Cortex uses `AI_OS_ROOT`. `AI_OS_ROOT` is now accepted as a fallback; `BRAIN_DIR` still
  wins when both are set, so existing crontabs keep working. Neither bug was caught by a test,
  because nothing tests the shell half — which is worth knowing.

## [2.5.0] — 2026-08-18

### Changed
- **The root guard became a door instead of a habit.** `core/paths.js` held a correct guard —
  `resolveInRoot` refuses a path that escapes the vault root — and it was optional. Five modules
  read and wrote vault content, each deciding for itself whether to call it. `projects.js` used it
  for `getProjectContext`, added after a caller-supplied slug of `../../secret` was found to read any
  file on disk, and then joined `projects` onto the root unguarded three lines earlier.
  `cortexignore.js` read `join(root, ".cortexignore")` with a bare `readFileSync`. `recall.js` seeded
  a recursive walk with `walk(root, "")` and joined onto a local variable on every entry — never
  writing `join(root, …)` at all. The traversal patch that shipped standalone was a lock on one door
  in a building with three.

  Now `mcp/lib/vault.js` owns every filesystem operation on a vault root — `abs` · `exists` ·
  `isFile` · `isDirectory` · `mtimeMs` · `entries` · `list` · `read` · `append` · `write` — each
  taking a root-relative path and resolving it through the guard. **Nothing else under `mcp/` may
  join onto a vault root**, and `vault.js` is now the only importer of `core/paths.js` there.

  Enforced by a test rather than by convention, and stated at two altitudes because one is not
  enough: a scan for `join(root, …)`, plus an assertion that the four converted modules import no
  `node:fs` at all. The second exists because `recall` bypassed the guard through a closure variable
  and the first is structurally blind to it. Teaching the regex to chase a variable through a closure
  would have made the check clever and unreadable.

  **No behaviour changes.** `recall` and `listProjects` still return absolute paths; `list` is
  root-relative internally because that is the safer currency, and the conversion back is now an
  explicit step rather than an accident of how a path was built. Characterization tests were written
  and passing *before* any code moved, which is what caught the conversion the one time it slipped.

  The Vault does **not** scrub — secret refusal is policy and stays in `core/scrub.js`; folding it in
  would make every write pay for it and hide a policy refusal behind a path operation. It lives in
  `mcp/lib/` rather than `core/` because `index/` has no use for vault semantics: it asks git what
  belongs to a repo (ADR 0003) and deliberately does not read `.cortexignore`. Recorded in
  [ADR 0007](docs/adr/0007-the-vault-is-the-only-door.md).
- **`lib/cortexignore.js` is pure.** It decides what the patterns mean and no longer reads a file;
  `makeIgnoreFilter` takes the `.cortexignore` text (or `null`) instead of a root, and
  `loadCortexignore` is gone. Its test file imports no `node:fs` — a test that needed a temp
  directory to check a regex was telling us something. The dependency runs one way only: `vault.js`
  imports `cortexignore.js`, never the reverse, or the two would import each other.

## [2.4.0] — 2026-08-18

### Added

- **`cortex-findings.mjs --offers`** — prints the ranked worklist as JSON and writes nothing at all,
  not even the report. The report stays prose for a human; this is the machine surface the wizard
  walks. Two surfaces over one analysis rather than one doing two jobs — a wizard forced to parse
  its questions back out of rendered markdown would drift from the findings the moment either was
  reworded.
- Findings that propose the three repo-scale offers nothing produced before: `enrich` (a large repo
  with no `enriched.json`, stating the token cost), `memory` (no committed `.cortex/memory/`,
  explaining the committed/gitignored asymmetry once), and `bundle` (a tier the index gives a reason
  for — a frontend proposes `browser-qa`). The enrichment threshold is a named constant
  (`ENRICH_WORTH_IT = 50`) because it is a judgement call meant to be argued with, not a number
  buried in a conditional. Frontend detection keys on file extension, not language: `langs.mjs` maps
  `.tsx` to `typescript`, so language alone cannot tell a frontend from a TypeScript backend.
- **`/handoff`** — compact the live conversation into a document another agent can pick up, written
  to the OS temp directory. Ported because Cortex's whole thesis is not losing context and this was
  a hole in it: `/dream` consolidates a day for the *team*, `/catch-me-up` reads git after time
  *away*, and neither packages an **in-flight** session for a **different agent right now**.

  Exactly the failure that produced today's work — a parallel session on 2026-08-15 was closed with
  its skills survey unrecorded and `/improve-codebase-architecture` stranded on a gitignored path.

  Cortex additions on top of the upstream body: a table cutting it against `/dream` and
  `/catch-me-up` on **in-flight state versus durable knowledge** (a lesson learned belongs in the
  committed digest, not a temp file gone by next week); redaction must **say what it redacted**, so
  the next agent knows a value exists instead of inheriting a silent gap; and name the branch, or
  the next agent goes to `master` looking for changes that are not there.
- **`/writing-for-agents`** — the authoring discipline for documents an agent consumes, and the
  vocabulary Cortex was missing for its own product: **context pointers** (a skill description, a
  routing-table line — the wording, not the target, decides whether the material is ever reached),
  the **two loads** (context load on the agent's window, cognitive load on the human), the
  **information hierarchy** and progressive disclosure, **completion criteria** and premature
  completion, **leading words**, and the pruning tests — duplication, relevance, sediment, no-ops.

  Ported because it names what Cortex does for a living. Every ritual writes one of these
  documents — root `AGENTS.md` and its routing table, scoped leaves, `CONTEXT.md`, skills,
  `.cortex/memory/` digests — and `/optimize-context` could **audit** them while nothing described
  how to **write** one. Those two are now wired as halves of one job, and `/skill-creator` points
  at `SKILL-MECHANICS.md` for the model-invoked vs user-invoked choice it cannot make alone.

  Cortex keeps one deliberate divergence: upstream weighs `disable-model-invocation` purely as
  context load versus cognitive load, while `/onboard`, `/migrate-engine`, `/team-init` and
  `/connect-brain` carry it because they are once-only or destructive. Safety outranks the load
  trade, and the skill says so.
- **`/grilling`** — the shared interview discipline: work a decision as a *design tree*, ask the
  whole settled *frontier* in one round with a recommended answer for each, and let every round of
  answers push the frontier outward until no branch is left silently assumed. Facts are the
  agent's job (dispatch a sub-agent), decisions are the user's.

  Ported because it was a **missing dependency**, not for completeness: `/improve-codebase-architecture`
  shipped in 2.3.0 telling the reader to "run the `/grilling` skill" for the loop that does the
  actual work after the report — and no such skill existed. `/analyze-spec`, `/level-up` and
  `/onboard` all interview the user ad hoc and now have one spelling to borrow.

### Changed

- **`/cortex-install` became the wizard it always described.** It presented four choices at once —
  context layer, briefs, bundle, nothing — in a fixed order with no relation to what the repo
  actually needed. `analyse()` already ranked every finding by severity and that ranking was thrown
  away before reaching the only place it mattered, so a repo whose worst problem was a possible
  secret and one whose worst problem was a missing `AGENTS.md` were asked the same four questions in
  the same order.

  Findings now carry an optional machine-readable **offer** — `scaffold` · `brief` · `enrich` ·
  `bundle` · `triage-secrets` · `memory` — and `offers()` returns them as a ranked, de-duplicated
  worklist the skill walks top-down. **The report is the wizard's script**; the repo's own state
  chooses the running order.

  Offers **collapse by action**, which is what keeps a thirty-finding report from becoming a
  thirty-question interview: five areas that each want a brief are one question naming five
  candidates. A merged entry inherits its highest member's severity, so collapsing can never bury a
  critical finding, and carries the titles that produced it so the wizard can say *why* it is
  asking. Severity does not imply an offer — *no test files found* is high and Cortex has no action
  that writes tests, so it stays a finding with no question attached.

  Consent is **propose-all-then-one-yes**: step 4 walks every offer with nothing on disk, step 5
  plays the worklist back as a list of paths and takes one confirmation, step 6 applies in worklist
  order. Rejected on both flanks — per-write prompts train users to click through the one prompt
  that matters, and a single up-front yes stretched to cover files it never named is not consent
  either. Enrichment states its token cost *before* its question and must be named in the playback;
  it is the only offer that spends real money. `triage-secrets` shows and stops — no rotation, no
  redaction, because some hits are fixtures and a false positive acted on destroys trust in every
  other finding. "Later" is a real answer and survives into the close.

  Verified against two real legacy repos (108 and 70 files): dozens of findings, five ranked
  questions each. Recorded in
  [ADR 0006](docs/adr/0006-the-report-is-the-wizards-script.md).
- **The install sequence can finally start itself.** Cortex's design promises that landing on a repo
  with code *fires* the sequence — index, report, user picks, apply. It never could:
  `/cortex-install` carried `disable-model-invocation: true`, so only a human typing its name could
  begin it. The flag had no stated reason — `AGENTS.md` justifies it for `/onboard`,
  `/migrate-engine`, `/team-init` and `/connect-brain` (once-only or destructive) and the test guards
  exactly those four. `/cortex-install` only reads. The flag was inherited, and it blocked the
  sequence the whole design is built around.

  Protection moves to where it belongs — a **consent gate on the first write**. With no `.cortex/`
  yet it asks before writing anything, including the index, because generated-and-gitignored is not
  the same as invisible: those are files appearing in a project on a run nobody asked for. Once
  `.cortex/` exists, re-indexing needs no ceremony. Reading was never gated and still isn't.

  Rejected: shipping a `SessionStart` hook (the plugin ships no hooks at all today, and it would run
  before the user expressed any intent) and splitting off a read-only "orient" skill (a second
  spelling of a shipped ritual, and useless for the motivating case — a repo with no index is
  exactly where an agent needs to act). Recorded in
  [ADR 0005](docs/adr/0005-the-install-sequence-may-start-itself.md).
- **`/analyze-spec` gained the vocabulary for what it cannot yet see.** It could lock decisions and
  rule work out of scope, but had no way to say "this is in scope and I cannot yet phrase the
  question sharply" — so that material either hardened into confident detail nobody had decided, or
  fell into `Out of scope` and was silently abandoned.

  Now: **destination** (named first, because it fixes the scope every later decision is judged
  against), **fog of war** (in scope, not yet sharp), and the test between them — can you state the
  question *precisely now*, not can you answer it. The spec template gained **Not yet specified**
  alongside `Out of scope`; the two are different rulings, one about sharpness and one about scope.
  If naming the destination surfaces no fog at all, the ritual now says so and stops: that is
  `/plan-feature` work, not a spec.

  Harvested from upstream's `wayfinder`, which is **not** being ported. Reading it showed the
  overlap concern was wrong — it is genuinely different — but it is hard-wired to an issue tracker
  (map as a labelled issue, tickets as child issues, frontier from native blocking dependencies)
  and cascades into `research` and `prototype`, both already skipped. This repo has zero issues and
  runs on PRs, the same reason `to-tickets` and `triage` were skipped. Verdict and reasoning are
  recorded in the harvest doc; revisit only if a tracker is adopted.

### Fixed

- **`/cortex-scaffold` had no source to write from on a greenfield repo.** It opens by refreshing
  the index and warning that "a scaffold written from assumption is worse than none: it reads as
  authoritative and is wrong" — then tells the agent to fill every `{{placeholder}}` from the index
  and the code. On an empty repo there is no code, so following it means inventing a stack (the
  exact failure it warns about) or leaving `{{placeholders}}` behind, which read as instructions to
  the next agent and never get cleaned up.

  The honest source on greenfield is the user, so it now **interviews instead of reading** — via
  `/grilling`, asking the four questions the template needs in one round rather than one at a time.
  Layout and `CONTEXT.md` behave differently there (no aspirational directories; seed the glossary
  from the words the user actually used), and the result is labelled for what it is: a greenfield
  brief is a **hypothesis**, and the first `/cortex-install` over real code is what tests it.
- **The greenfield install flow existed in the design and nowhere in the code.** `/cortex-install`
  claimed in its own description to work on "greenfield and legacy repos", and the design spec
  specifies two distinct sequences — but only the legacy one was implemented. Running it on an
  empty repo produced **three ranked findings, one of them `high`**, about missing documentation
  for code that does not exist: AGENTS.md called "the single highest-leverage file" for a repo with
  zero files, and a glossary demanded because "domain terms are undefined" where there is no
  domain. It then closed by pointing at `/cortex-brief` for "the areas listed above" — naming areas
  the index had explicitly found none of.

  Absurd output on a first run is expensive: it teaches a new user the report is noise, and the
  report is the entire product before anything is written.

  Now `analyse` forks on `isGreenfield` and emits one honest `low` finding, `render` closes with
  the matching instruction (scaffold; briefs and enrichment wait for code), and `/cortex-install`
  carries the fork explicitly — on the index's file count, not on a guess about the repo. Also
  fixes the stray `- ` bullet an empty language map rendered.
- **MIT attribution on `/improve-codebase-architecture`.** It was ported from
  [mattpocock/skills](https://github.com/mattpocock/skills) by a parallel session without the
  footer every other ported file carries. A licence obligation, not a style nit.

### Documented

- `docs/superpowers/specs/2026-08-17-mattpocock-harvest.md` — the full survey of upstream's 18
  engineering + 7 productivity skills against what Cortex already ships: 5 already ported, 2 not
  ours to take, 5 already covered by the bundle, 4 worth porting, 9 skipped with reasons. The
  original survey was run by a parallel session on 2026-08-15 that recorded nothing and was closed,
  so the work was lost. Writing it down is the point.

## [2.3.0] — 2026-08-17

### Added
- **`/improve-codebase-architecture` is now a real skill.** It surfaces deepening opportunities —
  refactors that turn shallow modules into deep ones — reports them as HTML, then works through
  whichever one you pick. It had been written by a parallel session on 2026-08-15 and only ever
  existed in the **gitignored** `.claude/skills/` mirror, under a misspelled directory
  (`improve-codebase-arhitecture`) that did not match its own frontmatter `name:`. It carried no
  git history, so any mirror rebuild would have destroyed it silently. Promoted to canonical
  `skills/`, spelling corrected, and listed in the ritual table.

  Its three references to "the `/codebase-design` skill" were dead — `codebase-design` is a
  reference document (`references/codebase-design.md`), not a ritual. Repointed.

### Fixed
- **Re-planning an enrichment no longer discards it.** Batch indexes are positional, so adding or
  removing a layer renumbers every batch after it and the `batch-N.json` files already on disk end
  up describing a different batch. `validateBatch` treated that as a hallucinated path and dropped
  every entry — turning a one-file change into a total loss of the enrichment, the opposite of the
  resumability deterministic batching exists to provide. Found by dogfooding: deleting `.vscode/`
  removed one layer and the next merge reported **379 issues against 210 summaries, none of which
  were wrong**.

  A path that is real and indexed is now **kept and reported** when it arrives against a moved
  batch number; a path absent from the index is still dropped, because "landed in a renumbered
  batch" and "names a file that does not exist" are different failures. Coverage moved to
  `mergeEnrichment`, where it is computed across all batches at once — a per-batch gap is
  meaningless once files can legitimately move between batches.

  Verified by simulating the break: with every batch shifted by one, **198 of 198 surviving
  summaries were kept and zero dropped**.

### Changed
- `tools/cortex-sync-skills.sh` — refreshes the gitignored `.claude/skills/` mirror from the
  canonical `skills/`, with `--check` to report drift. The mirror had rotted to 22 of 30 skills
  with 9 stale copies, leaving five v2.0 rituals unavailable as slash commands. Mirror-only skills
  are reported and never removed: they have no git history to recover from.
- Deleted `.vscode/` — `settings.json` pointed at a `node_modules/typescript/lib` that does not
  exist, `tasks.json` ran npm scripts from a root `package.json` that does not exist, and
  `toolsets.json` listed retired engine MCP tools. `/migrate-engine` already named
  `.vscode/toolsets.json` as an engine artifact to delete.

## [2.2.0] — 2026-08-16

**The plugin actually installs now.** A live install round-trip — clone the repo the way a plugin
install does, then run the rituals against a real unrelated repository — found three defects that
166 passing tests could not, because every one of them was hidden by this development machine.

### Fixed
- **The MCP brain was dead on every fresh install.** `mcp/server.js` imported
  `@modelcontextprotocol/sdk`, but installing a plugin *clones* the repository — nothing runs
  `npm install` and no lockfile is honoured. Every user who installed Cortex from v2.0.0 onward
  got `ERR_MODULE_NOT_FOUND` and no `recall`, `remember` or `recall_memory`. It passed here only
  because `mcp/node_modules` existed on the machine the tests ran on.

  The SDK is gone. `mcp/lib/stdio.js` implements the MCP stdio transport directly — about 100
  lines of newline-delimited JSON-RPC replacing 22 MB across ~90 transitive packages, for the four
  symbols Cortex used. **Cortex now has no runtime dependencies at all**; `git clone` is the whole
  install. See [ADR 0004](docs/adr/0004-no-runtime-dependencies.md).
- **`/cortex-audit` was broken for everyone who installed the plugin.** The `cortex-auditor`
  subagent lived in `.claude/agents/`, which is project-local — an installed plugin loads
  subagents from `agents/` at its root. The ritual dispatched a subagent that did not exist. Moved
  to `agents/`.
- **Repo mode was misdetected on POSIX, and CI had been red about it for five commits.**
  `detectMode` delegated to `path.basename`, which resolves separators for the host it runs on —
  and on POSIX a backslash is an ordinary character, so a Windows `AI_OS_ROOT` came back as one
  long segment and every repo install looked like a vault. `path.win32.basename` understands both
  separators, so the bug was invisible on Windows while `mcp test` failed on every ubuntu runner
  from `bd51e11` onward. Which mode a root names is a fact about the string, not the host; both
  separators are now split explicitly, and a new test reads the source so it fails on **either**
  platform rather than only on Linux.
- **`core/*.js` relied on Node's ESM syntax-detection fallback.** No `package.json` above them
  declared `"type": "module"`, so every run printed `MODULE_TYPELESS_PACKAGE_JSON` and resolved
  against whatever `package.json` happened to sit above the install directory — which fails
  outright, not merely noisily, if that one says `"commonjs"`. Added `core/package.json`.

### Added
- **`core/test/install.test.js`** — the guard that would have caught all three. It reads the source
  of `core/`, `index/` and `mcp/` and fails on any non-builtin import, any declared runtime
  dependency, any ESM `.js` file without a `"type": "module"` above it, and any subagent a ritual
  dispatches that is not shipped in `agents/`. It reads source rather than attempting an import,
  because the environment is exactly what could not be trusted.
- **`mcp/test/stdio.test.js`** — pins the protocol edges an SDK used to own: notifications are
  never answered, unknown methods return `-32601`, a message split across reads still parses, two
  messages in one read are both handled, and a throwing tool produces `isError` instead of killing
  the session.

### Changed
- CI no longer has an install step, and `mcp/package-lock.json` is deleted — there is nothing left
  to lock. A future `npm ci` in the workflow would mean the plugin is already broken for users.
- `README`, `mcp/AGENTS.md`, `/connect-brain` and `references/living-cortex.md` no longer tell
  anyone to run `npm install`.

**182 tests, 0 failures** (was 166).

## [2.1.0] — 2026-08-15

### Added
- **An `api` tier carrying the official Postman plugin** — full API lifecycle management, powered
  by the Postman MCP Server. Offered when the index shows an API surface.
- **`core/test/bundle.test.js`** — fetches the official marketplace manifest and asserts every
  declared plugin really exists in it, so a bad name fails here rather than on a user's machine.
  Skips cleanly when the marketplace is unreachable.

### Fixed
- **Corrected a false claim.** v2.0.0 stated in `references/cortex-plugins.md`, the
  `/cortex-install` skill and its release notes that there was no Postman plugin in the official
  marketplace. There is. The claim came from listing the local plugin *cache* — 15 installed
  plugins — instead of the marketplace *catalog*, which holds 286. All three places are corrected,
  and the new bundle test is the mechanism that stops the mistake recurring.

## [2.0.0] — 2026-08-15

**Cortex becomes a context manager for new and legacy codebases, installable as a Claude plugin.**

### Added
- **Installable as a plugin** — `.claude-plugin/{marketplace.json,plugin.json}`. `/plugin
  marketplace add marinvch/Cortex` then `/plugin install cortex`, at user, project or global scope.
- **A deterministic index** (`index/`) — asks git what belongs to a repo, resolves imports for
  JS/TS, Python, Go, Rust and shell, infers layers from structure and hot spots from git history.
  No LLM, no network: the same tree always yields the same output, so it is safe to re-run in CI.
- **A findings report** — one ranked markdown artifact and nothing else. The module that finds has
  no authority to change a repository; `/cortex-scaffold` is the separate skill that applies.
- **Committed repo memory** (`.cortex/memory/`) — append-only dated files, so several developers
  and their agents share one context with git as the sync mechanism.
- **A secret gate** (`core/scrub.js`) — because memory is committed, any write carrying a
  credential is refused outright rather than sanitised.
- **Semantic enrichment** (`/cortex-enrich`) — optional summaries, roles and tags on top of the
  index. Deterministic batching, and validation that assumes the model's output is wrong.
- New rituals: `/cortex-install`, `/cortex-scaffold`, `/cortex-brief`, `/cortex-enrich`, `/dream`,
  plus `/wizard`, `/domain-modeling` and `/resolving-merge-conflicts` ported from
  `mattpocock/skills` (MIT).
- `references/codebase-design.md` — vocabulary for how code is shaped.
- `tools/cortex-vault-extract.sh` — moves the personal vault to its own repo. Dry run by default.

### Changed
- **The MCP server has two modes**, decided by the root it is given: a repo's `.cortex/` serves
  `recall` · `remember` · `recall_memory`; a personal vault serves the original tools. The vault
  tools are hidden in repo mode so an agent cannot write `inbox/` into a product repository.
- **Code is layered `core/` ← `index/` + `mcp/`**, enforced by `core/test/architecture.test.js`.
  `paths`, `scrub`, `memory` and `date` moved into the kernel.
- `listProjects` honours `.cortexignore` instead of hard-coding a `README.md` skip.
- `/analyze-spec` plans wide mechanical changes as expand → migrate → contract.
- Once-only rituals (`/onboard`, `/migrate-engine`, `/team-init`, `/connect-brain`) carry
  `disable-model-invocation`, so an agent can never auto-fire them.

### Fixed
- **`getProjectContext` read outside `AI_OS_ROOT`** — a slug like `../../secret` returned any file
  on disk. Both candidate paths now go through the existing `resolveInRoot` guard.
- **One slug rule** across `slug.js`, `cortex-init.sh` and `cortex-scan-projects.sh`, with a parity
  test. The mismatch made the employer-firewall purge delete a filename nothing ever wrote.
- **One project-stub contract** — the scanner wrote `**Local path:**` while the viewer selected on
  `^path:`, so scanner-registered projects were invisible in `cortex.html`.

### Note
This release moves the project's centre of gravity. The personal-vault half still works and is
being extracted into its own private repo — see `tools/cortex-vault-extract.sh`.

## [Unreleased]

**Repo health pass: contract enforcement, missing ritual, CI coverage.**

### Fixed
- **`recall` now honours `.cortexignore`** — `mcp/lib/recall.js` had its own hardcoded skip list, so
  the live brain indexed scaffolding and vendored third-party docs as if they were knowledge (256
  files indexed on this repo, 190 of them vendored; a search for "context engineering" returned
  library docs as all five top hits). It now shares the vault's single source of truth and produces
  a **byte-identical** knowledge set to `knowledge_files()` in `tools/_cortex-lib.sh`, guarded by a
  CI parity check.
- **`/daily` exists.** It was advertised in the README quick-start, the ritual table and `AGENTS.md`,
  but `skills/daily/SKILL.md` was never written.
- **Team captures can no longer overwrite each other.** The note id was `timestamp+pid`, so two
  captures in the same millisecond from one server process produced the same filename and the
  second silently replaced the first in an append-only store.
- **`.gitignore` negations now work.** `!context/.gitkeep` and friends could never re-include
  anything, because git does not descend into a fully-excluded directory; the personal folders now
  use the `dir/*` form. The `inbox/`, `daily/`, `notes/`, `projects/`, `areas/` and `resources/`
  READMEs the rule promised are committed, so a fresh clone has the **complete** vault skeleton —
  all eight folders, including `notes/` (the knowledge graph) and `daily/`, which the first pass
  missed.
- **Line endings normalized to match the stated policy.** `.gitattributes` declares "Git stores
  text as LF", but `* text=auto` only normalizes on write, so 12 files committed before it existed
  still carried **CRLF in the index** (11 historic `docs/superpowers/` plans and specs, plus
  `.vscode/settings.json`). `git add --renormalize` brings them in line; the change is
  byte-for-byte EOL-only (5896 insertions, 5896 deletions, zero content changes) and working
  copies stay platform-native.
- **`tools/README.md` was corrupt.** 1252 trailing NUL bytes had been appended after the final
  newline since the v1.0.0 release (`39e689e`), making the file register as *binary* — `grep`
  skipped it, and diffs of it were unreadable. The content was intact; the NUL tail is gone. It
  was the only tracked file in the repo carrying control bytes.
- **Version is single-sourced** from the `VERSION` file (`mcp/lib/version.js`); `server.js` no
  longer hardcodes it. The README advertised **v1.0.0** for the whole of the 1.1.0 release.
- Smoke test failures now report the server's stderr instead of a bare 5-second `timeout`.

### Added
- `LICENSE` (MIT) — the README promised it; the file did not exist.
- `.gitattributes` pinning `*.sh` to LF, so a Windows working copy cannot commit CRLF scripts that
  fail on Linux with `bash: $'\r': command not found`.
- **CI coverage** for the surfaces that had none: a Windows matrix leg for the MCP server (the
  primary dev platform, and `lib/capture.js` carries path-separator handling), a `hooks test`
  workflow (they run on every prompt and session end), shellcheck over `tools/`, a behavioural
  test for `knowledge_files()`, and a check that every hook wired in `.claude/settings.json`
  exists on disk.
- **Drift guards as tests**: `VERSION`/`package.json`/README/CHANGELOG agreement, and parity
  between `cortex-init.sh`'s hardcoded `CORE_PLUGINS` and `plugins/cortex-core-plugins.json`.

### Security
- **`fast-uri` host-confusion advisory resolved** (GHSA-v2hh-gcrm-f6hx, high) via a lockfile bump —
  `mcp/package.json` is unchanged, so this is not a breaking dependency change.
- The two remaining moderate advisories are **upstream-blocked and unreachable here**:
  `@hono/node-server` path traversal in `serve-static` (GHSA-frvp-7c67-39w9) arrives transitively
  through `@modelcontextprotocol/sdk`, which at its latest release (1.29.0) pins `^1.19.9` and so
  cannot reach the patched 2.0.5. The server connects over `StdioServerTransport` only and never
  serves static files, so the vulnerable path does not exist in this codebase. Revisit when the SDK
  bumps its dependency.

### Removed
- **330 vendored files under `.agents/` and 5 stale `.claude/skills/` copies** were tracked despite
  being gitignored — `git rm --cached` had never run, so "re-fetchable; keep the repo lean" was not
  true. Untracked, not deleted from disk.
- A stray `install.cmd` (Anthropic's Claude Code Windows installer, unrelated to this project).

## [1.1.0] — 2026-07-01

**Live MCP brain + team engine + plugin bundle.**

### Added
- **Live MCP brain** — `mcp/` Node server with `recall`, `get_project_context`, `list_projects`, and `capture` tools; security path-jail; one-line user-scope registration via `/connect-brain`.
- **Team context engine** — team-brain git sync (append-only, one-file-per-note, auto commit+push), generic `.cortex/connector.json`, `ai-os team init|add` (`/team-init`, `/team-add`).
- **Capture sources** — `ai-os digest` (read-only git/PR digest into brain notes).
- **Holiday catch-up** — `catch_me_up` MCP tool + `ai-os catch-up` (`/catch-me-up`).
- **Cortex Core Plugin Bundle** — committed manifest + `.claude/settings.json` stamping (Core tier out-of-the-box) + `ai-os setup-plugins` offering optional tiers by role.

### Resolved
- **#305**, **#306**.

## [1.0.0] — 2026-06-30

First stable **plain-files, bash-only** release. The vault and all tooling run with nothing but
bash — no Node, no Python, no engine. **Breaking:** the Node installer is retired.

### Added
- **Unified viewer app** — `bash tools/cortex.sh` builds and opens `cortex.html`: one self-contained
  page with four tabs — **Map** (Obsidian-style force graph), **Notes** (rendered markdown with
  clickable `[[wikilinks]]` and a 🗑 Remove button), **Repos** (registered codebases), **Gaps**
  (orphan notes + dead links). No server, no runtime.
- **Nested scoped briefs** — `/scope-area` adds a deep `AGENTS.md` leaf inside a critical directory
  plus an Area-map routing table in root, so agents load narrow, high-signal context.
- **`/migrate-engine`** — harvests an old engine's memory store into `AGENTS.md` *before* removing
  the old files, so no knowledge is lost across the breaking change.
- **`/analyze-spec`** — Spec-Driven Development grounded by the brain (Cortex context + Superpowers
  workflow).
- **`/reindex`** + `templates/moc.md` — keep the vault navigable as it grows (regenerate the viewer,
  nominate Maps of Content, resolve dead links).
- **Skill suggestion** and **old-engine detection** in `cortex-init.sh` and `/install-project`.
- **`.cortexignore`** — single source of truth for what *isn't* knowledge, shared by every generator
  via `tools/_cortex-lib.sh` (no per-script drift).
- **`cortex-rm.sh`** + in-UI Remove button — archive a note and de-link inbound references safely.
- **`--register-to-vault`** cross-repo registration; the Repos tab lists registered codebases.

### Changed
- Installer rewritten in **pure bash** (`tools/cortex-init.sh`) — zero runtime deps; works in
  git-bash, zsh, WSL, Linux, macOS.
- CI is now a **bash smoke test** (dropped the Node/bun matrix).
- Navigation model: **Maps of Content + links**, not deep folders.
- README rewritten with clear, step-by-step usage (including "use it on your other projects").

### Removed
- Node installer `cortex-init.mjs` → `archives/cortex-init.mjs.legacy`; both `package.json` files
  archived.
- Duplicate generators `cortex-nav.sh` / `cortex-brain.sh` → consolidated into `cortex.sh`.
- Stale `.vscode/*.chatprompt.md` old-engine leftovers and superseded static views → archived.

### Fixed
- **Graph noise** that looked like vault gaps: only genuine knowledge files are shown (23 vs 51) and
  dead-link detection is honest — examples, templates, comments, and inline-code `[[...]]` no longer
  count. False-positive dead links: 0.

### Validated
- Local CI green (12/12): every script parses, the installer smoke test passes, all 12 skills have
  valid frontmatter, the GitHub Actions workflow is bash-only.
- Demonstrated end-to-end on a real repo: brain installed, old engine migrated (10 verified
  memory facts harvested), nested briefs created for auth / webhooks / RAG.

[2.41.5]: https://github.com/marinvch/Cortex/releases/tag/v2.41.5
[2.41.4]: https://github.com/marinvch/Cortex/releases/tag/v2.41.4
[2.41.3]: https://github.com/marinvch/Cortex/releases/tag/v2.41.3
[2.41.2]: https://github.com/marinvch/Cortex/releases/tag/v2.41.2
[2.41.1]: https://github.com/marinvch/Cortex/releases/tag/v2.41.1
[2.41.0]: https://github.com/marinvch/Cortex/releases/tag/v2.41.0
[2.40.0]: https://github.com/marinvch/Cortex/releases/tag/v2.40.0
[2.39.1]: https://github.com/marinvch/Cortex/releases/tag/v2.39.1
[2.39.0]: https://github.com/marinvch/Cortex/releases/tag/v2.39.0
[2.38.0]: https://github.com/marinvch/Cortex/releases/tag/v2.38.0
[2.37.1]: https://github.com/marinvch/Cortex/releases/tag/v2.37.1
[2.37.0]: https://github.com/marinvch/Cortex/releases/tag/v2.37.0
[2.36.0]: https://github.com/marinvch/Cortex/releases/tag/v2.36.0
[2.35.1]: https://github.com/marinvch/Cortex/releases/tag/v2.35.1
[2.35.0]: https://github.com/marinvch/Cortex/releases/tag/v2.35.0
[2.34.1]: https://github.com/marinvch/Cortex/releases/tag/v2.34.1
[2.34.0]: https://github.com/marinvch/Cortex/releases/tag/v2.34.0
[2.33.1]: https://github.com/marinvch/Cortex/releases/tag/v2.33.1
[2.33.0]: https://github.com/marinvch/Cortex/releases/tag/v2.33.0
[2.32.0]: https://github.com/marinvch/Cortex/releases/tag/v2.32.0
[2.31.0]: https://github.com/marinvch/Cortex/releases/tag/v2.31.0
[2.30.0]: https://github.com/marinvch/Cortex/releases/tag/v2.30.0
[2.29.0]: https://github.com/marinvch/Cortex/releases/tag/v2.29.0
[2.28.0]: https://github.com/marinvch/Cortex/releases/tag/v2.28.0
[2.27.1]: https://github.com/marinvch/Cortex/releases/tag/v2.27.1
[2.27.0]: https://github.com/marinvch/Cortex/releases/tag/v2.27.0
[2.26.0]: https://github.com/marinvch/Cortex/releases/tag/v2.26.0
[2.25.1]: https://github.com/marinvch/Cortex/releases/tag/v2.25.1
[2.25.0]: https://github.com/marinvch/Cortex/releases/tag/v2.25.0
[2.24.2]: https://github.com/marinvch/Cortex/releases/tag/v2.24.2
[2.24.1]: https://github.com/marinvch/Cortex/releases/tag/v2.24.1
[2.24.0]: https://github.com/marinvch/Cortex/releases/tag/v2.24.0
[2.23.0]: https://github.com/marinvch/Cortex/releases/tag/v2.23.0
[2.22.2]: https://github.com/marinvch/Cortex/releases/tag/v2.22.2
[2.22.1]: https://github.com/marinvch/Cortex/releases/tag/v2.22.1
[2.22.0]: https://github.com/marinvch/Cortex/releases/tag/v2.22.0
[2.21.0]: https://github.com/marinvch/Cortex/releases/tag/v2.21.0
[2.20.0]: https://github.com/marinvch/Cortex/releases/tag/v2.20.0
[2.19.0]: https://github.com/marinvch/Cortex/releases/tag/v2.19.0
[2.18.0]: https://github.com/marinvch/Cortex/releases/tag/v2.18.0
[2.17.0]: https://github.com/marinvch/Cortex/releases/tag/v2.17.0
[2.16.0]: https://github.com/marinvch/Cortex/releases/tag/v2.16.0
[2.15.0]: https://github.com/marinvch/Cortex/releases/tag/v2.15.0
[2.14.0]: https://github.com/marinvch/Cortex/releases/tag/v2.14.0
[2.13.0]: https://github.com/marinvch/Cortex/releases/tag/v2.13.0
[2.12.0]: https://github.com/marinvch/Cortex/releases/tag/v2.12.0
[2.11.0]: https://github.com/marinvch/Cortex/releases/tag/v2.11.0
[2.10.1]: https://github.com/marinvch/Cortex/releases/tag/v2.10.1
[2.10.0]: https://github.com/marinvch/Cortex/releases/tag/v2.10.0
[2.9.1]: https://github.com/marinvch/Cortex/releases/tag/v2.9.1
[2.9.0]: https://github.com/marinvch/Cortex/releases/tag/v2.9.0
[2.8.1]: https://github.com/marinvch/Cortex/releases/tag/v2.8.1
[2.8.0]: https://github.com/marinvch/Cortex/releases/tag/v2.8.0
[2.7.0]: https://github.com/marinvch/Cortex/releases/tag/v2.7.0
[2.6.1]: https://github.com/marinvch/Cortex/releases/tag/v2.6.1
[2.6.0]: https://github.com/marinvch/Cortex/releases/tag/v2.6.0
[2.5.0]: https://github.com/marinvch/Cortex/releases/tag/v2.5.0
[2.4.0]: https://github.com/marinvch/Cortex/releases/tag/v2.4.0
[2.3.0]: https://github.com/marinvch/Cortex/releases/tag/v2.3.0
[2.2.0]: https://github.com/marinvch/Cortex/releases/tag/v2.2.0
[2.1.0]: https://github.com/marinvch/Cortex/releases/tag/v2.1.0
[2.0.0]: https://github.com/marinvch/Cortex/releases/tag/v2.0.0
[1.1.0]: https://github.com/marinvch/ai-os/releases/tag/v1.1.0
[1.0.0]: https://github.com/marinvch/ai-os/releases/tag/v1.0.0
