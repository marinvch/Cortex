# cortex-init

A tiny, zero-dependency wizard that installs a **codebase brain** into any repo — the npx-style
experience: run one command, answer a few questions, and the repo gets an `AGENTS.md` + agent
shims (Claude/Gemini/Copilot/Cursor) + dev-cycle skills. No heavy engine, no Node packages.

## Run it (3 ways)

**1. Direct (works immediately, nothing to install):**
```powershell
# from inside the target repo
node D:\Projects\Personal\ai-os\tools\cortex-init.mjs
```

**2. As a global command (type `cortex-init` in any repo):**
```powershell
# one-time install
npm install -g D:\Projects\Personal\ai-os\tools
# then, inside any repo:
cortex-init
```

**3. As `npx cortex-init` (after you publish it):**
Publish this folder to npm (`npm publish`) or point npx at your GitHub repo
(`npx github:marinvch/ai-os` once a root bin is wired). Until then, use option 1 or 2.

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
