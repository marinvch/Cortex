# Plan: the three-audience resolver

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** the dev side stops learning which world it is in. One resolver answers "where is the brain
and who is this for", and `capture` / `catch_me_up` stop requiring the caller to say `team`.

**Architecture:** `mcp/lib/resolve.js` returns `{ audience, root, team, teamClone, source }` from the
environment and the working directory. It sits above `mcp/lib/vault.js` — the Vault knows *how* to
touch a root, the resolver decides *which* root and *for whom*.

**Tech Stack:** Node 20+, `node:test`, no runtime dependencies (ADR 0004).

**Spec:** [`2026-08-15-three-mode-seam-design.md`](../specs/2026-08-15-three-mode-seam-design.md) —
Decision 2 and sequence item 10. This is the last open item of the big task.

## Global constraints

- **No runtime dependencies.** ADR 0004.
- **Layering holds.** `core/` ← `index/` + `mcp/`; the leaves never import each other.
- **Every vault path still goes through `lib/vault.js`.** ADR 0007. The resolver decides *which*
  root; it never reads or writes one itself.
- **Verification for every task:**
  ```bash
  node --test core/test/*.test.js && node --test mcp/test/*.test.js && node --test index/test/*.test.mjs
  ```

## Two decisions taken before writing this

**1. `AI_OS_ROOT` unset stays a hard exit.** The spec describes a resolver that falls back to
`AI_OS_ROOT`, then to a repo-local `.cortex/memory/`. `mcp/AGENTS.md` states the opposite and
`server.js` enforces it: *"`AI_OS_ROOT` unset is a hard exit, not a default. Guessing a vault path
would write someone's notes into the wrong place."*

The invariant wins. A resolver that invents a root is a resolver that can file a private note into a
work repository, and no convenience is worth that. The resolver **detects** which audience it is
serving and **locates** the team clone; it never conjures a root. The spec's fallback chain is
recorded in ADR 0008 as a rejected alternative, so the next reader does not re-propose it.

**2. The word is "audience", not "mode".** `mcp/lib/mode.js` already owns `mode` for a *different
axis* — repo versus vault, decided by whether the root ends in `.cortex`. Solo/team/server is
orthogonal: a repo-mode brain can be on a server, a vault-mode brain can be on a team. Reusing
"mode" would weld two independent questions into one word and guarantee a future bug. The spec's own
framing is "three audiences", so the code says `audience`.

This also settles the env var: **`CORTEX_AUDIENCE=server`**, not `CORTEX_MODE` — which sits one
character from the `CORTEX_MODEL` that `tools/server/cortex-cron.sh` already reads.

## Why server must be declared rather than detected

Solo and team are facts about the filesystem: a `.cortex/connector.json` means team, its absence
means solo. Server is not. The spec defines it as solo mode *minus* interactive prompts, *plus* a
scheduler, *plus* a model that is not Claude Code — none of which leaves a trace the resolver can
read. A heuristic here ("no TTY means server") would be wrong every time an agent runs in CI.

So server is **declared**, and the resolver says so honestly in `source`. That asymmetry is the
finding, not a wart to hide.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `mcp/lib/resolve.js` | which root, which audience, where the team clone is | **create** |
| `mcp/test/resolve.test.js` | the three audiences, precedence, and the hard exit | **create** |
| `mcp/server.js` | resolve once at startup; pass the result down | modify |
| `mcp/lib/mode.js` | unchanged — the other axis | unchanged |
| `tools/server/cortex-cron.sh` | live bug: stale model id; accept `AI_OS_ROOT` | modify |
| `docs/adr/0008-three-audiences-one-seam.md` | the decision | **create** |
| `AGENTS.md`, `mcp/AGENTS.md` | the gotcha | modify |

---

## 1. The resolver

**Touches:** `mcp/lib/resolve.js`, `mcp/test/resolve.test.js`

