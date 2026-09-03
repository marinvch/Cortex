# Agent Teams — Master Reference

> Working reference for designing, spawning, and steering Claude Code agent teams.
> Source of truth: <https://code.claude.com/docs/en/agent-teams> (fetched 2026-09-03; page describes behaviour as of v2.1.178+).
> Supporting pages: `/docs/en/sub-agents`, `/docs/en/hooks`, `/docs/en/tools-reference`.

**Status: experimental, off by default.** Behaviour has changed repeatedly across point releases. Version-sensitive
details are called out inline — check them against your installed version before relying on them.

---

## 1. Decide first: do you actually want a team?

Three mechanisms parallelise work. Picking the wrong one is the most common and most expensive mistake.

| | Subagents | Agent teams | Cross-session messaging |
|:---|:---|:---|:---|
| **Context** | Own window; result returns to caller | Own window; fully independent | Separate sessions you launched |
| **Communication** | Return a result to caller; named subagents can message each other | Teammates message each other directly by name | Claude passes findings between your sessions |
| **Coordination** | Main agent manages all work | Self-coordination via messages + shared task list | Manual, by you |
| **Token cost** | Lower — results summarised back | **Significantly higher** — each teammate is a full Claude instance | Proportional to sessions you run |
| **Best for** | Focused tasks where only the result matters | Work needing discussion, challenge, and collaboration | Loosely related work you're already running |

**Use a team when** teammates can operate genuinely independently *and* the work benefits from them arguing with
each other. The four documented strong cases:

- **Research and review** — several teammates investigate different aspects, then share and challenge findings.
- **New modules or features** — each teammate owns a separate piece, no stepping on each other.
- **Debugging with competing hypotheses** — parallel theory testing converges faster than sequential.
- **Cross-layer coordination** — frontend / backend / tests, one owner each.

**Do not use a team for** sequential tasks, same-file edits, or work with many dependencies. A single session or
subagents will beat it. Teams add coordination overhead on top of the token cost.

> Rule of thumb: if you cannot name what each teammate would *disagree with the others about*, or which distinct
> files each one owns, you want subagents.

---

## 2. Enablement

