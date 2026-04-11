# AI OS

> **Portable GitHub Copilot context engine** — scan any repository and auto-generate an optimized AI context package: instructions, agents, skills, MCP tools, and slash-command prompts.

## What it does

Run once in any repo. AI OS scans the codebase, detects your stack, and generates:

| Artifact             | Location                                          | What it is                                                                         |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Copilot instructions | `.github/copilot-instructions.md`                 | System prompt optimized for your stack                                             |
| Context docs         | `.github/ai-os/context/`                          | Token-efficient stack, architecture, conventions docs                              |
| MCP tools            | `.github/copilot/mcp.json` (committed, no servers) + `.github/copilot/mcp.local.json` (local, gitignored) + `.ai-os/mcp-server/` | 10 tools for code search, schema reading, route listing |
| Agents               | `.github/agents/*.agent.md`                       | Stack-specific chat agents (framework expert, DB expert, auth, payments, explorer) |
| Skills               | `.github/copilot/skills/ai-os-*.md`               | AI OS-named per-library playbooks (Next.js, tRPC, Prisma, Stripe, etc.)            |
| Slash commands       | `.github/copilot/prompts.json`                    | `/new-page`, `/new-trpc-procedure`, `/new-model`, `/rag-query`, etc.               |
| Manifest             | `.github/ai-os/manifest.json`                     | Tracks every file AI OS owns — used for pruning stale artifacts on refresh         |

AI OS now also initializes a persistent repository memory store at `.github/ai-os/memory/` so agents can retain verified facts and decisions across long sessions.
Detection is package-aware for monorepos/mixed stacks, and MCP context tools provide parity coverage for Node, Java/Spring, Python, Go, and Rust projects.

Generated instructions also enforce strict behavior guardrails: ambiguity-first clarification (no improvisation), explicit allowed/forbidden action boundaries, and an escalation flow for underspecified requests.

## Requirements

- Node.js ≥ 20 (for local install only — your project does NOT need Node.js)
- Git
- GitHub Copilot (VS Code extension)
- Node.js ≥ 20 *(auto-installed by `bootstrap.sh` if missing — your project does not need Node.js)*

**No Node.js?** Use the GitHub Actions installer — no local tools required. See below.

## Install on any repo

### Fast bootstrap (paste in any target repo terminal)

```bash
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash
```

