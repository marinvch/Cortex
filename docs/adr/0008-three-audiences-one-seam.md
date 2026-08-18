# 0008. Three audiences behind one seam; the resolver never invents a root

**Date:** 2026-08-18
**Status:** accepted

## Context

Cortex claims to serve three audiences — solo developers, teams, and self-hosted/server setups. In
practice only solo was ever exercised. `/team-init`, `/team-add` and a connector file existed;
`tools/server/` existed. Nothing tied them to the running brain.

The leak was visible in the tool surface. `capture` and `catch_me_up` took `team` as an **argument**,
so the calling agent had to know it was on a team before it could act like it. That is precisely
backwards: the seam exists so the dev side asks for `capture` and gets capture, never learning which
world answered. An agent that must be told its own context is not behind a seam.

Two questions had to be settled before any of it could be wired.

## Decision

**One resolver, `mcp/lib/resolve.js`**, answers where the brain is and who it serves:
`resolveBrain({ cwd, env }) → { audience, root, team, teamClone, source }`. `server.js` resolves once
at startup, and `capture` / `catch_me_up` take their team from the resolution. The `team` argument
survives as an **explicit override**, not the switch that enables team mode.

### The resolver never invents a root

The three-mode spec describes a fallback chain: `.cortex/connector.json`, then `AI_OS_ROOT`, then a
repo-local `.cortex/memory/`. `mcp/AGENTS.md` says the opposite, and `server.js` has always enforced
it: *"`AI_OS_ROOT` unset is a hard exit, not a default. Guessing a vault path would write someone's
notes into the wrong place."*

**The invariant wins.** A resolver that invents a root is a resolver that can file a private note
into a work repository — the exact failure the employer firewall exists to prevent, arriving through
the back door as a convenience feature. `AI_OS_ROOT` unset, or whitespace-only, throws `NoRootError`.
The resolver *detects* the audience and *locates* the team clone. It never conjures the root itself.

### `audience` is a third axis, not a rename of `mode`

`mcp/lib/mode.js` already owns `mode`: repo versus vault, decided by whether the root ends in
`.cortex`. Solo/team/server is **orthogonal** — a repo-mode brain can run on a server, a vault-mode
brain can belong to a team. Reusing one word for two independent questions would weld them together
and guarantee a future bug where changing one silently changes the other.

The spec's own framing is "three audiences", so the code says `audience`. This also keeps the env var
`CORTEX_AUDIENCE` clear of `CORTEX_MODEL`, which `tools/server/cortex-cron.sh` already reads and
which sits one character from `CORTEX_MODE`.

### Server is declared, not detected

Solo and team are facts about the filesystem: a connector means team, its absence means solo. Server
is not a fact about the filesystem. The spec defines it as solo *minus* interactive prompts, *plus* a
scheduler, *plus* a model that is not Claude Code — none of which leaves a trace to read.

So server is declared with `CORTEX_AUDIENCE=server`, and **declaring beats detecting**: a scheduled
run on a host that happens to sit inside a connected repo is still a server run. The asymmetry
between two detected audiences and one declared one is the honest answer, not a wart to paper over.

### Degrade, do not die

A malformed `connector.json` resolves to solo with `source: "unreadable:<path>"`. A brain that
refuses to start because one JSON file is corrupt has turned a papercut into an outage. `source`
exists for exactly this: a resolver that cannot explain its own answer is one nobody trusts the
moment it is wrong.

## Alternatives rejected

**The spec's fallback chain.** Rejected above — it contradicts a documented safety invariant. Kept
here by name so it is not re-proposed as an obvious improvement.

**Reuse `mode` for both axes.** Fewer concepts, and wrong. They are independent questions, and the
combined values (`repo+server`, `vault+team`) are all reachable.

**Detect server from the absence of a TTY.** Tempting, and wrong in CI every single time — where an
agent is emphatically not a scheduled server run. A heuristic that is wrong in a common case is worse
than a flag.

**Resolve per call rather than once at startup.** Would let a long-running server follow the agent
into a different repo. Rejected as surprising: the brain a session started with is the brain it
should keep, and a `cwd` change is not consent to write somewhere new.

## Consequences

`capture` in a connected repo now reaches the team brain without anyone asking for it, which is the
point — and it means the connector file is load-bearing in a way it was not before. The startup line
reports `audience` and `source` on **stderr** (never stdout, which is the protocol channel) so a
silently-solo brain is visible rather than mysterious.

Server mode remains **mostly subtraction**, and most of that subtraction lives in markdown rituals
rather than in code. What this pass gives it is honesty about which audience is being served; the
ritual-side work — declaring a minimum model capability for `/level-up` and `/cortex-audit`, which
assume a strong model — is a separate, still-open question.

Two live bugs surfaced in `tools/server/cortex-cron.sh` while reading the server half: a
`CORTEX_MODEL` default pointing at a model id that no longer exists (every scheduled run would fail),
and `BRAIN_DIR` as a private variable name for what the rest of Cortex calls `AI_OS_ROOT`. Both
fixed. Neither was caught by a test, because nothing tests the shell half — which is itself worth
knowing.

Still not done: `server-setup.sh` provisions the git half of server mode and not the cron half it was
written to pair with. That is real work with its own design questions and it is named rather than
smuggled in here.
