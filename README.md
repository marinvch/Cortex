# Cortex — Repo Brain

Install a codebase brain into any repository with one command. Every AI agent on the team reads the
same file, the brain accumulates tribal knowledge as work happens, and a secret guard stands between
that knowledge and your git history.

```bash
npx @marinvch/cortex-init
```

No clone, no config, no runtime dependencies. Writes only inside the repo you run it in, and makes
no network requests — [asserted in CI](scripts/assert-no-egress.mjs), not just promised.

---

## What it writes

| File | Purpose |
|------|---------|
| `AGENTS.md` | The brain. The only file with real content. |
| `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/project.mdc` | One-line shims pointing at `AGENTS.md` |
| `.cortex/memory/gotchas.md` | Tribal knowledge, accumulated and committed |
| `.cortex/memory/decisions.md` | Append-only decision log |
| `.cortex/lib/` | The vendored secret guard |
| `.claude/skills/cortex-{skill,agent,hook,mcp}/` | Meta-skills — the repo can author its own capabilities |
| `.cortex/plugins.json` | Recommended plugins, declared rather than installed |
| `.claude/hooks/cortex-reflect.mjs` | SessionEnd hook that harvests gotchas |

Commit all of it. That is the point — a teammate who clones the repo inherits the brain without
running anything.

## Why one file plus shims

Every AI tool reads a different filename. Copying the content into each one guarantees drift, and a
drifted brain is worse than no brain because agents act confidently on the stale copy. So `AGENTS.md`
holds everything and the rest are pointers. One dev on Claude, one on Copilot, one on Cursor — same
knowledge.

## How the brain learns

When an agent hits something non-obvious, it writes a line starting with `GOTCHA:`. At the end of the
session the hook harvests those lines, screens them, and appends the survivors to
`.cortex/memory/gotchas.md`.

Extraction is deliberately deterministic — it reads explicit markers rather than inferring lessons
from a transcript. A hook has no model available, and a guessed "lesson" committed to a team's repo
is worse than none.

## How the brain grows

The repo ships with four meta-skills. When a developer needs a new capability they ask for it, and
Cortex writes it into the repo — scoped to this codebase, not a generic marketplace copy.

    /cortex-skill    create a skill        /cortex-hook   create a hook
    /cortex-agent    create a subagent     /cortex-mcp    scaffold an MCP server

Created capabilities register in the `## Project skills` section of `AGENTS.md`, which sits outside
the generated markers — `--refresh` never destroys them.

## Plugins are declared, not installed

`cortex-init` runs inside other people's repositories. Writing `enabledPlugins` on their behalf would
provision third-party code into a developer's environment without asking, so by default Cortex writes
`.cortex/plugins.json` — a manifest saying what this project expects — and prints the install command.

`--with-plugins` opts in, and even then only non-network plugins are enabled. Anything that leaves the
machine is marked `"network": true` in the manifest and never enabled automatically.

## The secret guard

Memory is **committed and ungated** — learnings go straight into git history with no human promotion
step. That makes the guard load-bearing rather than a nicety: it is the only thing between an agent's
observation and a permanent record in your repository. So it blocks. It never redacts, never warns
and continues.

Four layers:

1. **Known key shapes** — AWS, GitHub, Stripe, Slack, Google, npm, Anthropic, OpenAI, private key blocks, JWTs
2. **Credentialed URIs** — `postgres://user:password@host`
3. **Your own `.env` values** — the repo's `.env*` files are read and any candidate containing one of
   those literal values is refused. This catches the project-specific secrets no regex knows about,
   which is most of them. The guard reports *which variable* matched and never the value.
4. **Entropy** — high-entropy strings, with shape exemptions for git SHAs, UUIDs and `sha512-`
   integrity hashes. Entropy alone cannot tell a random secret from an npm lockfile digest — both sit
   near 5.9 bits per character — so shape does that work.

The two test corpora are the most important tests in the project: 18 entries that must always be
blocked, 10 legitimate engineering notes that must never be. A guard that fires on a commit SHA is a
guard developers rip out.

## Commands

```bash
npx @marinvch/cortex-init              # install
npx @marinvch/cortex-init --dry-run    # print the plan, write nothing
npx @marinvch/cortex-init --refresh    # re-scan; updates stack facts, preserves your prose
npx @marinvch/cortex-init --cwd path   # target another repo
npx @marinvch/cortex-init --with-plugins  # also enable the recommended plugins
```

`--refresh` only rewrites the block between the `cortex:generated` markers. Everything you wrote by
hand survives. If the markers are gone, the file is left alone entirely rather than overwritten.

## Guarantees

- Writes only inside the target repo — every path goes through a realpath guard that rejects `../`,
  absolute paths, and symlink escapes
- Zero network calls, zero runtime dependencies, both asserted in CI
- Idempotent — re-run any time; existing files are backed up to `.bak`, hooks are never double-registered
- Never overwrites a file you own without leaving a backup

## Development

```bash
npm test               # 21 tests
npm run check:egress   # assert no network APIs and no runtime deps
```

See [SPEC.md](SPEC.md) for the design and its rationale.

## License

MIT