```js
export class NoRootError extends Error {}          // code: "no_root"
export function resolveBrain({ cwd, env }) { }     // -> { audience, root, team, teamClone, source }
```

- `root` — `env.AI_OS_ROOT`. Missing or empty throws `NoRootError`. **Never inferred.**
- `audience` — `"server"` when `env.CORTEX_AUDIENCE === "server"`; else `"team"` when a
  `.cortex/connector.json` is found; else `"solo"`.
- `team` / `teamClone` — the connector's `slug` and `teamCloneDir(root, slug)`, or `null`.
- `source` — how the audience was decided: `"declared"`, `"connector:<path>"` or `"default"`. A
  resolver that cannot explain itself is one nobody trusts when it is wrong.

Finding the connector walks **up** from `cwd` to the filesystem root, because an agent runs in a
subdirectory far more often than at the repo top. Stop at the first hit.

Server outranks the connector: a scheduled run on a host that happens to sit inside a connected repo
is still a server run. Declaring beats detecting, always — that is what declaring is for.

- [ ] **Step 1:** write `resolve.test.js` — solo (root set, no connector), team (connector at `cwd`,
  and at a grandparent), server (declared, and declared *while* a connector exists), `NoRootError`
  for unset **and** for empty-string `AI_OS_ROOT`, malformed connector JSON degrading to solo rather
  than throwing, and `source` naming the connector path it used.
- [ ] **Step 2:** run. Expected: FAIL, module not found.
- [ ] **Step 3:** implement `mcp/lib/resolve.js`.
- [ ] **Step 4:** run. Expected: PASS.
- [ ] **Step 5:** commit.

**Verify:** a malformed `connector.json` must **not** take the server down. A brain that refuses to
start because one JSON file is corrupt has turned a papercut into an outage.

## 2. The dev side stops asking

**Touches:** `mcp/server.js`, `mcp/test/mode.test.js`

Today the *caller* passes `team` to `capture` and `catch_me_up`. That is the seam leaking: the agent
has to know which world it is in, which is exactly what the spec says must not happen.

Resolve once at startup. `capture` and `catch_me_up` take their team from the resolution; the `team`
argument stays as an **explicit override**, not a requirement.

- [ ] **Step 1:** replace the `AI_OS_ROOT` constant with `resolveBrain({ cwd: process.cwd(), env: process.env })`,
  keeping the same stderr message and `exit(1)` on `NoRootError` — the observable failure does not change.
- [ ] **Step 2:** default the team: `const team = args.team ?? brain.team;` in both tools. `noteId` is
  generated whenever a team is in play, from either source.
- [ ] **Step 3:** soften the two tool descriptions — `team` is now "override the team-brain this
  writes to; defaults to the connected team" rather than the thing that enables team mode at all.
- [ ] **Step 4:** run the full mcp suite. Expected: PASS — no existing test passes `team` implicitly.
- [ ] **Step 5:** commit.

**Verify:** `node --test mcp/test/capture.team.test.js mcp/test/mode.test.js` — team routing still
works when `team` is passed explicitly, which is the back-compat case.

## 3. The audience is visible

**Touches:** `mcp/server.js`, `mcp/test/mode.test.js`

Server mode is **mostly subtraction** and most of that subtraction lives in markdown rituals, not
code. What code owes it is honesty: log the resolved audience and its `source` to stderr at startup.

- [ ] **Step 1:** emit one stderr line: `cortex: audience=team (connector:/path/.cortex/connector.json) root=…`.
  stderr, never stdout — stdout is the MCP protocol channel and a stray line there corrupts the stream.
- [ ] **Step 2:** add a test asserting the resolved audience appears in the startup line and that
  **nothing** is written to stdout before the first protocol message.
- [ ] **Step 3:** commit.

## 4. Fix the server half that never worked

**Touches:** `tools/server/cortex-cron.sh`

Two live bugs found while reading it, unrelated to the resolver but squarely in server mode:

