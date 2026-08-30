---
name: plugin-sync
description: Make the Cortex a session actually runs match the Cortex in the repo — check the three copies (repo, marketplace clone, installed cache), update the ones that are behind, refresh the local slash-command mirror, and verify the version moved. Use after editing a skill and finding the change had no effect, and on "update the plugin", "reload the skills", "restart and try again", "the plugin cache is old", "my change isn't showing up", "why is it running the old version".
capability: mechanical
---

# /plugin-sync — make the running Cortex the one you edited

A plugin reaches a session through three copies:

```
repo VERSION  →  marketplace clone  →  installed cache  →  this session
(what you edit)  (what update pulls)   (what actually runs)
```

Nothing announces a mismatch. Every command is present, every skill loads, and the model follows
last week's instructions against this week's code. So a fix you just wrote appears not to work, and
the obvious conclusion — the fix is wrong — is the wrong one. People lose hours re-writing a correct
change.

**Suspect this before debugging a skill that "didn't take".**

## 1. Ask which copies disagree

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-plugin-check.mjs"
```

It prints all three stages and which are behind. Read the **installed cache** line: that is the one
deciding behaviour. The repo sitting ahead of both copies mid-release is normal and not a defect.

## 2. Update — both steps

Updating the marketplace alone does **not** move the installed plugin. That is the whole trap: the
marketplace is a git clone that pulls happily and changes nothing about what runs.

1. Update the marketplace — it is the git clone the installer reads from.
2. Update the **installed** plugin.
3. **Restart the session.** A running session holds the skills it loaded at start; no update reaches
   it in place.

Prefer the `/plugin` UI or `claude plugin` CLI over hand-editing anything under `~/.claude/plugins/`
— the registry there is the installer's bookkeeping, and a hand-edited entry disagrees with the
directory it names.

## 3. Verify it moved

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-plugin-check.mjs" --check
```

Exit 0 means the running copy matches the repo. **Do not skip this** — the failure being fixed is
precisely a change that looked applied and was not, so an update reported as done is the same
evidence you already had. If the number did not move, the update did not take; find out why rather
than repeating it.

## 4. In this checkout, the mirror too

`skills/` is canonical and is what an installed plugin loads. `.claude/skills/` is a gitignored,
machine-local mirror exposing the rituals as slash commands **in this checkout only** — and because
it is gitignored, nothing keeps it current.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/tools/cortex-sync-skills.sh" --check   # report drift, change nothing
bash "${CLAUDE_PLUGIN_ROOT}/tools/cortex-sync-skills.sh"           # sync
```

Not a hand-rolled `cp -r`: that copies once and thereafter never refreshes a changed skill or removes
a deleted one, which is how the mirror drifted to 22 of 30 skills with 9 stale copies.

Working from a checkout rather than an install? Then the mirror is the only copy that matters and
steps 1–3 do not apply. `cortex-plugin-check.mjs` says so rather than inventing a version.

## Gotchas

- **A skill edit needs a restart even in this checkout.** Syncing the mirror updates files on disk;
  the session already loaded the old ones.
- **If the versions match and the skill still misbehaves, it is the skill.** That is the point of
  checking first — it converts "my change did nothing" from a guess into a fact. `/skill-creator`
  step 5 is where a skill gets read back and tested.
- **The MCP server is a separate lifecycle.** `/mcp` shows whether it connected. A failed connection
  is not a version problem and updating the plugin will not fix it — read the server's error first.
- **Version numbers are never hand-edited**: `node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-version.mjs" --set <x.y.z>` stamps
  every site at once. Editing one by hand is how the three copies started disagreeing.
