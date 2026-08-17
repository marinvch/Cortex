# 0005. The install sequence may start itself; consent gates the first write

**Date:** 2026-08-17
**Status:** accepted

## Context

Cortex's design promises that when it lands on a repo which already has code, the install sequence
**fires** — index, report, the user picks, then apply. It never did. `/cortex-install` carried
`disable-model-invocation: true`, so nothing could start it but a human typing its name.

That flag had no stated reason. `AGENTS.md` justifies it for `/onboard`, `/migrate-engine`,
`/team-init` and `/connect-brain` — all once-only or destructive — and `core/test/plugin.test.js`
guards exactly those four. `/cortex-install` was in neither list, yet carried the flag. It is
read-only by construction: steps 1–3 write nothing outside `.cortex/`, and the skill that changes a
repository (`/cortex-scaffold`) is a different skill the user invokes directly. The flag was
inherited from the destructive rituals rather than reasoned about, and it blocked the sequence the
design was built around.

Removing it raises the real question, which the flag had been hiding: an agent that can start the
sequence writes `.cortex/index/` and `.cortex/findings/` into someone's repository on a run they
did not ask for. Those directories are generated and gitignored — but *generated and gitignored is
not the same as invisible*. They are files appearing in a project, and a tool that creates them
unbidden on first contact is a tool people stop trusting.

## Decision

`/cortex-install` is **model-invocable**. An agent may start it when a repo plainly needs it — no
`AGENTS.md` and an agent about to re-derive the architecture from scratch is the motivating case.

Protection moves from the invocation flag to a **consent gate on the first write**:

- **No `.cortex/` yet** — ask before writing anything, including the index. State what will be
  written, that it lands only in `.cortex/` and never in source, and wait for a yes.
- **`.cortex/` exists** — Cortex is established here. Re-index freely; the consent was given once.
- **Reading is never gated.** Orienting — `AGENTS.md`, the tree, the manifest — needs no permission
  and never did.

The structural guarantee is unchanged and is what makes this safe: the skill that analyses has no
authority to modify a repository, because that authority lives in a different skill.

## Alternatives rejected

**Ship a `SessionStart` hook that indexes automatically.** Closest to "fires by itself", and
rejected as the most invasive option. The plugin ships **no hooks at all** today — `plugin.json`
declares only an MCP server — so this is new shipped capability, not a configuration change. It
also runs before the user has expressed any intent, which is precisely the case the consent gate
exists to prevent.

**Split off a read-only "orient" skill** that reads an existing index but can never create one,
leaving `/cortex-install` human-only. Safe, and rejected as a second spelling of a ritual Cortex
already ships — the failure mode named throughout the 2026-08-17 skills harvest. It also solves
nothing for the motivating case: a repo with no index is exactly where an agent needs to act.

**Leave it manual.** Rejected because it silently abandons a promise the design makes. If the
sequence can only ever be typed, the design should say so rather than describing a wizard that
fires.

## Consequences

`core/test/plugin.test.js` now asserts `/cortex-install` is model-invocable **and** that the
consent gate is stated in the skill — the flag being absent is only safe while the gate is present,
so the two are tested together. The four genuinely destructive rituals keep their flag and their
existing guard.

`AGENTS.md` previously implied the flag marks rituals an agent may not auto-fire. That is still
true, but the reason is once-only-or-destructive, **not** read-only-ness — a read-only ritual is
free to be model-invocable. The gotcha now says so, so the next reader does not re-add the flag to
`/cortex-install` on the grounds of consistency.
