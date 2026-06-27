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

## Flags

```
--name <s>               Project name (default: package.json name / folder)
--purpose <s>            One line: what the project does
--rule <s>               A key rule the AI must always follow
--agents <list>          claude,gemini,copilot,cursor  or  all   (default: all)
--yes, -y                Accept all detected defaults; no prompts, no stdin
--additive               Refresh skills only; never touch AGENTS.md / shims
--register-to-vault <p>  Append a metadata-only project stub to <vault>/projects/
--help, -h               Show help
```

## What it does
1. **Detects** (it does not read your source): `package.json` deps + scripts, lockfile,
   `tsconfig` (strict + first path alias), eslint/prettier/CI presence, the README's first line,
   and route/source directories (`src/app`, `pages`, `src/routes`, `src/components`, …).
2. **Asks** (or takes flags/stdin/`--yes`): name, what it does, a key rule, which agents.
3. **Scaffolds** into the **current repo only** (existing files → `*.bak`):
   - `AGENTS.md` — the source of truth, with real Stack/Run/Architecture/Conventions filled from
     the scan and `<…>` blanks for prose it can't infer.
   - shims: `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/project.mdc`
   - `.claude/skills/plan-feature` + `investigate-bug`, and `docs/decisions.md`
4. You review `AGENTS.md`, fix anything it guessed, and commit.

> This is a **fast scaffold**, not an AI scan. For deep prose (real Architecture/Conventions/Gotchas
> read from the code), run the `/install-project` skill in Claude Code.

## Safety on re-run / brownfield
- **Never clobbers curated docs.** A hand-written `AGENTS.md` is preserved; the generated one is
  written to `AGENTS.generated.md` to diff. A curated `CLAUDE.md` (anything but the `@AGENTS.md`
  shim) is left untouched.
- **Non-clobbering backups.** The first overwrite makes `file.bak`; later runs make
  `file.bak.<timestamp>`, so the original is never lost.
- **Gitignore-aware.** Warns if a generated file is ignored by the repo's `.gitignore` (so the team
  doesn't silently miss it) and suggests adding `*.bak` to `.gitignore`.

## Register with your personal vault (opt-in)
`--register-to-vault <path>` writes a **metadata-only** stub to `<vault>/projects/<repo>.md`
(name, local path, repo URL, one-line purpose, stack, install date) and flips the vault's
`connections.md` "Tasks / projects" row to `local files`. No code, secrets, or client data — the
firewall holds. The vault-side companion is the `/scan-projects` skill.

## After running
- Open the repo in Claude Code → `/plan-feature` to start work (plan-before-implementing).
- Commit `AGENTS.md` + shims so the whole team's agents share the brain.

> Self-contained: copy `cortex-init.mjs` to a work machine and it runs with just Node or Bun — no
> install, no internet, no engine.
