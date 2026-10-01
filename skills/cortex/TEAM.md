# The agent team — asking, and writing

`/cortex` reads this when the `team` row is in the worklist. The design is
[the agent-team spec](../../docs/specs/2026-09-28-agent-team-design.md) (T4, T6, T9); the templates
and their placeholders are in `${CLAUDE_PLUGIN_ROOT}/templates/team/README.md`.

`cortex-loop.mjs . --json` carries the row's facts in `state.agentTeam`:

| Field | What it is | What you do |
|---|---|---|
| `offer` | roles no agent here plays, each with its file and its `needs` | one yes/no **per role** (T4) |
| `withheld` | roles not offered, with `why`: an agent plays it, no plan folder for the Project manager, or another agent already has the role's file or name | name each once; never offer it |
| `covered` | role → the agents playing it | confirm each mapping (below) |
| `unmapped` | agents the mapper would not guess about | ask what role each plays, if any |
| `upgrade` | the verifier, offered the Reviewer's template (T9) | one yes/no |
| `proposals` | per existing agent, edits provable from its file | one question per agent, with the diff |

## The questions

1. **Confirm the mapping first.** "`code-reviewer` plays the reviewer — right?" A mapping is the
   mapper's guess from words and tools; the developer's answer wins. For a no, or for an unmapped
   agent they place, re-read with `--as <agent path>=<role>` or `--as <agent path>=none`, repeated
   per agent. Then the offer is recomputed, so a role freed by a no is offered.
2. **Each role on `offer` is its own line in the playback** — `[x] architect  [ ] implementer …`.
   `[a]ll` ticks them all; a user can untick any. Say that the Project manager is offered only where
   a plan folder exists, when it is withheld for that reason.
3. **The upgrade.** "Replace the verifier with the Reviewer? It keeps the verifier's rule of changing
   nothing and adds the review against `REVIEW.md` and the docs. No keeps the verifier, and it stays
   the reviewer." If `cortex-stamps.mjs . --json` says the verifier is `edited` or `conflict`, show
   that diff first: the upgrade replaces the team's edits. On a first pass that offers both the
   verifier row and the Reviewer, write the Reviewer only — two agents doing one check is what T9
   rejects.
4. **Each agent's proposals** are asked per agent and never covered by `[a]ll`: the file is the
   team's, not Cortex's. Show each proposal as a diff — its `line`, `current`, and the `text` that
   replaces it (`replace`), goes before it (`insert-before`), ends the sentence on it (`extend`) or
   follows it (`append`) — with its `why`. Apply only what they accept, by hand, and keep every other
   line. These files are never recorded in `stamps.json`.

## Writing

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-loop.mjs" . --team architect,tester [--as <path>=<role> ...]
```

`--team none` when no role was picked but the existing agents are the team. It writes nothing and
prints `{ files, values, needs, conflicts, upgrade }`, or refuses a pick that is not on offer, naming why.

1. Put each of `conflicts` to the user first, before anything is written: today that is a
   `.claude/skills/team/SKILL.md` Cortex did not write, which the playbook would load in place of the
   team protocol. It is never overwritten.
2. Put `values` in the values file. Ask each of `needs` — its `question` is written for the user —
   and add the answer under its `placeholder`. Never invent one: an agent told to run a command the
   repo never declared fails the first time it runs.
3. Walk `files` in order:
   - `write` — render as in step 7's *Render each whole-file row*, from `team/<template>`. The
     Tester's `test-paths.sh` comes with `tester.md` and never alone; the hook runs it through `bash`,
     so no executable bit is needed.
   - `append` — render `team/playbook.md` and append it to `CLAUDE.md`, like the verification block.
   - `roster` — the block is already there: replace its roster line with the new `ROSTER`, nothing else.
4. When `upgrade` is set, delete `upgrade.remove` and drop it from the record:
   `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-stamps.mjs" forget . .claude/agents/verifier.md`.
5. Format, then `record` every `write` file with the same values file, as step 7 says. The playbook
   is not recorded.

Everything here lands under `.claude/`, so an unattended run needs `--permission-mode auto`
([Running unattended](RUNS.md#running-unattended)).

## A re-run: the section in `CLAUDE.md`

The playbook is a section of a file the team also writes, so `.cortex/stamps.json` cannot hold it.
`cortex-section.mjs . --json` compares it with every playbook Cortex has shipped instead, each filled
with the roster the section already names. Its `state` decides the row:

| `state` | Row |
|---|---|
| `current` | nothing |
| `outdated` | an earlier release's text, untouched. It goes in the *Update* row of the one confirmation, with its `diff` shown; the roster is kept. On yes: `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-section.mjs" . --replace team`. With `unfilled` non-empty the CLI refuses it: name it and offer nothing |
| `edited` | the team changed it. Show the `diff` under *Ask each* and ask whether they want any of the new text. It is never replaced: a line they want, they take by hand. Once they have answered, whatever the answer, record it: `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-section.mjs" . --keep team`. That writes `.cortex/sections.json` only, and the section reads `kept` until a release changes the playbook. A `why` that says the team kept it against an earlier text means that has happened: say so when you show the diff |
| `kept` | nothing. The team edited it and kept it, and this release's playbook is the one they kept it against |
| `duplicate` | say its `why`, and offer nothing until one section is left |

The replace changes the section and not one byte around it, and refuses anything but `outdated`.
The keep refuses anything but `edited`.
Never rewrite the section yourself. A roster change in the same pass works in either order, because
the roster is read from the section.
