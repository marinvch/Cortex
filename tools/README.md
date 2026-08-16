# cortex tools (bash, zero deps)

Small bash scripts. **No Node, no Python, nothing to install** — just bash (git-bash, zsh,
WSL, Linux, macOS). The original Node installer is retired at `../archives/cortex-init.mjs.legacy`.

`cortex.sh`, `cortex-rm.sh` and `cortex-scan-projects.sh` share `_cortex-lib.sh` (`slugify`,
`note_id`, `knowledge_files`). `cortex-init.sh` deliberately does not — it is a standalone
installer copied into other repos — so it keeps its own copy of the slug rule, pinned against
`mcp/lib/slug.js` by `mcp/test/slug-parity.test.js`.

## `cortex-init.sh` — install a codebase brain into any repo

Run one command inside a target repo and it scaffolds an `AGENTS.md` + agent shims
(Claude/Gemini/Copilot/Cursor) + dev-cycle skills + `docs/decisions.md`.

```bash
# from a clone of the vault, inside the target repo:
bash /path/to/ai-os/tools/cortex-init.sh

# or one-liner, no clone:
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/main/tools/cortex-init.sh | bash
```

### Non-interactive (CI, scripts, no TTY)
With no TTY it reads answers from stdin (name, what-it-does, key rule, agents) — blanks fall back
to detected defaults. Or `--yes` to take every default:
```bash
printf 'MyApp\nWhat it does\nKey rule\nall\n' | bash tools/cortex-init.sh
bash tools/cortex-init.sh --yes
```

### Flags
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

### What it does
1. **Detects** (does not read your source): `package.json` deps + scripts, lockfile → package
   manager, `tsconfig` (strict + `@/*` alias), eslint/prettier/CI presence, README first line,
   source dirs. Maps deps → framework (Next.js, Nuxt, Remix, Vue, Svelte, React, Express).
2. **Detects an old engine** (`.ai-os/`, `.github/ai-os/`, ai-os MCP entry) and tells you to run
   `/migrate-engine` first so its memory isn't lost.
3. **Suggests skills** for the stack (e.g. React → `vercel-react-best-practices`).
4. **Scaffolds** into the current repo only (existing files → `*.bak`): `AGENTS.md` (source of
   truth), shims, `.claude/skills/plan-feature` + `investigate-bug`, `docs/decisions.md`.

### Safety on re-run / brownfield
- Never clobbers a curated `AGENTS.md` (writes `AGENTS.generated.md` to diff); curated shims kept.
- Non-clobbering backups: `file.bak`, then `file.bak.<timestamp>`.
- Gitignore-aware: warns if a generated file is ignored.

### Register with your personal vault (opt-in)
`--register-to-vault <path>` writes a **metadata-only** stub to `<vault>/projects/<repo>.md` (name,
path, stack, date). No code or secrets — the privacy firewall holds. Vault companion: `/scan-projects`.

## `cortex.sh` — the one viewer app (graph · notes · repos · gaps)

Run in the **vault root** to (re)generate `cortex.html` and open it: a single self-contained app
with four tabs — **Map** (Obsidian-style force graph), **Notes** (read rendered markdown, click
`[[wikilinks]]` to navigate), **Repos** (registered codebase brains), and **Gaps** (orphan notes +
dead links to fix). No server, no runtime — everything is embedded; just open the file.

```bash
bash tools/cortex.sh               # writes ./cortex.html and opens it
```

It reads **`.cortexignore`** to decide what counts as knowledge, so scaffolding, backups, generated
views and skills never show up as noise. That one file is the single source of truth — read through
`knowledge_files()` in `tools/_cortex-lib.sh`, and ported to JS in `mcp/lib/cortexignore.js` so the
live brain agrees with the generators. (The earlier `cortex-nav.sh` / `cortex-brain.sh` are retired
in `archives/retired-views/`.)

## `cortex-sync-skills.sh` — refresh the local `/slash` command mirror

`skills/` is canonical and is what an installed plugin loads. `.claude/skills/` is a **gitignored,
machine-local mirror** that exposes the rituals as `/slash` commands in this checkout — and because
it is gitignored, nothing keeps it current. The old advice (`cp -r skills/* .claude/skills/`) is run
once, never re-run, never refreshes a changed skill and never removes a deleted one. In practice it
had drifted to 22 of 30 skills with 9 stale local copies, so five v2.0 rituals were unavailable.

```bash
bash tools/cortex-sync-skills.sh            # sync, then report
bash tools/cortex-sync-skills.sh --check    # report only; exit 1 if out of sync
```

Each skill is replaced wholesale so a file deleted upstream does not linger. **Mirror-only skills
are reported and never removed** — a directory that exists only in the mirror is machine-local work
with no git history to restore from, so deleting it would be unrecoverable.

## `cortex-rm.sh` — remove a note the safe way

Used by the **🗑 Remove** button in the viewer (which copies this command for the exact note — no
file hunting). It archives the note to `archives/removed/` (move, don't delete), strips inbound
`[[wikilinks]]` so no dead links remain, and regenerates `cortex.html`.

```bash
bash tools/cortex-rm.sh areas/some-note.md
```

> Self-contained: copy `cortex.sh` + `_cortex-lib.sh` to any machine and it runs with just bash — no
> install, no internet, no engine.
