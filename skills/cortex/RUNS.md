# /cortex — invoked with a row, or run unattended

`/cortex` reads this in two cases only: it was invoked with a row (`/cortex evals`, `/cortex bands`,
`/cortex team`), or it runs where nobody can answer (`claude -p`). Everything else is in
[SKILL.md](SKILL.md), and its steps still apply here.

## Invoked with a row

`/cortex evals` and `/cortex bands` are what `cortex-next` names once the first pass is done. Run
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

`claude -p "/cortex …"` — in CI, from a scheduled job, or installing the repos a
`CORTEX_E2E_WORKSPACE` run checks — has nobody to answer the consent gate or step 6, so the prompt
carries the answer (`[a]ll`, or the rows to write). It also meets a limit no prompt lifts: **Claude
Code protects `.claude/`**, and the verifier, the hooks, `settings.json` and whatever
`/cortex-skills` writes under `.claude/skills/` all land there. The
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
claude -p "/cortex — the user confirms [a]ll" --permission-mode auto
```

Auto mode needs a supported model and account, and an organisation can switch it off; a session
that asks for it without qualifying starts in Manual and the writes are refused again. Without it,
run `/cortex` interactively once and answer **Yes, and allow Claude to edit files in this project's
.claude folder for this session**. `bypassPermissions` also writes them, and the docs confine it to
isolated containers and VMs — it is never Cortex's default.

**A refused write does not stop the run.** Everything outside `.claude/` still lands and the install
reads as finished, which is why step 8 reads the result off disk. Every row still `missing` with a
non-empty `protectedWrites` is named, with the sentence *Claude Code's protected-path check refused
these* and the command above; check `.claude/skills/` for the skills you wrote the same way. Reporting
it as written is the failure; so is reporting it as declined.