> **No Node.js?** No problem. `bootstrap.sh` detects a missing Node.js and automatically installs the latest LTS via [nvm](https://github.com/nvm-sh/nvm) before running the installer. Your project does not need Node.js.

With options:

```bash
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash -s -- --refresh-existing --install-skill-creator --install-find-skills
```

### GitHub Actions install (no Node.js required)

If you don't have Node.js locally, AI OS can install itself via GitHub Actions:

```bash
# 1. Clone AI OS (only to get install.sh — or use the bootstrap URL below)
git clone --depth 1 https://github.com/marinvch/ai-os.git /tmp/ai-os

# 2. Generate the GitHub Actions workflow (pure bash — no Node.js needed)
bash /tmp/ai-os/install.sh --github-actions --cwd /path/to/your/repo

# 3. Commit and push the workflow
cd /path/to/your/repo
git add .github/workflows/ai-os-install.yml
git commit -m "chore: add AI OS generator workflow"
git push

# 4. Go to GitHub → Actions → "AI OS — Generate Context" → Run workflow
```

Or with the bootstrap URL (fully remote, no clone required):

```bash
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash -s -- --github-actions
```

### Local clone workflow

```bash
# Clone ai-os somewhere on your machine (once)
git clone https://github.com/marinvch/ai-os ~/ai-os

# Then run from inside any target repo:
bash ~/ai-os/install.sh

# Or point it at a specific repo:
bash ~/ai-os/install.sh --cwd /path/to/your/repo

# Optional: also install Anthropic's skill-creator globally (via Git Bash)
bash ~/ai-os/install.sh --install-skill-creator

# Optional: also install Vercel's find-skills globally (via Git Bash)
bash ~/ai-os/install.sh --install-find-skills

# Optional: install both skills in one run
bash ~/ai-os/install.sh --install-skill-creator --install-find-skills

# Optional: refresh existing generated AI OS artifacts
bash ~/ai-os/install.sh --refresh-existing
```

### Docker-only install (no Node.js required)

If Node.js is not installed, `install.sh` automatically falls back to Docker:

```bash
# Docker must be running; Node.js is NOT required on the host
bash ~/ai-os/install.sh --cwd /path/to/your/repo
```

Or build and run the image manually:

```bash
# Build once from the ai-os directory
docker build -t ai-os:local ~/ai-os

# Run against any repo (files are written directly into the repo)
docker run --rm -v /path/to/your/repo:/repo ai-os:local --cwd /repo
```

> **Note:** The Docker path generates all context files and instructions but skips the local MCP server installation. Install Node.js ≥ 20 to also enable the MCP server.

## Optional skill installs

AI OS can install the official `skill-creator` and `find-skills` skills.

```bash
npx -y skills add https://github.com/anthropics/skills --skill skill-creator -g -a github-copilot -y
npx -y skills add https://github.com/vercel-labs/skills --skill find-skills -g -a github-copilot -y
```

Notes:

- This install path is Git Bash-friendly and does not require Python.
- The install command above targets GitHub Copilot only.
- Some advanced `skill-creator` benchmarking workflows use Python scripts, but core skill usage/install does not.

## What gets detected

- **Languages:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Swift, Kotlin, and 30+ more
- **Frameworks:** Next.js, React, Vue, Angular, Svelte, Express, FastAPI, Django, Spring Boot, .NET, Laravel, Rails, Nuxt, Astro, Remix, SolidJS, tRPC, Prisma, and more
- **Runtimes:** Bun (`bun.lockb` or `packageManager: bun@…`), Deno (`deno.json` / `deno.jsonc` / `deno.lock`)
- **Tools:** ESLint, Prettier, Vitest, Jest, Playwright, Docker, GitHub Actions, package managers
- **Build commands:** Extracted from `package.json` scripts, `Makefile`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, and `build.gradle` — surfaced in `copilot-instructions.md` so Copilot always knows how to build and test your project

## Generated MCP tools

AI OS generates two MCP config files:

| File | Committed? | Purpose |
| ---- | ---------- | ------- |
| `.github/copilot/mcp.json` | ✅ Yes | Tool definitions only — **no `servers` block**, safe for Copilot cloud agent and users without Node.js |
| `.github/copilot/mcp.local.json` | ❌ No (gitignored) | Local `servers` block — tells VS Code how to spawn the MCP subprocess when Node.js ≥ 20 is available |

| Tool                    | Purpose                                |
| ----------------------- | -------------------------------------- |
| `search_codebase`       | Ripgrep across project                 |
| `get_project_structure` | Annotated file tree                    |
| `get_conventions`       | Naming + architecture rules            |
| `get_stack_info`        | Full tech stack inventory              |
| `get_file_summary`      | Token-efficient file summary           |
| `get_prisma_schema`     | Full schema (if Prisma detected)       |
| `get_trpc_procedures`   | All tRPC procedures (if tRPC detected) |
| `get_api_routes`        | All API routes with methods            |
| `get_env_vars`          | Required env vars (never values)       |
| `get_package_info`      | Installed package versions             |
| `get_memory_guidelines` | Repository memory protocol             |
| `get_repo_memory`       | Retrieve durable project memory        |
| `remember_repo_fact`    | Persist verified memory entries        |

## Node.js auto-install

`install.sh` detects when Node.js is absent and attempts a silent auto-install in this order:

1. **nvm** (`~/.nvm/nvm.sh`) — most common on macOS/Linux/WSL
2. **fnm** — fast version manager
3. **volta** — toolchain manager
4. **Homebrew** (`brew install node`) — macOS
5. **apt-get** (NodeSource LTS) — Ubuntu/Debian/WSL
6. **winget** — Windows Git Bash

If none succeed, clear per-platform instructions are printed and the installer exits.

Your **project** does not need Node.js — only the AI OS tooling does (generator + MCP server runtime).

## Re-running (idempotent)

Safe to run multiple times:

- Existing **agents** and **skills** are never overwritten in safe mode
- Existing **prompts** are kept; only new IDs are added
- **write-if-changed**: every generator compares content before writing — files with identical content are skipped, so re-runs produce zero git noise
- **manifest tracking**: `.github/ai-os/manifest.json` records every file AI OS owns after each run
- **pruning**: in `--refresh-existing` mode, files in the previous manifest that are no longer generated (e.g. a skill for a framework you removed) are deleted automatically
- MCP runtime writes `.ai-os/mcp-server/runtime-manifest.json` and is health-checked after install
- MCP server is deployed as a **bundled single-file** (`dist/server.js`) — no `node_modules` are installed in the target repo

To also update existing generated agents, skills, prompts, and MCP config from latest templates:

- `bash install.sh --refresh-existing`
- `npm run generate:refresh -- --cwd /path/to/target-repo`

To force pruning even without a full refresh:

- `npm run generate -- --cwd /path/to/target-repo --prune`

To completely remove all AI OS artifacts tracked in the manifest:

- `bash install.sh --uninstall`

To check for orphaned or stale artifacts without modifying anything:

- `npm run check-hygiene -- --cwd /path/to/target-repo`
- `node .ai-os/mcp-server/index.js --healthcheck`

If MCP runtime diagnostics are needed:

- `AI_OS_MCP_DEBUG=1 node .ai-os/mcp-server/index.js --healthcheck`

Generated skill files use `ai-os-*.md` naming and stale ones are auto-pruned on refresh.

## Development

```bash
npm install
# Run generator on a target repo
npm run generate -- --cwd /path/to/target-repo
# Dry run (shows detected stack, no files written)
npm run generate:dry -- --cwd /path/to/target-repo
# Onboarding plan only (no writes)
npm run generate -- --cwd /path/to/target-repo --plan
# Preview actions (no writes)
npm run generate -- --cwd /path/to/target-repo --preview
# Apply changes explicitly
npm run generate -- --cwd /path/to/target-repo --apply
# Refresh mode — update existing artifacts + prune stale files
npm run generate:refresh -- --cwd /path/to/target-repo
# Prune stale artifacts without full refresh
npm run generate -- --cwd /path/to/target-repo --prune
# Scan for orphaned files or dump artifacts (no writes)
npm run check-hygiene -- --cwd /path/to/target-repo
# Build the bundled MCP server (dist/server.js)
npm run bundle
# Run regression suite (fixture matrix for all supported stacks)
npm run validate
```

## MCP server modes

The MCP server (`src/mcp-server/index.ts`) supports two explicit modes:

| Mode                      | How to invoke        | Use case                        |
| ------------------------- | -------------------- | ------------------------------- |
| Standalone JSON-RPC stdio | default (no flag)    | VS Code Copilot MCP integration |
| Copilot SDK client        | `--copilot` flag     | Copilot CLI integration         |
| Health check              | `--healthcheck` flag | Post-install validation         |

The standalone mode is the default for VS Code. Passing `--copilot` is required to use the Copilot SDK client. If `--copilot` is passed and the Copilot CLI is unavailable, the server exits with an explicit diagnostic — it never silently falls back to a different mode.

## Rollout guide

### Applying to a new repo

```bash
# Bootstrap from anywhere (in target repo):
curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash
```

### Updating an existing AI OS installation

```bash
bash install.sh --refresh-existing
# or:
npm run generate:refresh -- --cwd /path/to/repo
```

### Rollback

If an install or refresh causes issues:

1. Use `--uninstall` for a clean guided removal: `bash install.sh --uninstall` reads the manifest, shows all files to remove, prompts for confirmation, and cleans AI OS entries from `.gitignore`.
2. To remove all AI OS artifacts manually: `rm -rf .github/ai-os .github/copilot .github/agents .github/copilot-instructions.md`.
3. The `.github/ai-os/memory/` directory contains your repository memory — back it up before removal if needed.

### Verifying an install

```bash
# Health check the MCP server:
AI_OS_ROOT=. node .ai-os/mcp-server/index.js --healthcheck

# Full regression suite (ai-os dev repo only):
npm run validate
```

## Supported framework skill templates

`nextjs` · `react` · `trpc` · `prisma` · `stripe` · `auth-nextauth` · `rag-pgvector` · `supabase` · `go` · `express` · `python-fastapi` · `java-spring`

## Supported framework instruction templates

`nextjs` · `react` · `nuxt` · `vue` · `svelte` · `angular` · `astro` · `express` · `nestjs` · `trpc` · `prisma` · `drizzle` · `python-fastapi` · `python-django` · `java-spring` · `dotnet` · `php-laravel` · `ruby-rails` · `go` · `rust` · `react-native` · `expo`

## License

MIT
