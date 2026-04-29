# AI OS

> **Portable GitHub Copilot context engine** — scan any repository and auto-generate an optimized AI context package: instructions, agents, skills, MCP tools, and slash-command prompts.

## What it does

Run once in any repo. AI OS scans the codebase, detects your stack, and generates:

| Artifact | Location | What it is |
| --- | --- | --- |
| Copilot instructions | `.github/copilot-instructions.md` | System prompt optimized for your stack |
| Context docs | `.github/ai-os/context/` | Token-efficient stack, architecture, conventions docs |
| MCP tools | `.vscode/mcp.json` + `.ai-os/mcp-server/` | 29+ tools for code search, memory, session continuity |
| Agents | `.github/agents/*.agent.md` | Stack-specific chat agents |
| Skills | `.github/copilot/skills/ai-os-*.md` | Per-library playbooks (Next.js, tRPC, Prisma, etc.) |
| Slash commands | `.github/copilot/prompts.json` | `/new-page`, `/new-trpc-procedure`, `/new-model`, etc. |
| Prompt Quality Pack | `.github/instructions/prompt-quality.instructions.md` | Agent routing table + prompting guide |
| Manifest | `.github/ai-os/manifest.json` | Tracks every file AI OS owns for clean pruning |

AI OS initializes a persistent repository memory store at `.github/ai-os/memory/`. Memory entries are automatically deduplicated, TTL-expired, and compacted via `--compact-memory` or the `prune_memory` MCP tool.

## Requirements

- Node.js >= 20 **or** Docker (Node.js-free fallback)
- Git
- GitHub Copilot (VS Code extension)

**Target repositories do not need Node.js** — the MCP server is a pre-built, self-contained bundle.

## Quick Install

```bash
# One-liner bootstrap (paste in any target repo terminal)
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash
```

Or with `npx`:

```bash
npx -y "github:marinvch/ai-os"
```

### Local clone

```bash
git clone https://github.com/marinvch/ai-os ~/ai-os
bash ~/ai-os/install.sh --cwd /path/to/your/repo
```

### Refresh existing install

```bash
bash install.sh --refresh-existing
# or:
npx -y github:marinvch/ai-os --refresh-existing
```

### Install with a profile

```bash
bash install.sh --profile minimal    # instructions + MCP wiring only
bash install.sh --profile standard   # balanced default (recommended)
bash install.sh --profile full       # all integrations, agents, skills
```

### Pin to a specific release tag

```bash
npx -y "github:marinvch/ai-os#v0.6.26"
```

### Verifying bundle integrity

Each [GitHub Release](https://github.com/marinvch/ai-os/releases) includes SHA-256 checksums. To verify:

```bash
sha256sum bundle/generate.js dist/server.js
```

Compare against the **Bundle Provenance** section in the release notes.

## Optional skill installs

```bash
npx -y skills add anthropics/skills@skill-creator -g -a github-copilot
npx -y skills add vercel-labs/skills@find-skills -g -a github-copilot
```

## Re-running (idempotent)

Safe to run multiple times. `write-if-changed` skips files with identical content. The manifest tracks all owned files, and `--refresh-existing` prunes stale artifacts automatically.

To uninstall cleanly:

```bash
bash install.sh --uninstall
```

## What gets detected

- **Languages:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Swift, Kotlin, 30+ more
- **Frameworks:** Next.js, React, Vue, Angular, Svelte, Express, FastAPI, Django, Spring Boot, .NET, Laravel, Rails, Nuxt, Astro, Remix, tRPC, Prisma, and more
- **Tools:** ESLint, Prettier, Vitest, Jest, Playwright, Docker, GitHub Actions, package managers

## Full Documentation

| Page | Contents |
| --- | --- |
| [docs/cli.md](docs/cli.md) | All CLI flags, actions, profiles, dry-run output |
| [docs/mcp-tools.md](docs/mcp-tools.md) | MCP tools reference, server modes, bundle architecture |
| [docs/architecture.md](docs/architecture.md) | Components, data flow, manifest contract, memory |
| [docs/contributing.md](docs/contributing.md) | Dev setup, testing, conventions, release process |

## Supported framework templates

**Skills:** `nextjs` · `react` · `trpc` · `prisma` · `stripe` · `auth-nextauth` · `rag-pgvector` · `supabase` · `go` · `express` · `python-fastapi` · `java-spring` · `bun` · `deno` · `solid` · `remix`

**Instructions:** `nextjs` · `react` · `nuxt` · `vue` · `svelte` · `angular` · `astro` · `express` · `nestjs` · `trpc` · `prisma` · `drizzle` · `python-fastapi` · `python-django` · `java-spring` · `dotnet` · `php-laravel` · `ruby-rails` · `go` · `rust` · `react-native` · `expo` · `bun` · `deno` · `solid` · `vite` · `remix`

## License

MIT
