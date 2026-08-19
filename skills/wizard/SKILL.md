---
name: wizard
description: Generate an interactive wizard script that walks a human through steps only they can perform — provisioning infrastructure, setting up credentials or CI secrets, clicking through an unfamiliar third-party dashboard, running a one-off migration or cutover. Triggers — "walk me through", "set up the env vars", "I need to do this by hand", "make a setup script". Don't use it for steps the agent can perform itself.
capability: judgment
---

# /wizard — hand the human a script instead of instructions

A **wizard** is a script that walks a person, stage by stage, through a manual procedure that is
tedious to do by hand and tedious to re-explain to an AI every time. It opens each URL, says
exactly what to click and copy, captures the values, writes them where they belong, confirms
before anything irreversible, and shows how many stages are left.

The UX is already solved by the templates. **Your job is only to scope the procedure and author
its stages.** The library above the `STAGES` marker is identical in every wizard — that
consistency is the point. Never hand-edit it.

## Pick the template

| Template | Use when |
|---|---|
| `template.sh` | POSIX shell — the default. Git Bash, WSL, macOS, Linux, CI. |
| `template.ps1` | Windows-native, or **any step needing admin rights** — it self-elevates once via `Start-Process -Verb RunAs`, wraps each stage in `try/catch` so one protected path never aborts the batch, and holds the window open at the end. |

Never split admin work across several scripts or several elevation prompts. One script, one
elevation, a summary table at the end.

## The privacy rule (this vault, hard)

A wizard handles credentials. **It never lands in the vault.** Write it to the target repo's
`scripts/`, or to the scratchpad for a one-run job. Captured values go to that repo's `.env` or a
secret store — never into `context/`, `notes/`, `daily/`, or any file here. Do not echo a captured
secret back to the terminal, and never commit a wizard that has values baked into it.

## Process

### 1. Scope the procedure

Work out every manual step and every value captured along the way. **Read the repo first — don't
ask cold:** `.env`, `.env.example`, `README`, `docker-compose*`, framework config, and
`.github/workflows/*` (every `secrets.*` / `vars.*` reference is a value the wizard must produce).
For a migration or cutover, establish the current state, the target state, and the irreversible
actions between them.

Then show the user the ordered stages and the values each produces, and confirm — they may add,
drop, or reorder.

**Done when:** every stage is named in order, and for each value you know (a) where the human gets
it, (b) where it's written — `.env`, a secret, both, or nowhere, since some stages are pure
actions — and (c) whether it's secret, so it needs hidden entry.

### 2. Map each stage's journey

Write the precise path a human follows: which URL, what to do there, where the value is shown,
which variable it fills — "Dashboard → Developers → API keys → Reveal test key → copy". **Where
you don't know the current UI or the exact command, say so and check the docs or ask.** Never
invent steps that may not exist — a wizard that sends someone to a page that isn't there is worse
than no wizard.

**Done when:** every stage traces to instructions a stranger could follow.

### 3. Author it

Copy the template to the target path. Replace the example stage with one `stage` per step, in
dependency order. Set `TOTAL_STAGES` to match. Use the library helpers only.

Hold the bar the template sets: open the URL *before* asking for its value; hidden entry for
anything secret; persist every captured value; set only the secrets CI actually needs; confirm
before anything irreversible. Each stage clears the screen — keep it to one focused task so
nothing the human needs scrolls away.

### 4. Verify and hand off

- `bash -n <script>` (or `Get-Command -Syntax` / PSScriptAnalyzer for `.ps1`). Run `shellcheck` if
  available. `chmod +x` the bash one.
- **Don't run it end-to-end yourself** — it opens browsers and blocks on human input. Trace it
  statically: every value from step 1 is captured and lands where step 1 said it would, and every
  secret name exactly matches its CI reference.
- Tell the user how to run it. A wizard is **ephemeral by default** — built for one run, deleted
  when the job's done. Commit it only when it's a repeatable setup path, and then link it from the
  README so the next person runs the script instead of asking an AI.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT). `template.sh` is
vendored unmodified; `template.ps1` and the privacy + elevation rules are Cortex additions.