Off unless `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Without it: no team is set up at session start, no team
directories are written, and Claude will not spawn or propose teammates.

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Set it in `settings.json` (any scope) or the shell environment.

### The side effect you must know about

Enabling teams **changes ordinary delegation**. Claude names subagents on its own so it can message them later, and
while teams are enabled **a named subagent launches as a teammate**. Teams therefore form when you never asked for
one. If you want plain subagents back, set the variable to `"0"`.

Settings-file `env` values are reapplied to a running session on save, and the variable is reread each time Claude
spawns a subagent — so flipping it to `"0"` takes effect without a restart. Turning it *on* still needs the value
present at session start for team setup.

**Precedence trap:** setting `"0"` in user `settings.json` overrides a shell export, but project settings, local
settings, `--settings`, and managed settings all apply *after* user settings. Any of them setting `"1"` wins.

### Where teams do not work

- **Non-interactive mode** (`-p`, Agent SDK): no teammates. A named subagent runs as an ordinary subagent even with
  the flag on. Spawning teammates requires an interactive session.

---

## 3. Architecture

| Component | Role |
|:---|:---|
| **Team lead** | The main session. Spawns teammates, coordinates, synthesises. Fixed for the session's lifetime. |
| **Teammates** | Separate full Claude Code instances, each with its own context window. |
| **Task list** | Shared work items that teammates claim and complete. |
| **Mailbox** | Per-agent JSON file used for inter-agent messaging. |

### On-disk layout

Team name is derived from the session: `session-` + the first eight characters of the session ID.

| Path | Lifetime |
|:---|:---|
| `~/.claude/teams/{team-name}/config.json` | **Removed when the session ends** |
| `~/.claude/teams/{team-name}/inboxes/{agent-name}.json` | Removed with the team config |
| `~/.claude/tasks/{team-name}/` | **Persists** — resumed sessions keep their tasks |

Both are generated automatically at session startup and updated as teammates join, idle, or leave. Task-list
retention follows `cleanupPeriodDays`, the same setting that governs session transcripts.

**Do not hand-edit or pre-author `config.json`.** It holds runtime state (session IDs, tmux pane IDs) and is
overwritten on the next state update. There is **no project-level equivalent** — a `.claude/teams/teams.json` in
your project is just an ordinary file, not configuration. To define reusable roles, use subagent definitions (§6).

`config.json` contains a `members` array of name + agent ID. The lead's entry always carries agent type
`team-lead`; a teammate's carries whatever type the lead named at spawn (built-in or subagent definition), and
omits the field if none was named. **Teammates can read this file to discover other team members** — useful when
you want a teammate to address peers it wasn't explicitly told about.

### Mailbox reliability

Every entry is validated on read. Malformed entries are reported as errors and removed; valid messages still
deliver. A send is reported successful **only** when the write to the recipient's mailbox succeeds — on failure
(disk full, directory not writable) the sender gets an error and nothing is sent.

*Before v2.1.207* a single malformed entry caused a repeating error every second and blocked that mailbox until
you deleted the file by hand.

---

## 4. Spawning teammates

Ask in natural language. Claude calls the Agent tool with a `name`, and **does not ask you to confirm**.

```text
I'm designing a CLI tool that helps developers track TODO comments across
their codebase. Spawn three teammates to explore this from different angles:
one on UX, one on technical architecture, one playing devil's advocate.
```

Claude may use subagents instead of forming a team. Subagents appear in the *same* agent panel, so the panel alone
does not confirm a team formed. If it went the subagent route, ask again and explicitly request an agent team.

### Naming

The lead assigns every teammate a name at spawn, and any teammate can message any other by that name. **Tell the
lead what to call each teammate** in your spawn instruction — otherwise you get generated names you cannot
reference reliably in later prompts.

Name constraints (shared with subagents): lowercase letters and hyphens, no `:` (reserved for plugin-scoped
identifiers). The name is what appears as `agent_type` in hook events.

### Model selection

Claude Code picks each teammate's model from the **first** of these that applies (order as of v2.1.251):

1. The model your spawn prompt names for that teammate.
2. The subagent definition's `model`, if spawned from one (`inherit` = the lead's model).
3. `CLAUDE_CODE_SUBAGENT_MODEL`, when set to anything other than `inherit`.
4. The lead's current model.

`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides all of the above and forces every teammate onto
`CLAUDE_CODE_SUBAGENT_MODEL`.

*Before v2.1.251,* `CLAUDE_CODE_SUBAGENT_MODEL` came first. `teammateDefaultModel` was removed in v2.1.234 and a
leftover value is ignored — name the model in the prompt instead.

```text
Spawn 4 teammates to refactor these modules in parallel. Use Sonnet for each teammate.
```

**Allowlist substitution.** The selected model is checked against your org's `availableModels`. When blocked:

- *Family alias* (`opus`): on the Anthropic API and Claude Platform on AWS, runs the newest permitted version of
  that family. On providers with provider-specific model IDs, falls back as below.
- *Any other blocked value*: runs on the **lead's** model. If `CLAUDE_CODE_SUBAGENT_MODEL` is set, that is tried
  first under the same rules.

### Effort

Teammates inherit the lead's effort level. In split-pane mode this holds from v2.1.186; earlier versions did not
pass session effort to split-pane teammates.

### Plan-before-implement

Put the **lead** into plan mode first, then ask for the teammate. A teammate spawned while the lead is in plan mode
works read-only until its plan is ready.

```text
Spawn an architect teammate to refactor the authentication module.
```

> **Warning.** When the teammate finishes planning it sends a plan approval request, and the lead session approves
> it immediately — without the lead reviewing it and without prompting you. Edits and commands still go through
> normal permission prompts, but the plan gate itself is not a human gate. Do not treat teammate plan mode as a
> review checkpoint.

---

## 5. Display modes

| Mode | Behaviour | Requires |
|:---|:---|:---|
| `in-process` (**default**) | All teammates run in your main terminal, selected via the agent panel | Nothing |
| `tmux` | Split panes; auto-detects tmux vs iTerm2 from your terminal | tmux or iTerm2 + `it2` |
| `iterm2` (v2.1.186+) | iTerm2 native split panes explicitly | `it2` CLI + Python API enabled |
| `auto` | Split panes if already inside tmux, or iTerm2 with `it2`; else in-process | — |

