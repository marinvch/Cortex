---
type: reference
title: Cortex Core Plugin Bundle
updated: 2026-07-01
tags: [reference, plugins, cortex-setup]
---

# Cortex Core Plugin Bundle

The official plugin manifest for Cortex Vault. Four tiers of plugins, provisioned by user role and workflow. The **Core** tier installs out-of-the-box on Cortex setup; the rest are offered by role during onboarding.

> **Provisioning note:** Plugin discovery and installation is *guided* (one trust/confirm prompt per marketplace), not fully silent. You remain in control of what reaches your agent.

---

## Plugin Tiers

### Core — Installs by default

Always installed on Cortex setup. These form the scaffolding of the vault: capture, skills, knowledge management, code review, and up-to-date library docs.

| Plugin | Purpose |
|--------|---------|
| `superpowers` | Skills workflow framework — the foundation for all other agent automation |
| `skill-creator` | Create and optimize custom skills for your vault |
| `claude-md-management` | Audit and improve CLAUDE.md/AGENTS.md documentation |
| `claude-code-setup` | Recommends hooks, subagents, skills, and plugins per project |
| `feature-dev` | Feature development agents: explorer, architect, reviewer |
| `code-review` | Review a PR for bugs and best practices |
| `code-simplifier` | Simplify and refactor code for clarity |
| `context7` | Up-to-date library docs via MCP (React, Node, TypeScript, etc.) |

### Dev Tools — For developers and automators

Deepen IDE integration, GitHub workflow, and TypeScript support. Offered during onboarding for engineering roles.

| Plugin | Purpose |
|--------|---------|
| `typescript-lsp` | TypeScript language-server integration for IDE |
| `github` | GitHub PR, issue, and API access |

### Browser QA — For testing and design

Automate browser testing, performance audits, and visual debugging. Heavy MCP tools; offered for QA and design roles.

| Plugin | Purpose |
|--------|---------|
| `playwright` | Browser automation via MCP (heavy tool) |
| `chrome-devtools-mcp` | Chrome DevTools integration for perf and a11y audits |

### Platform — Cloud and third-party

Deploy, host, and scale on Vercel and Cloudflare; extend with third-party skill packs.

| Plugin | Purpose |
|--------|---------|
| `vercel` | Vercel platform: deployments, edge functions, storage |
| `cloudflare@cloudflare` | Cloudflare Workers, Durable Objects, storage, agents |
| `andrej-karpathy-skills@multica-ai` | Third-party skills pack (Karpathy AI teaching resources) |

---

## How provisioning works

During `/onboard`, Cortex asks which tiers you need. Each marketplace is discovered once; plugins are confirmed in one prompt per marketplace. After install, use `/setup-plugins` to add, remove, or reconfigure tiers any time.

Plugins are installed to `.claude/settings.json` (Core) and `.claude/plugins.json` (all tiers). See `[[operating-principles]]` for the philosophy: automation earns trust through proof, not silence.

---

See: [[vault-architecture]] for how these plugins fit into the knowledge and operating layers.
