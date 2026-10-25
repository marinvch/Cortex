# /setup-repo — report only, invoked with a row, or run unattended

`/setup-repo` reads this in three cases only: the user wants a report only, it was invoked with a
row (`/setup-repo evals`, `/setup-repo bands`, `/setup-repo team`), or it runs where nobody can answer (`claude -p`). Everything else is in
[SKILL.md](SKILL.md), and its steps still apply here.

## Report only

Some users want to look at a repo before anything is set up: "just index this", "report on this
repo", "show me the findings". Take this path for them. It is the same pass with the writing taken
out, and it is what the separate install command did before 3.0.0:

1. Steps 1 to 3 of [SKILL.md](SKILL.md) as written: orient, the consent gate, index, the findings
   report. These write only the generated files under `.cortex/` and the `.gitignore` lines, and
   the gate covers them.
2. Walk the findings offers from step 5 of SKILL.md, `cortex-findings.mjs . --offers`, and record
   yes, no or later for each. Skip the loop worklist from step 4: nobody asked for the loop.
3. Stop there. Do not play back, do not confirm, do not write.

A yes to any offer is a choice to set up after all. Say that in one line, then go to step 6 with
only the rows they said yes to, and the loop rows left out unless they ask for them. On a greenfield
repo the only offer worth making is the context layer: there is no code to brief or summarise.

Close a report-only run with the next command, not a menu:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-next.mjs" . --line
```

## Invoked with a row

`/setup-repo evals` and `/setup-repo bands` are what `cortex-next.mjs` names once the first pass is done. Run
steps 1–4 as usual, then take only that row from `missing`. Playback and confirmation are still
one each, and step 7's rules still apply.

- **`evals`**: ask for one to three real tasks the team finished recently. Each becomes
  `evals/cases/<name>/prompt.md` plus an `accept.sh` that checks the result. If there are none yet,
  stop and say so. The workflow alone proves nothing, and invented cases prove less.
- **`bands`**: ask which production metric has a stable history, and for a read-only command that
  reads it. If there is no such metric, stop and say so. For a library with no production metric,
  that is a finished state.
- **`team`**: a team already in `CLAUDE.md` is `present`, and its `why` names the roles still on
  offer. This offers them again, by [TEAM.md](TEAM.md); the playbook's roster line is updated, not appended.

## Running unattended

`claude -p "/setup-repo …"` — in CI, from a scheduled job, or installing the repos a
`CORTEX_E2E_WORKSPACE` run checks — has nobody to answer the consent gate or step 6, so the prompt
carries the answer (`[a]ll`, or the rows to write). It also meets a limit no prompt lifts: **Claude
Code protects `.claude/`**, and the verifier, the hooks, `settings.json` and whatever
`/suggest-skills` writes under `.claude/skills/` all land there. The
[permission-modes](https://code.claude.com/docs/en/permission-modes#protected-paths) page says why,
in three sentences `core/claude-code.js` pins (`permission.protected-path.*`):

- "Writes to a small set of paths are never auto-approved, except in `bypassPermissions` mode and in
  interactive terminal sessions in plan mode with bypass permissions available." `.claude` is on the
  list, `.claude/worktrees` excepted.
- "The safety check runs before Claude Code evaluates allow rules from settings" — so neither
  `--allowedTools` nor an `Edit(.claude/**)` rule gets the write through.
- "In a `-p` run with no host, these requests are denied either way" ([headless](https://code.claude.com/docs/en/headless)).
  Manual and `acceptEdits` prompt, so they are denied; `dontAsk` denies outright.

The supported way through is auto mode, where "Writes to protected paths route to the classifier even
when an allow rule matches":

```bash
claude -p "/setup-repo — the user confirms [a]ll" --permission-mode auto
```

Auto mode needs a supported model and account, and an organisation can switch it off; a session
that asks for it without qualifying starts in Manual and the writes are refused again. Without it,
run `/setup-repo` interactively once and answer **Yes, and allow Claude to edit files in this project's
.claude folder for this session**. `bypassPermissions` also writes them, and the docs confine it to
isolated containers and VMs — it is never Cortex's default.

**A refused write does not stop the run.** Everything outside `.claude/` still lands and the install
reads as finished, which is why step 8 reads the result off disk. Every row still `missing` with a
non-empty `protectedWrites` is named, with the sentence *Claude Code's protected-path check refused
these* and the command above; check `.claude/skills/` for the skills you wrote the same way. Reporting
it as written is the failure; so is reporting it as declined.

## By job

On a team's repo (`.cortex/connector.json`), the person's job is `me.job` in the `inbox` tool's
result, or in `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" inbox --json`. With no team or no job
recorded, it is `developer` and nothing here changes. The job shapes the answers you propose, never
the order or the list: every row is still asked, in its rank.

- `pm`: propose the report-only path (above) and say so before step 2. Offer `/whats-changed` at
  the end.
- `qa`: lead the step 3 summary with the code no test covers, and end with `/change-impact`.
- `architect`: `scaffold` and `brief` are theirs. Propose **later** for `bundle`, `enrich`, the
  hooks, evals and bands, and say they can take them now.
- `lead`: the agent team, `REVIEW.md` with the PR review workflow, and `team-plugin` are what the
  team shares. Say what a **later** on one of them costs everyone else.
- `developer`: as written.
