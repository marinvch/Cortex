# cortex-init

A tiny, zero-dependency wizard that installs a **codebase brain** into any repo — the npx-style
experience: run one command, answer a few questions, and the repo gets an `AGENTS.md` + agent
shims (Claude/Gemini/Copilot/Cursor) + dev-cycle skills. No heavy engine, no Node packages.

Runs in any shell (bash, zsh, gitbash, PowerShell) under either runtime — swap `node` for `bun`
if that's what you have.

## Run it (3 ways)

**1. Direct (works immediately, nothing to install):**
```bash
# from inside the target repo — bash / zsh / gitbash
node /path/to/ai-os/tools/cortex-init.mjs
bun  /path/to/ai-os/tools/cortex-init.mjs   # if you use Bun instead of Node
```
```powershell
# PowerShell
node D:\Projects\Personal\ai-os\tools\cortex-init.mjs
```

**2. As a global command (type `cortex` in any repo):**
```powershell
# one-time install (installs the `cortex` command)
npm install -g D:\Projects\Personal\ai-os\tools
# then, inside any repo:
cortex
```

**3. As `npx` / `bunx` from GitHub (no install, nothing to publish):**
```bash
# from inside the target repo
npx  github:marinvch/ai-os     # Node
bunx github:marinvch/ai-os     # Bun
```
The repo root wires the `cortex` bin to this script, so this works today against the
public repo. To also publish to npm as `cortex`, run `npm publish` from the repo root.

## Non-interactive (CI, scripts, no TTY)

In a real terminal the wizard prompts you. With no TTY it reads answers from stdin (one per
line: name, what-it-does, key rule, agents) — blank lines fall back to detected defaults. Or
pass `--yes` to accept every default with no input at all:
```bash
printf 'MyApp\nWhat it does\nKey rule\nall\n' | node tools/cortex-init.mjs
node tools/cortex-init.mjs --yes
```

## What it does
1. Scans the repo (package.json, lockfile, configs, folders) to detect stack, scripts, conventions.
2. Asks: project name, what it does, any key rule, which agents to support.
3. Writes into the **current repo only** (backs up existing files to `*.bak`):
   - `AGENTS.md` — the single source of truth (the project brain)
   - shims: `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/project.mdc`
   - `.claude/skills/plan-feature` + `investigate-bug`
   - `docs/decisions.md`
4. You review `AGENTS.md`, fix anything it guessed wrong, and commit.

## After running
- Open the repo in Claude Code → `/plan-feature` to start work (plan-before-implementing).
- Commit `AGENTS.md` + shims so the whole team's agents share the brain.
- Re-run anytime to refresh after big codebase changes (old files are backed up).

> Self-contained: copy `cortex-init.mjs` to a work machine and it runs with just Node — no install,
> no internet, no engine.