- `CORTEX_MODEL` defaults to `claude-sonnet-4-6`, a model id that no longer exists. Every scheduled
  run fails. Point it at a current id and add a comment that model ids age.
- It keys on `BRAIN_DIR` while everything else in Cortex uses `AI_OS_ROOT`, so the two halves of
  server mode share no vocabulary. Accept `AI_OS_ROOT` as a fallback for `BRAIN_DIR`, keeping
  `BRAIN_DIR` working so existing crontabs do not break.

- [ ] **Step 1:** make both changes; `bash -n tools/server/cortex-cron.sh` to syntax-check.
- [ ] **Step 2:** commit.

**Out of scope, deliberately:** making `server-setup.sh` provision the cron half it was written to
pair with. That is real work with its own design questions (which rituals, what schedule, what
happens on failure) and it is not the resolver. Recorded as the next item rather than smuggled in.

## 5. Record the decision

**Touches:** `docs/adr/0008-three-audiences-one-seam.md`, `AGENTS.md`, `mcp/AGENTS.md`

ADR 0008: audience is a third axis, not a rename of `mode`; server is declared because it cannot be
detected; the resolver never invents a root. Rejected: the spec's fallback chain (contradicts a
documented safety invariant), reusing `mode` for both axes, and detecting server from the absence of
a TTY (wrong in CI every time).

Root `AGENTS.md`: `mode` and `audience` are different questions — never conflate them.
`mcp/AGENTS.md`: `capture`'s `team` argument is an override now, not the switch.

- [ ] **Step 1:** write both. **Step 2:** `node --test core/test/*.test.js`. **Step 3:** commit.

## 6. Release

**Touches:** `CHANGELOG.md`, `VERSION`, both plugin manifests, `mcp/package.json`, `README.md`, and
the `[2.6.0]` link reference — **six** sites.

Cut 2.6.0, then tag and publish the release so the changelog link is not dead on arrival.

- [ ] **Step 1:** bump all six. **Step 2:** `node --test mcp/test/version.test.js`. **Step 3:** commit.

---

## Out of scope

- `server-setup.sh` provisioning cron (task 4's note).
- Declaring a minimum model capability for rituals that assume a strong model (`/level-up`,
  `/cortex-audit`). The spec raises it; it is a ritual-authoring question, not a resolver one.
- Splitting the repo into packages. 2026-08-12 Decision 1 stays the target, not this pass's work.

---

## Outcome — all tasks done, 2026-08-18

Shipped as **2.6.0**. This closes sequence item 10 and, with it, the last open item of the big task.

**What the work confirmed:** the seam's real leak was not the missing resolver — it was `capture`
taking `team` as an argument. A resolver that nobody consulted would have changed nothing; making
the tools read it is what closed the seam.

**Verification beyond the suite.** An end-to-end run over a real tree resolved all five cases: solo,
team at a repo root, team from a nested `src/deep` cwd (the walk-up), server declared while a
connector was present, and `no_root` refused rather than guessed.

That run also caught something worth recording: my *first* attempt reported `solo` for every team
case and I nearly filed it as a resolver bug. It was a mistake in the throwaway harness —
`process.argv[0]` is the node executable, so the paths were shifted by one. The lesson is not about
argv: an end-to-end check is only evidence if the harness itself is right, and a failing e2e run is
a claim about *the whole setup*, not proof about the code.

**Left named rather than smuggled in:**
- `server-setup.sh` still provisions the git half of server mode and not the cron half it was written
  to pair with. Real work, own design questions (which rituals, what schedule, what happens on
  failure).
- Nothing tests the shell half of server mode. Both `cortex-cron.sh` bugs survived because of it, and
  they were found by reading rather than by CI.
- A declared minimum model capability for rituals that assume a strong model (`/level-up`,
  `/cortex-audit`). A ritual-authoring question, not a resolver one.