Default became `"in-process"` in **v2.1.179** (previously `"auto"`), so upgraded sessions that used to open split
panes now stay in one terminal unless set explicitly.

```json
{ "teammateMode": "auto" }
```

```bash
claude --teammate-mode auto
```

`--teammate-mode` is experimental and absent from `claude --help`.

Split-pane setup: tmux via your package manager; iTerm2 needs the [`it2` CLI](https://github.com/mkusaka/it2) plus
**iTerm2 → Settings → General → Magic → Enable Python API**. `tmux -CC` inside iTerm2 is the suggested entrypoint.

**Split panes are not supported in VS Code's integrated terminal, Windows Terminal, or Ghostty.**

### Agent panel controls (in-process)

| Key | Action |
|:---|:---|
| Up / Down | Select a teammate |
| Enter | Open the selected teammate's transcript and message it directly |
| Esc | Clear selection; **while viewing a teammate, interrupts that teammate's current turn** |
| `x` | Stop the selected teammate |
| Ctrl+T | Toggle the task list |

**Idle rows (v2.1.199+):** an idle teammate's row stays visible while *any* agent is still working. Once everything
is idle, idle rows hide after 30 seconds and reappear on the teammate's next turn — the teammate stays running and
addressable while hidden. When more than three are idle, the surplus collapses into a single `N idle agents` row;
Enter expands, Esc re-collapses. Working, failed, and currently-viewed teammates always keep their own rows.

*v2.1.181–v2.1.198:* a row hid 30s after its own turn ended, even while others worked. *Before v2.1.181:* never hidden.

### Typing while viewing a teammate

Plain text and skills go **to that teammate**; built-in slash commands still run in the **lead's** session.

- `/model` and `/fast` — a teammate's model and fast mode are **fixed at spawn**, so these only change the lead.
  v2.1.199+ shows a notice; earlier versions silently applied to the lead.
- `/effort` — **does** apply to the viewed teammate's later turns, since teammates follow the lead's effort level.

---

## 6. Subagent definitions as reusable teammate roles

Define a role once in `.claude/agents/` (or user/plugin/CLI scope) and reuse it as both a delegated subagent and a
teammate.

```text
Spawn a teammate using the security-reviewer agent type to audit the auth module.
```

### What actually carries over — and what silently does not

| Definition field | In-process teammate | Split-pane teammate |
|:---|:---|:---|
| `tools` | Limited to the list, **plus** `SendMessage` — and `TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate` when the session has Task tools | Limited to the list |
| `model` | Used when the spawn prompt names none | Same |
| **Body (system prompt)** | **Appended to** the default teammate system prompt | **Replaces** the default system prompt |
| `skills` | **Ignored** — teammate loads skills from project/user settings | **Ignored** |
| `mcpServers` | **Ignored** — loads from project/user settings | Applied, under the normal subagent MCP rules |

> Two traps worth internalising: **`skills` never applies to a teammate in either mode**, and the **body is
> appended in-process but replaces the prompt in split-pane** — the same definition produces a materially different
> agent depending on display mode. If a role depends on preloaded skills, put the instruction in the body instead.

### Definition frontmatter (relevant subset)

| Field | Required | Notes for team use |
|:---|:---|:---|
| `name` | yes | lowercase + hyphens, no `:`. Surfaces as `agent_type` in hooks. |
| `description` | yes | When Claude should delegate to it |
| `tools` | no | Omit to inherit everything. `Agent(type1, type2)` restricts spawnable types; `mcp__<server>` patterns supported |
| `disallowedTools` | no | Removed from the inherited/specified list |
| `model` | no | `sonnet` / `opus` / `haiku` / `fable` / full ID / `inherit` |
| `permissionMode` | no | Ignored for plugin subagents. Note teammates start from the **lead's** mode (§7) |
| `maxTurns` | no | Output marked partial when hit |
| `effort` | no | `low`…`max`; overrides session effort |
| `isolation` | no | `worktree` → temporary git worktree. Useful to prevent file conflicts |
| `color` | no | Display colour in task list and transcript |
| `background` | no | **Do not set for teammate-spawned subagents** — see §12 |

Scope priority when names collide: managed settings → `--agents` CLI → `.claude/agents/` → `~/.claude/agents/` →
plugin `agents/`. Project and user directories are scanned recursively; identity comes only from `name`.

---

## 7. Permissions and the trust boundary

- Teammates **start with the lead's permission settings**. `--dangerously-skip-permissions` on the lead means all
  teammates run that way too.
- You **cannot set per-teammate modes at spawn time**. You can change an individual teammate's mode afterwards.
- **Teammate permission prompts appear in the lead session** — approve them there. Plan approval is the designed
  exception and is auto-granted (§4).

### Inter-agent messages are untrusted input

When one agent messages another over `SendMessage`, the recipient is told the message came from **another Claude
session, not from you**. Consequently:

- A teammate cannot approve a permission prompt or supply consent on your behalf.
- A teammate denied an action **cannot relay it to another teammate to bypass the check**.
- The same rules apply to messages arriving from your other sessions via cross-session messaging.

In **auto mode** the classifier additionally:

- treats a relayed approval claim as untrusted input rather than confirmation from you;
- reviews every message before delivery — plain messages *and* structured protocol messages (shutdown requests,
  plan approval responses). A blocked message never reaches the recipient.

### Reducing prompt friction

Teammate prompts bubbling to the lead is the main source of interruption. **Pre-approve common operations in your
permission settings before spawning** rather than approving them N times mid-run.

---

## 8. Task list and coordination

Three states: **pending → in progress → completed**. Tasks may declare dependencies; a pending task with unresolved
dependencies cannot be claimed until they complete. Claude Code unblocks dependents automatically on completion.

Two assignment paths:

- **Lead assigns** — you tell the lead which task goes to which teammate.
- **Self-claim** — a teammate finishing a task picks up the next unassigned, unblocked task itself.

Claiming uses **file locking**, so simultaneous claims do not race.

Agents **without the Task tools** coordinate through messages instead of the shared list. Whether a session has
them is per `/docs/en/tools-reference#task-tool-availability` — do not assume the list exists.

### Information flow

- **Automatic delivery** — messages are pushed to recipients; the lead does not poll.
- **Idle notifications** — a teammate that finishes notifies the lead and **includes its final answer**. A teammate
  whose turn ends on an API error notifies the lead with the error text.
- **Shared task list** — visible to agents that have the Task tools.
- **Direct messaging** — one recipient per message. **To reach everyone, send one message per recipient**; there is
  no broadcast.

### Context each teammate starts with

Loads like a regular session: **CLAUDE.md, MCP servers, and skills**, plus the spawn prompt from the lead.
**The lead's conversation history does not carry over.** This is the single biggest cause of underperforming
teammates — see §10.

### Shutdown

```text
Ask the researcher teammate to shut down
```

The lead sends a shutdown request; the teammate may approve and exit gracefully, or **reject with an explanation**.
Shared directories are cleaned up automatically at session end — no separate cleanup step.

---

## 9. Quality gates via hooks

Three team-specific hook events. All three block on **exit code 2**, with the message taken from stderr or your
JSON's blocking reason.

| Event | Fires when | Matcher | Exit 2 effect |
|:---|:---|:---|:---|
| `TeammateIdle` | A teammate is about to go idle | Yes — on `agent_type` | Teammate does **not** go idle; keeps working |
| `TaskCreated` | A task is being created | No | Rolls back the creation |
| `TaskCompleted` | A task is being marked complete | No | Prevents completion |

`TeammateIdle` matchers run against `agent_type` and accept regex — e.g. `Explore`, `custom-reviewer`, `.*-reviewer`.

Common input fields on all three: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`,
`hook_event_name`. `TeammateIdle` additionally carries `agent_type` and `agent_id`; the `Task*` events carry a
`task` object.

> **Unverified.** The published hooks page does not fully enumerate the `task` object's fields. Log a real payload
> before writing a hook that depends on specific keys, rather than trusting a reconstructed schema.

All three honour `systemMessage` and `terminalSequence` in JSON output. Neither `Task*` event supports matchers, so
filtering must happen inside your script.

```json
{
  "hooks": {
    "TeammateIdle": [
      {
        "matcher": ".*-reviewer",
        "hooks": [
          { "type": "command", "command": "/path/to/verify-review-complete.sh" }
        ]
      }
    ]
  }
}
```

**The high-value pattern:** `TeammateIdle` + exit 2 is the only mechanism that stops a teammate declaring victory
early. Use it to assert the deliverable actually exists (tests ran, file written, findings recorded) before letting
the teammate idle.

---

## 10. Prompt playbook

Patterns built on the documented behaviour above. The recurring theme: teammates inherit **no** conversation
history, so everything they need goes in the spawn prompt.

### Pattern A — Parallel review by distinct lens

A single reviewer gravitates to one class of issue. Split the criteria so each gets full attention, and assign
non-overlapping lenses.

```text
Spawn three teammates to review PR #142:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

### Pattern B — Competing hypotheses (adversarial)

Sequential investigation suffers anchoring: once one theory is explored, everything after is biased toward it.
Make the teammates explicitly adversarial so the surviving theory is the one that withstood attack.

```text
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk to
each other to try to disprove each other's theories, like a scientific
debate. Update the findings doc with whatever consensus emerges.
```

The debate structure *is* the mechanism — without "try to disprove each other," you get five parallel confirmations.

### Pattern C — Fully-specified spawn prompt

The documented shape of a prompt that does not under-inform its teammate:

```text
Spawn a security reviewer teammate with the prompt: "Review the authentication module
at src/auth/ for security vulnerabilities. Focus on token handling, session
management, and input validation. The app uses JWT tokens stored in
httpOnly cookies. Report any issues with severity ratings."
```

Note the four ingredients: **scope** (path), **focus areas**, **context the lead knows but the teammate cannot**,
and **output format**.

### Pattern D — Ownership partition to avoid conflicts

Two teammates editing one file means overwrites. State the partition explicitly, and reach for `isolation: worktree`
in a definition when the work genuinely must touch overlapping ground.

```text
Spawn three teammates. Teammate `api` owns src/server/** only.
Teammate `ui` owns src/client/** only. Teammate `tests` owns test/** only.
No teammate may edit files outside its own directory — if you need a change
elsewhere, message the owning teammate instead.
```

### Steering phrases that fix common failures

| Symptom | Say this |
|:---|:---|
| Lead starts doing the work itself | `Wait for your teammates to complete their tasks before proceeding` |
| Too few tasks created | `Split the work into smaller pieces` — aim for 5–6 tasks per teammate |
| Lead declares done prematurely | Tell it to keep going; verify tasks are genuinely complete |
| Teammate stalled after an error | Message it directly, or spawn a replacement to continue |

---

## 11. Sizing, cost, and operating discipline

**Team size: start with 3–5.** No hard limit exists, but three constraints bite:

- **Token cost scales linearly** — each teammate is a separate context window consuming tokens independently.
- **Coordination overhead rises** — more messaging, more task churn, more conflict potential.
- **Diminishing returns** — beyond a point, extra teammates do not speed things proportionally.

> Three focused teammates often outperform five scattered ones. With 15 independent tasks, 3 teammates is a good
> starting point — not 15.

**Task sizing:**

- *Too small* → coordination overhead exceeds the benefit.
- *Too large* → teammates run long without check-ins, risking wasted effort.
- *Right* → a self-contained unit with a clear deliverable: a function, a test file, a review.

Aim for **5–6 tasks per teammate**: it keeps everyone productive and lets the lead reassign if someone gets stuck.

**Prompt caching:** an in-process teammate's requests fall **outside the main conversation's cache TTL bucket**, so
its cache holds for **five minutes** by default — including on a Claude subscription. Set
`subagentPromptCacheTtl` to `1h` to extend it; note the API bills 1-hour cache writes at a higher rate. This
matters most for teammates that sit idle between long gaps.

**Operating discipline:**

- **Start with research and review** if you're new to teams — clear boundaries, no parallel-write coordination.
- **Monitor and steer.** Check progress, redirect approaches that aren't working, synthesise as findings arrive.
  Letting a team run unattended is the main way tokens get wasted.

---

## 12. Limitations

Current, documented, experimental-status limitations:

- **No session resumption with in-process teammates** — `/resume` and `/rewind` do not restore them. After resuming,
  the lead may try to message teammates that no longer exist; tell it to spawn new ones.
- **Task status can lag** — teammates sometimes fail to mark tasks complete, blocking dependents. Check whether the
  work is actually done and update status manually or nudge the teammate.
- **Shutdown can be slow** — teammates finish the current request or tool call first.
- **One team per session** — exactly one, scoped to that session. No additional named teams, no sharing across
  sessions.
- **No nested teams** — teammates cannot spawn teammates. Only the lead manages the team.
- **No background subagents from in-process teammates** — a teammate's subagents run in the foreground, because a
  teammate's background work cannot outlive the lead's process. Spawning a subagent whose definition sets
  `background: true` returns an error; a `run_in_background: true` request also fails or silently runs foreground.
- **Lead is fixed** — the main session leads for its lifetime. No promotion, no transfer.
- **Permissions set at spawn** — all teammates start with the lead's mode; change individually afterwards.
- **Split panes require tmux or iTerm2** — unsupported in VS Code's integrated terminal, Windows Terminal, Ghostty.

---

## 13. Troubleshooting

**Teammates not appearing**
- In-process: they're in the agent panel below the prompt input — Up/Down to select, Enter to view.
- A vanished row is **hidden, not stopped**. Idle rows hide 30s after the whole panel goes idle; more than three
  idle collapse into `N idle agents`. Message the teammate by name to bring it back.
- Check the task was complex enough to warrant a team — Claude decides.
- For split panes: `which tmux`; for iTerm2 verify `it2` is installed and the Python API is enabled.

**Claude spawns teammates instead of subagents** — expected while teams are enabled (§2). Set the env var to `"0"`;
no restart needed. Watch the precedence trap. Afterwards Claude may still *name* subagents, and the name still
works as a `SendMessage` address.

**Too many permission prompts** — pre-approve common operations before spawning.

**Agents stopping early** — teammates may stop on errors rather than recovering. Open the teammate (Enter in-process,
click the pane in split mode) and either give direct instructions or spawn a replacement. A message from the lead or
another teammate **wakes an in-process teammate waiting to retry a failed API request**, so it retries immediately
instead of waiting out the delay. The lead can also finish early — tell it to keep going.

**Orphaned tmux sessions**

```bash
tmux ls
tmux kill-session -t <session-name>
```

**Mailbox write failures** — see `/docs/en/errors#failed-to-write-to-a-teammate-inbox`.

---

## 14. This repo

- **The team roster lives in [`.claude/agents/`](../.claude/agents/README.md)** — `architect`,
  `implementer`, `qa`, `auditor`, `refactorer`, `product-manager`. The architect runs as the main
  session (`claude --agent architect`), since a teammate cannot spawn or direct other teammates (§12).
- Agent teams are enabled here via `.claude/settings.local.json` (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"`).
  That file is gitignored, so **teammates are opt-in per developer** — a fresh clone does not get teams.
- The env var is read at session start; a session already running when it was added will not have teams until
  restarted.
- **This project develops on Windows.** Split-pane mode is effectively unavailable: it needs tmux or iTerm2, and
  Windows Terminal is explicitly unsupported. Plan on **in-process mode**, which is also the default since v2.1.179.
- Consequences of in-process mode here: subagent-definition **bodies are appended** (they do not replace the default
  prompt), definition `mcpServers` are **ignored** in favour of project/user config, and a teammate's own subagents
  always run in the foreground. The entire split-pane column of §6 is not applicable.

---

## 15. Verification notes

- Primary page fetched 2026-09-03; it self-describes as current for **v2.1.178**, with inline notes for v2.1.179,
  v2.1.181, v2.1.186, v2.1.196, v2.1.198, v2.1.199, v2.1.207, v2.1.234, and v2.1.251. Confirm your installed
  version before relying on version-gated behaviour.
- `TaskCreated` / `TaskCompleted` **`task` object fields are not fully published**; capture a live payload before
  depending on them (§9).
- `TeamCreate` and `TeamDelete` tools **no longer exist**. The `team_name` input on the Agent tool is accepted but
  ignored, and `team_name` in `TaskCreated` / `TaskCompleted` / `TeammateIdle` hook payloads carries the
  session-derived name and is **deprecated**. Ignore any older guidance that says to create and name a team first.
