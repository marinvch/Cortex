---
type: reference
title: Living Cortex — self-hosted, always-current brain
updated: 2026-06-27
tags: [reference, server, mcp, cadence]
---

# Living Cortex — making the brain live on your server

Goal: a **personal** brain that lives on your own server, stays current across every machine, is
readable/writable by any AI session (via MCP), and maintains itself with scheduled rituals — so the
AI always knows the latest and records things without you copying files by hand.

> This is the server-side build-out of the **Cadence** layer in [[vault-architecture]] — the
> autonomy that follows [[operating-principles]] ("lowest autonomy that works," built only once the
> manual version holds). Register the in-session half with the `/connect-brain` ritual.

Almost all of this already exists in `mcp/`. This doc is the wiring plan. **Nothing here runs from a
Cowork/Claude session** — you run it on your machines + server, because it touches SSH, a Claude API
key, and the MCP connector approval (which happens in Claude's settings, not in a chat).

---

## The pieces (and what's already built)

| Piece | Job | Status |
|---|---|---|
| **Brain repo** (private, on your server) | The canonical memory. All machines sync to it. | you create it (below) |
| **MCP server** `mcp/server.js` | Gives any AI `recall` / `capture` / `catch_me_up` over the vault | ✅ built |
| **Git auto-sync** `mcp/lib/gitsync.js` | `capture` commits + pushes; `pull` before each write | ✅ built |
| **MCP connector** | Registers the MCP with Claude so tools appear in sessions | you register (below) |
| **Cron rituals** | Nightly digest / weekly audit on the server, hands-off | `tools/server/cortex-cron.sh` (below) |

### Two repos, clean split (don't mix them)
- **`ai-os`** (public) — the *code*: `tools/`, `skills/`, `templates/`, `mcp/`. Data-free, shareable.
- **`cortex-brain`** (private, self-hosted) — the *data*: your captured notes. Only you. This is the
  "living memory" that syncs across machines. Keep it a **separate private repo**, never public.

---

## How "capture(team)" already works

`capture({ content, team: "cortex" })` in the MCP:
1. finds the local clone at `<AI_OS_ROOT>/team/cortex/` (`teamCloneDir`),
2. `git pull --ff-only` (gets other machines' latest),
3. writes a one-note file, then `git commit` + `git push` to your server.

So once the clone points at your server repo, every `capture` lands on the server automatically, and
every machine pulls it before writing. That's the whole "always current" loop. We just point it at
your server.

---

## Setup — do this once

### 1. Create the brain repo on the server (bare)
```bash
# on the server (SSH in first)
mkdir -p ~/git && cd ~/git
git init --bare cortex-brain.git
```

### 2. On EACH machine — wire the local clone the MCP expects
`AI_OS_ROOT` = your vault path. The MCP looks for the clone at `<AI_OS_ROOT>/team/cortex/`:
```bash
# from your vault root (adjust user@server + path)
git clone ssh://USER@SERVER/~/git/cortex-brain.git team/cortex
# first push so the branch exists + tracking is set
cd team/cortex && git commit --allow-empty -m "init cortex-brain" && git push -u origin HEAD && cd -
```
> `team/` is already gitignored in the vault, so this private clone never leaks into the public repo.

### 3. Register the connector with Claude
```bash
# nothing to install — the server has no dependencies
# register (Claude Code / Desktop). AI_OS_ROOT must be an absolute path.
claude mcp add ai-os --env AI_OS_ROOT="/path/to/ai-os" -- node "/path/to/ai-os/mcp/server.js"
```
Now, in any Claude session on that machine, the tools `recall`, `capture`, `list_projects`,
`get_project_context`, `catch_me_up` are available. **This is the "AI has access any time" part.**

### 4. Smoke test
In a Claude session: ask it to `capture` a note with `team: "cortex"`. Then on the server:
```bash
git --work-tree=/tmp/ck --git-dir=~/git/cortex-brain.git log --oneline -1   # should show your note
```

---

## Level 2 — autonomy (cron on the server)

The server keeps its own clone and runs rituals on a schedule, committing results back.

### One command

```bash
bash tools/server/server-setup.sh cron ~/git/cortex-brain.git
```

It clones the working brain to `~/cortex-work`, creates a `0600` env file at
`~/.config/cortex/cron.env`, and **prints** the two crontab lines it recommends. It changes nothing
else. Re-run with `--install` to write them into your crontab as a managed block:

```bash
bash tools/server/server-setup.sh cron ~/git/cortex-brain.git --install
```

Printing is the default on purpose. A crontab is user-global and annoying to reconstruct, so a setup
script run out of curiosity must not rewrite it. `--install` replaces only its own marked block and
never touches your other jobs.

### Where the API key goes — and where it must not

Put the key in `~/.config/cortex/cron.env`, which the crontab lines *source*:

```bash
ANTHROPIC_API_KEY=...
```

**Never put it in the crontab line itself.** `crontab -l` prints it — the one command people run to
check whether cron is set up — and it lands in any backup of `/var/spool/cron`. An earlier version of
this page recommended exactly that; it was wrong, and it contradicted the rest of Cortex, where
`core/scrub.js` refuses a memory write carrying a credential.

The key is **optional**. Without one, `cortex-cron.sh` writes a deterministic git-based digest, which
is the boring path and always works. If a key is set and the call fails, the script now says so on
stderr instead of quietly writing a digest with no summary.

### What the scheduled run does

- `git pull` the brain,
- gathers notes changed since the last run,
- optionally summarizes them with the Claude API,
- writes `digests/<date>.md` (daily) or `audits/<date>.md` (weekly),
- `git commit` + `git push`.

Next time you open the brain from any machine, `pull` brings the digest down. The AI "wrote something
while you were away" — the living part.

---

## Honest limits
- **I'm not a 24/7 service.** A Cowork/Claude chat isn't always-on and can't poll your server itself.
  "Always available" = the **MCP connector** (per-session) + **cron** (autonomy). Together they cover
  read-any-time and write-without-you.
- **Secrets:** the Claude API key lives only on your server (cron env). Never commit it. The brain
  repo stays private (SSH-only). `.env` is already gitignored.
- **Personal scope:** this is your brain only. If you ever add teammates, give them read/write to the
  same repo — but then it's a shared brain and the privacy rule (no client secrets in notes) applies.

## Next after wiring
- Ask the AI in-session: *"recall what I decided about X"* → it searches the live brain.
- Tell it *"capture this to team cortex"* whenever something's worth remembering — it lands on the server.
- Let cron run a week, then read the digests to see the autonomy working.
