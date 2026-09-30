# 0020. The vault rituals stay in the one plugin

**Date:** 2026-09-30
**Status:** accepted

## Context

Every skill the plugin ships puts its name and description into every session, in every repo that
has Cortex installed, whether the ritual is ever run there or not. The personal-vault rituals are
the obvious waste for someone who only uses Cortex on codebases. `/capture`, `/daily`,
`/weekly-review`, `/level-up`, `/audit`, `/reindex`, `/cortex-audit`, `/scan-projects` and
`/catch-me-up` do nothing without a vault. [ADR 0001](0001-two-repos-not-two-packages.md) moved
the vault's *content* into its own repository for exactly this reason: "every installer still
carries rituals about daily notes they will never run". The rituals themselves stayed here.

Splitting them into a second plugin was proposed on 2026-09-30, with an estimate of "~4,000 tokens
a session". That estimate was the size of **all** 45 descriptions. Measured by the skill, from
frontmatter, on 2.41.3:

| Set | Description characters | ≈ tokens |
|---|---|---|
| Every skill the model can invoke (39 of 45) | 15,557 | 3,900 |
| The nine vault rituals above | 2,868 | 720 |

`/onboard` and `/connect-brain` are vault rituals too, but they already carry
`disable-model-invocation: true`, so their descriptions are not loaded.

So a split saves about 720 tokens a session, 18% of the listing, and only for users who never touch
a vault.

What Claude Code allows, from its documentation as read on 2026-09-30:

- A plugin's default `skills/` directory is always scanned. A `skills` path in `plugin.json` "adds
  to the default", and nothing excludes part of it
  ([manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference.md)). Removing
  the vault rituals from `cortex` means moving them out of `skills/`.
- A marketplace may list two plugins from one repository, `"."` and a subdirectory such as
  `"./vault"` ([marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference.md)).
- An installed plugin cannot reach a file outside its own directory. A path with `..` fails
  validation, and only a symlink inside the plugin works
  ([troubleshooting](https://code.claude.com/docs/en/plugins/troubleshooting.md)). The vault
  rituals use `templates/vault/`, `templates/vault-AGENTS.md`, `tools/cortex.sh`, `mcp/` and
  `agents/cortex-auditor.md`, all of which the codebase half also uses or ships.
- `skillOverrides` in settings can hide a skill per user, but "Plugin skills are not affected by
  `skillOverrides`" ([skills](https://code.claude.com/docs/en/skills.md)).
- `disable-model-invocation: true` takes a description out of context entirely. The skill then runs
  only when the user types `/name`, never from natural language such as "capture this"
  ([skills](https://code.claude.com/docs/en/skills.md)).

## Decision

The vault rituals stay in the `cortex` plugin, in `skills/`, invocable by the model as today.

## Alternatives rejected

| Option | Why not |
|---|---|
| A second plugin, `cortex-vault`, from `./vault` in this repository | Saves ~720 tokens a session, for a breaking change. The nine rituals and everything they use would have to move under `vault/` or be duplicated there, because an installed plugin cannot reach outside its directory. Symlinks would avoid the copy, but git on Windows checks them out as plain files by default. Everyone using the vault would install a second plugin, which makes it a major release. |
| `disable-model-invocation: true` on the nine rituals | Saves the same ~720 tokens in a few lines. But a vault user loses natural-language triggering: "capture this" stops reaching `/capture`. That is the ritual's whole interface, and `docs/changing-cortex.md` keeps the flag for rituals that are once-only, destructive, or reached by name. |
| `skillOverrides`, documented for users who want them hidden | It does not apply to plugin skills. |
| A separate repository for the vault rituals | ADR 0001's argument for two repositories was data-free distribution, and it holds. This would split the rituals' code from `mcp/` and the templates they share, and still need a second plugin. |

## Consequences

A codebase-only user carries ~720 tokens of vault descriptions in every session. That is the cost
accepted here.

Revisit if any of these becomes true, and measure again before deciding:

- The vault set grows past about a third of the listing. That is roughly 5,000 characters at
  today's size, and a new vault ritual is the usual way it happens.
- Claude Code lets a plugin exclude part of `skills/`, or apply `skillOverrides` to plugin skills.
  Either would make the saving free for users who want it.
- The listing starts to be cut short. Claude Code has a total budget it does not state, and when
  the listing exceeds it, it writes a warning to the `--debug` log. The Skills row of `/context`
  shows the size after the budget is applied.

Measure with:

```bash
for f in skills/*/SKILL.md; do
  fm=$(awk '/^---$/{c++; next} c==1' "$f")
  printf '%s\n' "$fm" | grep -q '^disable-model-invocation: true' && continue
  printf '%s\n' "$fm" | awk '/^description:/{f=1} f&&/^[a-z-]+:/&&!/^description:/{f=0} f' | wc -c
done | awk '{t+=$1} END{print t " description characters loaded"}'
```

The larger lever is every ritual's description, not the vault's: 15,557 characters across 39
skills, of which the vault's are under a fifth.
