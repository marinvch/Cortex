# Cortex — your personal AI brain

[![CI](https://github.com/marinvch/ai-os/actions/workflows/ai-os-validate.yml/badge.svg)](https://github.com/marinvch/ai-os/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)

Cortex is a personal AI operating system. Clone it, open it in Claude Code, run `/onboard`.
It learns who you are and how you work, then **keeps itself alive** — when you point it at
code, the `ai-os` engine re-scans, refreshes context, and reconciles memory for you.

> Not affiliated with `nateherkai/AIS-OS`. Cortex is the `ai-os` engine (kernel) plus a
> clone-and-go userland.

## Why Cortex

- **Alive** — it maintains itself (engine-backed), not a static folder of notes.
- **Bounded** — a strict three-domain data model (`shared` · `personal` · `project`);
  company and client data never leaks upward, and the *only* `project → personal` path is
  the sanitized `promote_to_brain` gate.
- **Sovereign** — plain files, MIT, forkable, no cloud lock-in.

Full framework: [`references/alive-os-framework.md`](./references/alive-os-framework.md).

## Two ways to use it

**As your personal AI OS** — clone, open in Claude Code, and run the rituals:

1. `/onboard` once — seeds your identity into `context/` and initializes `brain/`.
   (No Node needed for the personal layer.)
2. `/audit` weekly — read-only health and data-boundary report.
3. `/level-up` biweekly — re-interview, sanitized promotion, evolve the manual.

See [`SETUP.md`](./SETUP.md) to begin and
[`references/getting-started.md`](./references/getting-started.md) for the walkthrough.

**As an engine on any codebase** — give an existing repo an AI brain without cloning Cortex:

```bash
npx -y github:marinvch/ai-os
```

This scans the repo, detects the stack, and generates AI-context artifacts, a project-intelligence
MCP server, agents, and skills. Full docs and source live in [`engine/`](./engine/README.md).

## How it fits together

- The **userland** (this repo root) is the shareable, data-free template you fork and make yours.
- The **kernel** ([`engine/`](./engine/README.md)) is the TypeScript `ai-os` engine; it lights up
  whenever a codebase and Node are present.
- Your **personal layers** (`context/`, `brain/`, `decisions/`) are gitignored and never committed.

Quick command reference: [`references/quick-reference.md`](./references/quick-reference.md).

## License

MIT — covers both the userland and the engine.
